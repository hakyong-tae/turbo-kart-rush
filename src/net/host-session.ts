/**
 * Host side of an online race. The host browser runs the authoritative simulation (the normal
 * Game.step); this class only feeds remote inputs into karts, broadcasts snapshots every
 * SNAPSHOT_EVERY ticks, and relays start/results.
 */
import type { IKart, InputState } from '../core/types';
import { createEmptyInput } from '../core/types';
import { events } from '../core/events';
import {
  MSG,
  PHASE,
  decodeInput,
  encodeSnapshot,
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
}

export class HostSession {
  /** A human left; the host should attach an AI driver to their kart. */
  onHumanLeft: ((kartId: number) => void) | null = null;

  private race: HostRaceView | null = null;
  private tick = 0;
  private readonly inputs = new Map<number, InputState>();
  private readonly lastSeq = new Map<number, number>();
  private readonly loaded = new Set<string>();
  private readonly humans = new Set<string>();
  private readonly unsubs: (() => void)[] = [];
  private resultsSent = false;

  constructor(
    private readonly transport: Transport,
    readonly roster: readonly RosterEntry[],
  ) {
    for (const r of roster) this.humans.add(r.account);
    transport.onMessage((event, payload, from) => this.onMessage(event, payload, from));
    this.unsubs.push(
      events.on('race:allFinished', () => this.sendResults()),
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
      encodeSnapshot({ tick: this.tick, phase: r.phase(), countdown: r.countdown(), raceTime: r.raceTime(), karts }),
      true,
    );
  }

  /** Latest input for a remote human's kart (undefined = none received yet). */
  inputFor(kartId: number): InputState | undefined {
    return this.inputs.get(kartId);
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
  };
}

export const PHASE_OF = PHASE;
