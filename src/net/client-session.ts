/**
 * Client side of an online race. Sends the local input at SNAPSHOT_EVERY ticks, buffers host
 * snapshots, interpolates remote karts and hazards 100 ms behind, reconciles the locally
 * predicted kart, mirrors item boxes / item slots / status flags, re-emits batched item FX
 * events, and mirrors phase / lap / place / finish of the local kart as the usual race events.
 */
import * as THREE from 'three';
import type { IItemManager, IKart, InputState, NetHazard } from '../core/types';
import { events } from '../core/events';
import {
  MSG,
  PHASE,
  decodeSnapshot,
  encodeInputBatch,
  INPUT_BATCH_MAX,
  type NetFx,
  type NetKartPose,
  type RacePhase,
  type ResultsMsg,
  type RosterEntry,
  type NetInputSample,
  type Snapshot,
  type StandingMsg,
} from './protocol';
import { SNAPSHOT_EVERY } from './host-session';
import type { Transport } from './types';

/** Base render delay behind the newest snapshot; adapts upward with measured arrival jitter. */
export const INTERP_DELAY_MS = 100;
const INTERP_DELAY_MAX_MS = 260;
/** How far a starved client keeps karts moving along their last heading before freezing. */
const EXTRAPOLATE_MAX_MS = 320;
export const HOST_TIMEOUT_MS = 8000;
const BLEND_THRESHOLD_M = 2.5;
const SNAP_THRESHOLD_M = 5;
const BLEND_PER_TICK = 0.05;
const RTT_PROBE_INTERVAL_MS = 2000;
const BUFFER_MAX = 30;

interface Stamped {
  at: number; // local arrival time (ms)
  snap: Snapshot;
}

export interface ClientRaceView {
  karts: readonly IKart[];
  totalLaps: number;
  /** Item manager in mirror mode (undefined when items are off). */
  items?: Pick<IItemManager, 'applyNetItems'>;
}

export class ClientSession {
  onPhase: ((phase: RacePhase, countdown: number) => void) | null = null;
  onResults: ((standings: StandingMsg[]) => void) | null = null;
  onHostLost: ((lastStandings: StandingMsg[]) => void) | null = null;
  /** A snapshot from a newer host epoch arrived (migration completed). */
  onHostChanged: ((account: string, hostEpoch: number) => void) | null = null;

  private race: ClientRaceView | null = null;
  private tick = 0;
  private seq = 0;
  private useSeq = 0;
  private readonly buffer: Stamped[] = [];
  /** Smoothed snapshot inter-arrival interval and its jitter (ms). */
  private arrivalMean = 60;
  /** Measured round trip to the relay, refreshed a couple of times a second. 0 = not measured. */
  private rttMs = 0;
  private rttProbeAt = 0;
  private rttProbeInFlight = false;
  private arrivalJitter = 10;
  private lastPhase: RacePhase = PHASE.grid;
  private lastSnapshotAt = 0;
  /** Per-tick inputs since the last send. */
  private readonly pending: NetInputSample[] = [];
  private lastLocal: NetKartPose | null = null;
  /** Clock reading when `lastLocal` arrived, so its age can be compensated for. */
  private lastLocalAt = 0;
  private hostLost = false;
  private hostEpoch = 0;
  private hostAccount = '';
  private resultsReceived = false;
  private mirroredLap = -1;
  private mirroredPlace = -1;
  private mirroredFinished = false;
  private readonly fxPos = new THREE.Vector3();

  constructor(
    private readonly transport: Transport,
    readonly roster: readonly RosterEntry[],
    readonly localKartId: number,
    private readonly now: () => number = () => performance.now(),
    initialHostEpoch = 0,
    initialHostAccount = '',
    register = true,
  ) {
    this.hostEpoch = initialHostEpoch;
    this.hostAccount = initialHostAccount;
    if (register) transport.onMessage((event, payload, from) => this.onMessage(event, payload, from));
  }

  /** Feed a relay message (used by OnlineController, which owns the transport handler). */
  handleMessage(event: string, payload: unknown, from: string): void {
    this.onMessage(event, payload, from);
  }

  get currentHost(): { account: string; hostEpoch: number } {
    return { account: this.hostAccount, hostEpoch: this.hostEpoch };
  }

  /** Newest snapshot (for a promoted host to adopt the world state). */
  latest(): Snapshot | null {
    return this.buffer[this.buffer.length - 1]?.snap ?? null;
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

  /** Call once per fixed physics tick, after the local kart stepped. `input` = the local kart's input. */
  tick60(input: InputState): void {
    const r = this.race;
    if (!r) return;
    this.tick++;
    if (input.useItem) this.useSeq = (this.useSeq + 1) & 0xff;
    // Every tick is recorded; the relay only lets us speak every 50 ms, so the ticks in between
    // ride along in the next batch instead of being thrown away.
    if (this.pending.length < INPUT_BATCH_MAX) {
      this.pending.push({
        steer: input.steer,
        throttle: input.throttle,
        brake: input.brake,
        drift: input.drift,
        useItemHeld: input.useItemHeld,
        lookBack: input.lookBack,
      });
    }
    if (this.tick % SNAPSHOT_EVERY === 0 && this.pending.length > 0) {
      this.seq = (this.seq + 1) & 0xffff;
      this.transport.send(
        MSG.INPUT,
        encodeInputBatch({ seq: this.seq, useSeq: this.useSeq, samples: this.pending }),
        true,
      );
      this.pending.length = 0;
    }
    this.probeRtt();
    this.applyInterpolated();
    this.reconcileLocal();
    if (!this.hostLost && !this.resultsReceived && this.buffer.length > 0 && this.now() - this.lastSnapshotAt > HOST_TIMEOUT_MS) {
      this.hostLost = true;
      this.onHostLost?.(this.standingsFromLatest());
    }
  }

  /**
   * Keeps a round-trip estimate alive. The reconciler needs to know how old the host's view of
   * this kart is, and the transport is the only thing that can say.
   */
  private probeRtt(): void {
    const t = this.now();
    if (this.rttProbeInFlight || t - this.rttProbeAt < RTT_PROBE_INTERVAL_MS) return;
    const ping = this.transport.ping;
    if (!ping) return;
    this.rttProbeAt = t;
    this.rttProbeInFlight = true;
    void Promise.resolve(ping.call(this.transport))
      .then((ms) => {
        if (typeof ms === 'number' && ms >= 0 && ms < 5000) {
          this.rttMs = this.rttMs > 0 ? this.rttMs + (ms - this.rttMs) * 0.3 : ms;
        }
      })
      .catch(() => {})
      .finally(() => {
        this.rttProbeInFlight = false;
      });
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
        // Split-brain guard: only the newest epoch counts, and within an epoch only its sender.
        if (snap.hostEpoch < this.hostEpoch) return;
        if (snap.hostEpoch === this.hostEpoch && this.hostAccount && from !== this.hostAccount) return;
        if (snap.hostEpoch > this.hostEpoch || !this.hostAccount) {
          const changed = this.hostAccount !== '' && from !== this.hostAccount;
          this.hostEpoch = snap.hostEpoch;
          this.hostAccount = from;
          this.hostLost = false; // a live host again
          // A new host restarts its tick counter: drop the old host's buffered snapshots so the
          // out-of-order guard below does not reject the new stream.
          if (changed) this.buffer.length = 0;
          if (changed) this.onHostChanged?.(from, snap.hostEpoch);
        }
        this.pushSnapshot(snap);
        return;
      }
      case MSG.FX: {
        if (!Array.isArray(payload)) return;
        for (const fx of payload as NetFx[]) this.replayFx(fx);
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

  /** Host item events → local event bus (HUD / audio / particles / post-fx react as offline). */
  private replayFx(fx: NetFx): void {
    const kartId = fx.k ?? -1;
    const isPlayer = kartId === this.localKartId;
    const p = fx.p ? this.fxPos.set(fx.p[0], fx.p[1], fx.p[2]).clone() : new THREE.Vector3();
    switch (fx.e) {
      case 'pickup':
        events.emit('item:pickup', { kartId, position: p, isPlayer });
        return;
      case 'rouletteEnd':
        events.emit('item:rouletteEnd', { kartId, item: fx.i ?? 'none', isPlayer });
        return;
      case 'use':
        events.emit('item:use', { kartId, item: fx.i ?? 'none', position: p, isPlayer });
        return;
      case 'hit':
        events.emit('item:hit', { kartId, item: fx.i ?? 'none', position: p, sourceKartId: fx.s ?? -1, isPlayer });
        return;
      case 'destroyed':
        events.emit('item:destroyed', { item: fx.i ?? 'none', position: p });
        return;
      case 'shellBounce':
        events.emit('item:shellBounce', { position: p });
        return;
      case 'explosion':
        events.emit('item:explosion', { position: p, radius: fx.r ?? 4 });
        return;
      case 'lightning':
        events.emit('item:lightning', { sourceKartId: fx.s ?? -1 });
        return;
      case 'boxRespawn':
        events.emit('item:boxRespawn', { position: p });
        return;
    }
  }

  private pushSnapshot(snap: Snapshot): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && snap.tick <= last.snap.tick) return; // out of order / duplicate
    const now = this.now();
    if (last) {
      const gap = Math.min(1000, now - last.at);
      this.arrivalJitter += (Math.abs(gap - this.arrivalMean) - this.arrivalJitter) * 0.15;
      this.arrivalMean += (gap - this.arrivalMean) * 0.15;
    }
    this.buffer.push({ at: now, snap });
    if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
    this.lastSnapshotAt = this.now();

    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      this.onPhase?.(snap.phase, snap.countdown);
    }
    const mine = snap.karts.find((k) => k.id === this.localKartId);
    if (mine) {
      this.lastLocal = mine;
      this.lastLocalAt = this.now();
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
    // Item slot + status flags are host-owned even for the predicted local kart.
    if ((k as IKart & { applyNetStatus?: (pose: NetKartPose) => void }).applyNetStatus) {
      (k as IKart & { applyNetStatus: (pose: NetKartPose) => void }).applyNetStatus(p);
    }
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
    // Render delay tracks the real arrival cadence: ~1.5 intervals + jitter, clamped.
    const delay = Math.min(INTERP_DELAY_MAX_MS, Math.max(INTERP_DELAY_MS, this.arrivalMean * 1.5 + this.arrivalJitter * 2));
    const renderAt = this.now() - delay;
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
    // Starved (no snapshot newer than renderAt): dead-reckon along each kart's heading so the
    // field keeps moving instead of freezing, up to EXTRAPOLATE_MAX_MS.
    const starve = renderAt - b.at;
    const extraS = starve > 0 ? Math.min(EXTRAPOLATE_MAX_MS, starve) / 1000 : 0;
    for (const pb of b.snap.karts) {
      if (pb.id === this.localKartId) continue;
      const k = r.karts[pb.id];
      if (!k || !k.applyNetState) continue;
      const pa = a.snap.karts.find((p) => p.id === pb.id) ?? pb;
      let x = pa.x + (pb.x - pa.x) * alpha;
      let z = pa.z + (pb.z - pa.z) * alpha;
      if (extraS > 0 && !pb.isFrozen && !pb.finished) {
        x += -Math.sin(pb.heading) * pb.speed * extraS;
        z += -Math.cos(pb.heading) * pb.speed * extraS;
      }
      k.applyNetState({
        ...pb,
        x,
        y: pa.y + (pb.y - pa.y) * alpha,
        z,
        heading: lerpAngle(pa.heading, pb.heading, alpha),
        speed: pa.speed + (pb.speed - pa.speed) * alpha,
      });
    }
    if (r.items?.applyNetItems) {
      const hazards: NetHazard[] = b.snap.items.hazards.map((hb) => {
        const ha = a.snap.items.hazards.find((h) => h.id === hb.id);
        if (!ha) return hb;
        return { ...hb, x: ha.x + (hb.x - ha.x) * alpha, y: ha.y + (hb.y - ha.y) * alpha, z: ha.z + (hb.z - ha.z) * alpha };
      });
      r.items.applyNetItems({ boxes: b.snap.items.boxes, hazards });
    }
  }

  /**
   * Pulls the locally predicted kart back toward the host's view of it.
   *
   * The host's view is old — it left one transit ago and describes a moment before that — so the
   * error mostly measures the distance covered since, not real disagreement. Correcting it hard
   * fights the prediction and shows up as the hitch clients reported: measured against a 250 ms
   * link with jitter, the old settings (0.6 m / 15% a tick) threw the kart 0.36 m in a single
   * tick, six times a normal step, and still ended up 7.3 m from the host. Letting prediction run
   * and only trimming (2.5 m / 5%) leaves 0.12 m and 5.6 m. Both numbers improve because the
   * correction is no longer adding energy of its own.
   *
   * Carrying the target forward by its age was tried and measured worse (0.57 m): a straight-line
   * projection overshoots on a curve, and the projection distance jitters with the link. The real
   * answer is rollback with input acknowledgements, which needs the client to re-simulate against
   * the track and is a bigger change than a launch eve deserves.
   */
  private reconcileLocal(): void {
    const r = this.race;
    const target = this.lastLocal;
    if (!r || !target) return;
    const k = r.karts[this.localKartId];
    if (!k || !k.applyNetState) return;
    const s = k.state;
    const tx = target.x;
    const tz = target.z;
    const dx = tx - s.position.x;
    const dy = target.y - s.position.y;
    const dz = tz - s.position.z;
    const err = Math.hypot(dx, dy, dz);
    if (err > SNAP_THRESHOLD_M) {
      k.applyNetState({ ...target, x: tx, z: tz, lap: s.lap, place: s.place, checkpointIndex: s.checkpointIndex });
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
