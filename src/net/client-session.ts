/**
 * Client side of an online race. Sends the local input at SNAPSHOT_EVERY ticks, buffers host
 * snapshots, interpolates remote karts 100 ms behind, reconciles the locally predicted kart,
 * and mirrors phase / lap / place / finish of the local kart as the usual race events.
 */
import type { IKart, InputState } from '../core/types';
import { events } from '../core/events';
import {
  MSG,
  PHASE,
  decodeSnapshot,
  encodeInput,
  type NetKartPose,
  type RacePhase,
  type ResultsMsg,
  type RosterEntry,
  type Snapshot,
  type StandingMsg,
} from './protocol';
import { SNAPSHOT_EVERY } from './host-session';
import type { Transport } from './types';

export const INTERP_DELAY_MS = 100;
export const HOST_TIMEOUT_MS = 8000;
const BLEND_THRESHOLD_M = 0.6;
const SNAP_THRESHOLD_M = 5;
const BLEND_PER_TICK = 0.15;
const BUFFER_MAX = 30;

interface Stamped {
  at: number; // local arrival time (ms)
  snap: Snapshot;
}

export interface ClientRaceView {
  karts: readonly IKart[];
  totalLaps: number;
}

export class ClientSession {
  onPhase: ((phase: RacePhase, countdown: number) => void) | null = null;
  onResults: ((standings: StandingMsg[]) => void) | null = null;
  onHostLost: ((lastStandings: StandingMsg[]) => void) | null = null;

  private race: ClientRaceView | null = null;
  private tick = 0;
  private seq = 0;
  private readonly buffer: Stamped[] = [];
  private lastPhase: RacePhase = PHASE.grid;
  private lastSnapshotAt = 0;
  private lastLocal: NetKartPose | null = null;
  private hostLost = false;
  private resultsReceived = false;
  /** Local-kart values already mirrored (to emit events only on change). */
  private mirroredLap = -1;
  private mirroredPlace = -1;
  private mirroredFinished = false;

  constructor(
    private readonly transport: Transport,
    readonly roster: readonly RosterEntry[],
    readonly localKartId: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    transport.onMessage((event, payload, from) => this.onMessage(event, payload, from));
  }

  get raceTime(): number {
    const latest = this.buffer[this.buffer.length - 1];
    return latest ? latest.snap.raceTime : 0;
  }

  get phase(): RacePhase {
    return this.lastPhase;
  }

  attach(race: ClientRaceView): void {
    this.race = race;
    this.buffer.length = 0;
    this.lastSnapshotAt = this.now();
    this.hostLost = false;
    this.resultsReceived = false;
    this.mirroredLap = -1;
    this.mirroredPlace = -1;
    this.mirroredFinished = false;
  }

  sendLoaded(): void {
    this.transport.send(MSG.LOADED, { account: this.transport.account });
  }

  sendLeave(): void {
    this.transport.send(MSG.LEAVE, { account: this.transport.account });
  }

  /** Call once per fixed physics tick, after the local kart stepped. */
  tick60(input: InputState): void {
    const r = this.race;
    if (!r) return;
    this.tick++;
    if (this.tick % SNAPSHOT_EVERY === 0) {
      this.seq = (this.seq + 1) & 0xffff;
      this.transport.send(
        MSG.INPUT,
        encodeInput({
          seq: this.seq,
          steer: input.steer,
          throttle: input.throttle,
          brake: input.brake,
          drift: input.drift,
          useItemHeld: input.useItemHeld,
          lookBack: input.lookBack,
        }),
        true,
      );
    }
    this.applyInterpolated();
    this.reconcileLocal();
    if (!this.hostLost && !this.resultsReceived && this.buffer.length > 0 && this.now() - this.lastSnapshotAt > HOST_TIMEOUT_MS) {
      this.hostLost = true;
      this.onHostLost?.(this.standingsFromLatest());
    }
  }

  /** Standings derived from the newest snapshot (used when the host vanishes). */
  standingsFromLatest(): StandingMsg[] {
    const r = this.race;
    const latest = this.buffer[this.buffer.length - 1];
    if (!r || !latest) return [];
    return latest.snap.karts
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((p) => {
        const k = r.karts[p.id];
        return {
          kartId: p.id,
          name: k ? k.state.character.name : `#${p.id}`,
          color: k ? k.state.character.color : 0xffffff,
          place: p.place,
          finishTime: p.finished ? p.finishTime : -1,
        };
      });
  }

  dispose(): void {
    this.race = null;
  }

  // -------------------------------------------------------------------- inbound

  private onMessage(event: string, payload: unknown, from: string): void {
    if (from === this.transport.account) return;
    switch (event) {
      case MSG.SNAPSHOT: {
        if (!(payload instanceof ArrayBuffer)) return;
        const snap = decodeSnapshot(payload);
        if (!snap) return;
        this.pushSnapshot(snap);
        return;
      }
      case MSG.RESULTS: {
        const msg = payload as ResultsMsg;
        if (!msg || !Array.isArray(msg.standings)) return;
        this.resultsReceived = true;
        this.onResults?.(msg.standings);
        return;
      }
    }
  }

  private pushSnapshot(snap: Snapshot): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && snap.tick <= last.snap.tick) return; // out of order / duplicate
    this.buffer.push({ at: this.now(), snap });
    if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
    this.lastSnapshotAt = this.now();

    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      this.onPhase?.(snap.phase, snap.countdown);
    }
    const mine = snap.karts.find((k) => k.id === this.localKartId);
    if (mine) {
      this.lastLocal = mine;
      this.mirrorLocalProgress(mine);
    }
    // Race bookkeeping for remote karts is applied directly (no interpolation needed).
    const r = this.race;
    if (r) {
      for (const p of snap.karts) {
        if (p.id === this.localKartId) continue;
        const k = r.karts[p.id];
        if (!k) continue;
        k.state.lap = p.lap;
        k.state.place = p.place;
        k.state.checkpointIndex = p.checkpointIndex;
        k.state.finished = p.finished;
        k.state.finishTime = p.finishTime;
      }
    }
  }

  private mirrorLocalProgress(p: NetKartPose): void {
    const r = this.race;
    if (!r) return;
    const k = r.karts[this.localKartId];
    if (!k) return;
    const s = k.state;
    s.checkpointIndex = p.checkpointIndex;
    s.wrongWay = p.wrongWay;
    if (p.lap !== this.mirroredLap) {
      const prev = this.mirroredLap;
      this.mirroredLap = p.lap;
      s.lap = p.lap;
      if (prev >= 1 && p.lap > prev && !p.finished) {
        events.emit('race:lap', {
          kartId: s.id,
          lap: p.lap,
          totalLaps: r.totalLaps,
          isPlayer: true,
          isFinalLap: p.lap === r.totalLaps,
        });
      }
    }
    if (p.place !== this.mirroredPlace) {
      const from = this.mirroredPlace;
      this.mirroredPlace = p.place;
      s.place = p.place;
      if (from > 0 && p.place > 0) events.emit('race:positionChange', { kartId: s.id, from, to: p.place, isPlayer: true });
    }
    if (p.finished && !this.mirroredFinished) {
      this.mirroredFinished = true;
      s.finished = true;
      s.finishTime = p.finishTime;
      s.place = p.place;
      events.emit('race:finish', { kartId: s.id, place: p.place, time: p.finishTime, isPlayer: true });
    }
  }

  // ------------------------------------------------------------- interpolation

  private applyInterpolated(): void {
    const r = this.race;
    if (!r || this.buffer.length === 0) return;
    const renderAt = this.now() - INTERP_DELAY_MS;
    let a = this.buffer[0];
    let b = this.buffer[0];
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i].at <= renderAt) a = this.buffer[i];
      if (this.buffer[i].at >= renderAt) {
        b = this.buffer[i];
        break;
      }
      b = this.buffer[i];
    }
    const span = b.at - a.at;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (renderAt - a.at) / span)) : 1;
    for (const pb of b.snap.karts) {
      if (pb.id === this.localKartId) continue;
      const k = r.karts[pb.id];
      if (!k || !k.applyNetState) continue;
      const pa = a.snap.karts.find((p) => p.id === pb.id) ?? pb;
      k.applyNetState({
        ...pb,
        x: pa.x + (pb.x - pa.x) * alpha,
        y: pa.y + (pb.y - pa.y) * alpha,
        z: pa.z + (pb.z - pa.z) * alpha,
        heading: lerpAngle(pa.heading, pb.heading, alpha),
        speed: pa.speed + (pb.speed - pa.speed) * alpha,
      });
    }
  }

  private reconcileLocal(): void {
    const r = this.race;
    const target = this.lastLocal;
    if (!r || !target) return;
    const k = r.karts[this.localKartId];
    if (!k || !k.applyNetState) return;
    const s = k.state;
    const dx = target.x - s.position.x;
    const dy = target.y - s.position.y;
    const dz = target.z - s.position.z;
    const err = Math.hypot(dx, dy, dz);
    if (err > SNAP_THRESHOLD_M) {
      k.applyNetState({ ...target, lap: s.lap, place: s.place, checkpointIndex: s.checkpointIndex });
      return;
    }
    if (err > BLEND_THRESHOLD_M) {
      s.position.x += dx * BLEND_PER_TICK;
      s.position.y += dy * BLEND_PER_TICK;
      s.position.z += dz * BLEND_PER_TICK;
      s.heading = lerpAngle(s.heading, target.heading, BLEND_PER_TICK);
      s.speed += (target.speed - s.speed) * BLEND_PER_TICK;
    }
    // Frozen flag follows the host so the grid release matches the countdown.
    if (s.isFrozen !== target.isFrozen) k.setFrozen(target.isFrozen);
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
