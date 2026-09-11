/**
 * Client side of an online race. Sends the local input at SNAPSHOT_EVERY ticks, buffers host
 * snapshots, interpolates remote karts and hazards 100 ms behind, reconciles the locally
 * predicted kart, mirrors item boxes / item slots / status flags, re-emits batched item FX
 * events, and mirrors phase / lap / place / finish of the local kart as the usual race events.
 */
import * as THREE from 'three';
import { createEmptyInput, type IItemManager, type IKart, type InputState, type NetHazard } from '../core/types';
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
import { createKartSave, type KartSave } from '../kart/Kart';
import { SNAPSHOT_EVERY } from './host-session';
import type { Transport } from './types';

/** Base render delay behind the newest snapshot; adapts upward with measured arrival jitter. */
export const INTERP_DELAY_MS = 100;
const INTERP_DELAY_MAX_MS = 260;
/** How far a starved client keeps karts moving along their last heading before freezing. */
const EXTRAPOLATE_MAX_MS = 320;
export const HOST_TIMEOUT_MS = 8000;
const BLEND_THRESHOLD_M = 4.5;
const SNAP_THRESHOLD_M = 5;
const BLEND_PER_TICK = 0.05;
const RTT_PROBE_INTERVAL_MS = 2000;
const BUFFER_MAX = 30;

interface Stamped {
  at: number; // local arrival time (ms)
  snap: Snapshot;
}

/** One predicted tick: the input this client applied and a full save of the kart afterwards. */
interface PredictedTick {
  seq: number;
  sample: NetInputSample;
  save: KartSave;
}

/**
 * How many predicted ticks to keep. Three seconds at 120 Hz, because the tick a host acknowledges
 * is older than it looks: the input travelled there, waited its turn in the queue, and the
 * snapshot carrying the acknowledgement travelled back. On a 250 ms link with jitter that is
 * comfortably past a second, and a history that cannot reach the acknowledged tick falls back to
 * blending — which is the behaviour this exists to replace.
 */
const HISTORY_TICKS = 360;
/**
 * How far the prediction may sit from the host's version of the same tick before it is rewound.
 * Below this the two agree for practical purposes, and touching the kart would only add jitter.
 */
const REWIND_EPS_M = 0.12;

export interface ClientRaceView {
  karts: readonly IKart[];
  totalLaps: number;
  /** Item manager in mirror mode (undefined when items are off). */
  items?: Pick<IItemManager, 'applyNetItems'>;
  /**
   * Steps one kart through one fixed tick with the given input. The net layer knows which inputs
   * must be replayed after a correction but nothing about tracks or timesteps, so the game hands
   * it the step. Without it the session falls back to blending.
   */
  replay?: (kart: IKart, input: InputState) => void;
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
  private pendingFirstSeq = 0;
  /** Sequence of the next input sample this client will produce. */
  private inputSeq = 0;
  /**
   * What this client predicted, tick by tick: the input it applied and a full save of the kart
   * afterwards. A second of it outlasts any round trip worth correcting. Preallocated and reused,
   * because this is written 120 times a second.
   */
  private readonly history: PredictedTick[] = [];
  private historyAt = 0;
  private readonly replayInput: InputState = createEmptyInput();
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
    const seq = this.inputSeq & 0xffff;
    this.inputSeq = (this.inputSeq + 1) & 0xffff;
    this.record(seq, input);
    if (this.pending.length === 0) this.pendingFirstSeq = seq;
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
      this.transport.send(
        MSG.INPUT,
        encodeInputBatch({ seq: this.pendingFirstSeq, useSeq: this.useSeq, samples: this.pending }),
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

  /** Saves the kart as it stands, right after it stepped, so a rewind has somewhere to go. */
  private record(seq: number, input: InputState): void {
    const k = this.race?.karts[this.localKartId];
    if (!k?.save) return;
    let slot = this.history[this.historyAt];
    if (!slot) {
      slot = { seq, sample: { steer: 0, throttle: 0, brake: 0, drift: false, useItemHeld: false, lookBack: false }, save: createKartSave() };
      this.history[this.historyAt] = slot;
    }
    slot.seq = seq;
    slot.sample.steer = input.steer;
    slot.sample.throttle = input.throttle;
    slot.sample.brake = input.brake;
    slot.sample.drift = input.drift;
    slot.sample.useItemHeld = input.useItemHeld;
    slot.sample.lookBack = input.lookBack;
    k.save(slot.save);
    this.historyAt = (this.historyAt + 1) % HISTORY_TICKS;
  }

  /** History entry for `seq`, or null when it has already scrolled out of the ring. */
  private historyFor(seq: number): number {
    for (let i = 0; i < this.history.length; i++) {
      if (this.history[i]?.seq === seq) return i;
    }
    return -1;
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
   * Two better-sounding ideas were built and measured worse, so they are not here:
   *
   * Carrying the target forward by its age overshoots on a curve and the projection distance
   * jitters with the link (0.57 m a tick).
   *
   * Rollback with input acknowledgements — rewind to the acknowledged tick, replay everything
   * since — needs the kart's whole simulation state at that tick, and the snapshot carries only
   * the networked fields. Lateral velocity, slip, vertical velocity, ground contact and the drift
   * and boost timers are not in it, so a replay starts from a state neither end ever occupied and
   * produces a third trajectory: 0.83 m a tick, seven times a normal step. Doing it properly
   * means putting the full kart state on the wire, which is a protocol change that wants two real
   * devices to validate.
   */
  private reconcileLocal(): void {
    const r = this.race;
    const target = this.lastLocal;
    if (!r || !target) return;
    const k = r.karts[this.localKartId];
    if (!k || !k.applyNetState) return;

    // With an acknowledgement, a full save of the tick it names, and a way to step the kart, the
    // disagreement can be settled exactly instead of smoothed over.
    if (r.replay && k.save && k.restore && target.ack !== undefined && this.rewind(k, target, r.replay)) return;

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

  /**
   * Settles the local kart against the host's last word about it.
   *
   * The host says "after your input N, your kart was here". That tick is in our history, so the
   * only question worth asking is whether the prediction was right. Usually it was — both ends
   * run the same inputs through the same physics — and then nothing is touched at all, which is
   * why the kart stops twitching.
   *
   * When it was not, the kart is restored to our own full save of tick N (velocity, slip, ground
   * contact, drift and boost timers — none of which travel in a snapshot), the networked fields
   * are overwritten with what the host says, and every input since is replayed through the real
   * simulation. The result is where the kart would have been had we known earlier, rather than a
   * blend toward a pose that is already out of date.
   *
   * Returns false when the history no longer reaches that far, leaving the blend to cope.
   */
  private rewind(k: IKart, target: NetKartPose, replay: (kart: IKart, input: InputState) => void): boolean {
    const ack = target.ack ?? 0;
    const at = this.historyFor(ack);
    if (at < 0) return false;
    const entry = this.history[at];
    const save = entry.save as unknown as KartSave;
    const dx = (save.state.position as THREE.Vector3).x - target.x;
    const dy = (save.state.position as THREE.Vector3).y - target.y;
    const dz = (save.state.position as THREE.Vector3).z - target.z;
    if (Math.hypot(dx, dy, dz) <= REWIND_EPS_M) {
      // The host agreed with us about that tick, so everything predicted since still stands.
      if (k.state.isFrozen !== target.isFrozen) k.setFrozen(target.isFrozen);
      return true;
    }

    const s = k.state;
    // Where the player is currently being shown, so the difference can be handed to the model.
    const seenX = s.position.x, seenY = s.position.y, seenZ = s.position.z;
    k.restore?.(entry.save);
    k.applyNetState?.({ ...target, lap: s.lap, place: s.place, checkpointIndex: s.checkpointIndex });
    // Replaying re-lives those ticks: without silencing them the kart would announce a second set
    // of drifts, boosts and landings for events the player already saw and heard.
    events.silenced(() => {
      for (let i = 1; i < HISTORY_TICKS; i++) {
        const slot = this.history[(at + i) % HISTORY_TICKS];
        if (!slot || ((slot.seq - ack) & 0xffff) > 0x8000 || slot.seq === ack) break;
        this.replayInput.steer = slot.sample.steer;
        this.replayInput.throttle = slot.sample.throttle;
        this.replayInput.brake = slot.sample.brake;
        this.replayInput.drift = slot.sample.drift;
        this.replayInput.useItemHeld = slot.sample.useItemHeld;
        this.replayInput.lookBack = slot.sample.lookBack;
        replay(k, this.replayInput);
        // The corrected path becomes the new history, or the next rewind starts from fiction.
        k.save?.(slot.save);
      }
    });
    // The simulation now holds the corrected position; the model is told to carry the difference
    // so the player sees a slide rather than a jump.
    k.absorbCorrection?.(seenX - s.position.x, seenY - s.position.y, seenZ - s.position.z);
    return true;
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
