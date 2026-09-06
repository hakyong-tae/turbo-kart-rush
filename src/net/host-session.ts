/**
 * Host side of an online race. The host browser runs the authoritative simulation (the normal
 * Game.step, items included); this class feeds remote inputs into karts, turns useSeq changes
 * into item-use requests, broadcasts snapshots every SNAPSHOT_EVERY ticks, batches item FX
 * events, and relays start/results.
 */
import type { IKart, InputState, NetItems } from '../core/types';
import { createEmptyInput } from '../core/types';
import { events } from '../core/events';
import {
  MSG,
  PHASE,
  decodeInput,
  encodeSnapshot,
  type NetFx,
  type NetKartPose,
  type RacePhase,
  type ResultsMsg,
  type RosterEntry,
  type StandingMsg,
  type StartMsg,
} from './protocol';
import { kartIdOf } from './roster';
import type { Transport } from './types';

export const SNAPSHOT_EVERY = 3; // ticks at 60 Hz → 50 ms, aligned to relayHot throttle 50

export interface HostRaceView {
  karts: readonly IKart[];
  phase: () => RacePhase;
  countdown: () => number;
  raceTime: () => number;
  standings: () => StandingMsg[];
  /** Item state source (undefined when items are off). */
  items?: () => NetItems;
}

export interface UseRequest {
  kartId: number;
  aimBack: boolean;
}

const EMPTY_ITEMS: NetItems = { boxes: [], hazards: [] };

export class HostSession {
  /** A human left; the host should attach an AI driver to their kart. */
  onHumanLeft: ((kartId: number) => void) | null = null;

  private race: HostRaceView | null = null;
  private tick = 0;
  private readonly inputs = new Map<number, InputState>();
  private readonly lastSeq = new Map<number, number>();
  private readonly lastUseSeq = new Map<number, number>();
  private useRequests: UseRequest[] = [];
  private readonly loaded = new Set<string>();
  private readonly humans = new Set<string>();
  private readonly unsubs: (() => void)[] = [];
  private fx: NetFx[] = [];
  private resultsSent = false;

  constructor(
    private readonly transport: Transport,
    readonly roster: readonly RosterEntry[],
  ) {
    for (const r of roster) this.humans.add(r.account);
    transport.onMessage((event, payload, from) => this.onMessage(event, payload, from));
    const pos = (p: { x: number; y: number; z: number }): [number, number, number] => [p.x, p.y, p.z];
    this.unsubs.push(
      events.on('race:allFinished', () => this.sendResults()),
      events.on('item:pickup', (e) => this.fx.push({ e: 'pickup', k: e.kartId, p: pos(e.position) })),
      events.on('item:rouletteEnd', (e) => this.fx.push({ e: 'rouletteEnd', k: e.kartId, i: e.item })),
      events.on('item:use', (e) => this.fx.push({ e: 'use', k: e.kartId, i: e.item, p: pos(e.position) })),
      events.on('item:hit', (e) => this.fx.push({ e: 'hit', k: e.kartId, i: e.item, s: e.sourceKartId, p: pos(e.position) })),
      events.on('item:destroyed', (e) => this.fx.push({ e: 'destroyed', i: e.item, p: pos(e.position) })),
      events.on('item:shellBounce', (e) => this.fx.push({ e: 'shellBounce', p: pos(e.position) })),
      events.on('item:explosion', (e) => this.fx.push({ e: 'explosion', p: pos(e.position), r: e.radius })),
      events.on('item:lightning', (e) => this.fx.push({ e: 'lightning', s: e.sourceKartId })),
      events.on('item:boxRespawn', (e) => this.fx.push({ e: 'boxRespawn', p: pos(e.position) })),
    );
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  /** Everyone but the host has reported LOADED. */
  get allLoaded(): boolean {
    for (const r of this.roster) {
      if (r.account === this.transport.account) continue;
      if (this.humans.has(r.account) && !this.loaded.has(r.account)) return false;
    }
    return true;
  }

  sendStart(msg: StartMsg): void {
    this.transport.send(MSG.START, msg);
  }

  attach(race: HostRaceView): void {
    this.race = race;
    this.tick = 0;
    this.resultsSent = false;
    this.fx.length = 0;
  }

  /** Call once per fixed physics tick, after the simulation stepped. */
  tick60(): void {
    const r = this.race;
    if (!r) return;
    this.tick++;
    if (this.tick % SNAPSHOT_EVERY !== 0) return;
    const karts: NetKartPose[] = r.karts.map((k) => poseOf(k));
    this.transport.send(
      MSG.SNAPSHOT,
      encodeSnapshot({
        tick: this.tick,
        phase: r.phase(),
        countdown: r.countdown(),
        raceTime: r.raceTime(),
        karts,
        items: r.items ? r.items() : EMPTY_ITEMS,
      }),
      true,
    );
    if (this.fx.length > 0) {
      const batch = this.fx;
      this.fx = [];
      this.transport.send(MSG.FX, batch);
    }
  }

  /** Latest input for a remote human's kart (undefined = none received yet). */
  inputFor(kartId: number): InputState | undefined {
    return this.inputs.get(kartId);
  }

  /** Item-use presses received since the last call (one per useSeq change). */
  takeUseRequests(): UseRequest[] {
    if (this.useRequests.length === 0) return this.useRequests;
    const out = this.useRequests;
    this.useRequests = [];
    return out;
  }

  /** A remote human dropped out of the room. */
  markLeft(account: string): void {
    if (!this.humans.delete(account)) return;
    const id = kartIdOf(this.roster, account);
    if (id !== null) {
      this.inputs.delete(id);
      this.onHumanLeft?.(id);
    }
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.race = null;
  }

  private onMessage(event: string, payload: unknown, from: string): void {
    if (from === this.transport.account) return;
    switch (event) {
      case MSG.INPUT: {
        if (!(payload instanceof ArrayBuffer)) return;
        const id = kartIdOf(this.roster, from);
        if (id === null) return;
        const inp = decodeInput(payload);
        const prev = this.lastSeq.get(id);
        // Drop stale packets (wrap-safe 16-bit compare).
        if (prev !== undefined && ((inp.seq - prev) & 0xffff) > 0x8000) return;
        this.lastSeq.set(id, inp.seq);
        let s = this.inputs.get(id);
        if (!s) {
          s = createEmptyInput();
          this.inputs.set(id, s);
        }
        s.steer = inp.steer;
        s.throttle = inp.throttle;
        s.brake = inp.brake;
        s.drift = inp.drift;
        s.useItemHeld = inp.useItemHeld;
        s.lookBack = inp.lookBack;
        const prevUse = this.lastUseSeq.get(id);
        if (prevUse !== undefined && prevUse !== inp.useSeq) {
          this.useRequests.push({ kartId: id, aimBack: inp.brake > 0.5 || inp.lookBack });
        }
        this.lastUseSeq.set(id, inp.useSeq);
        return;
      }
      case MSG.LOADED:
        this.loaded.add(from);
        return;
      case MSG.LEAVE:
        this.markLeft(from);
        return;
    }
  }

  private sendResults(): void {
    const r = this.race;
    if (!r || this.resultsSent) return;
    this.resultsSent = true;
    const msg: ResultsMsg = { standings: r.standings() };
    this.transport.send(MSG.RESULTS, msg);
  }
}

export function poseOf(k: IKart): NetKartPose {
  const s = k.state;
  return {
    id: s.id,
    x: s.position.x,
    y: s.position.y,
    z: s.position.z,
    heading: s.heading,
    speed: s.speed,
    isDrifting: s.isDrifting,
    isBoosting: s.isBoosting,
    isAirborne: s.isAirborne,
    isSpinning: s.isSpinning,
    isFrozen: s.isFrozen,
    finished: s.finished,
    wrongWay: s.wrongWay,
    driftStage: s.driftStage,
    lap: s.lap,
    place: s.place,
    checkpointIndex: s.checkpointIndex,
    finishTime: s.finishTime,
    isInvincible: s.isInvincible,
    isShrunk: s.isShrunk,
    isSquished: s.isSquished,
    isHopping: s.isHopping,
    item: s.item,
    itemCount: s.itemCount,
    rouletteActive: s.itemRouletteActive,
  };
}

export const PHASE_OF = PHASE;
