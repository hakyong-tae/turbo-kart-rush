/**
 * Online race orchestration: owns the transport + lobby, turns a room into RaceSettings when
 * START fires, and wires host/client sessions to the running race. Game.ts talks only to this.
 *
 * mode 'real'     → agent8 relay (inside the Verse8 host)
 * mode 'loopback' → in-page hub with one bot racer (local demo / tests)
 */
import type { Difficulty, IItemManager, IKart, InputState, RaceSettings } from '../core/types';
import { createEmptyInput } from '../core/types';
import { CHARACTERS } from '../kart/roster';
import type { RaceManager } from '../game/RaceManager';
import { ClientSession } from './client-session';
import { HostSession } from './host-session';
import { Lobby } from './lobby';
import { createLoopbackHub, type LoopbackHub } from './loopback';
import { MSG, PHASE, encodeInput, type RacePhase, type RosterEntry, type Snapshot, type StandingMsg, type StartMsg } from './protocol';
import { buildRoster, kartIdOf, pickNextHost } from './roster';
import { HOST_TIMEOUT_MS } from './client-session';
import { makeAgent8Transport } from './transport';
import type { Transport } from './types';

export type OnlineMode = 'real' | 'loopback';

export interface OnlineRaceHooks {
  karts: readonly IKart[];
  raceManager: RaceManager;
  totalLaps: number;
  roster: readonly RosterEntry[];
  /** Item manager (host: authority source, client: mirror sink). Omit when items are off. */
  items?: IItemManager;
  /**
   * Steps one kart through one fixed tick. A client replays its own inputs through this after the
   * host corrects it; only the game knows the track and the timestep.
   */
  replay?: (kart: IKart, input: InputState) => void;
}

const PHASE_MAP: Record<string, RacePhase> = {
  grid: PHASE.grid,
  countdown: PHASE.countdown,
  racing: PHASE.racing,
  complete: PHASE.complete,
};

export class OnlineController {
  /** Fired on host and clients alike when a race should start. */
  onRaceStart: ((settings: RaceSettings) => void) | null = null;
  onPhase: ((phase: RacePhase) => void) | null = null;
  onResults: ((standings: StandingMsg[]) => void) | null = null;
  onHostLost: ((standings: StandingMsg[]) => void) | null = null;
  onHumanLeft: ((kartId: number, nick: string) => void) | null = null;
  /** We were promoted to host mid-race; adopt the last mirrored snapshot (may be null). */
  onPromoted: ((snapshot: Snapshot | null) => void) | null = null;
  onHostChanged: ((nick: string) => void) | null = null;
  onMigrating: (() => void) | null = null;

  readonly transport: Transport;
  readonly lobby: Lobby;
  hostSession: HostSession | null = null;
  clientSession: ClientSession | null = null;
  roster: RosterEntry[] = [];
  private hub: LoopbackHub | null = null;
  private bot: LoopbackBot | null = null;
  private hostEpoch = 0;
  private readonly gone = new Set<string>();
  private migrationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly mode: OnlineMode,
    private readonly me: { nick: string; characterId: string; cos?: string },
    defaults: { trackId: string; difficulty: Difficulty; laps: number },
  ) {
    if (mode === 'loopback') {
      this.hub = createLoopbackHub();
      this.transport = this.hub.endpoint('me');
    } else {
      this.transport = makeAgent8Transport();
    }
    this.lobby = new Lobby(this.transport, me, defaults);
    this.transport.onMessage((event, payload, from) => this.onMessage(event, payload, from));
    // Mobile: leaving to copy the code into a chat app and coming back must not desync the room.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') window.addEventListener('pageshow', this.onVisibility);
  }

  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!this.lobby.key) return;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      // Mid-race the room must not be re-entered — that would republish a lobby entry over a
      // running race — but the membership still has to be checked, because a race whose player
      // has been dropped from the room stops receiving anything at all.
      if (this.hostSession || this.clientSession) void this.lobby.repair();
      else void this.lobby.resume();
    }, 400);
  };

  get isHost(): boolean {
    return this.lobby.view.isHost;
  }

  get localKartId(): number {
    return kartIdOf(this.roster, this.transport.account) ?? 0;
  }

  async connect(): Promise<Transport['status']> {
    const st = await this.transport.connect();
    if (this.mode === 'loopback' && this.hub) {
      this.bot = new LoopbackBot(this.hub.endpoint('bot'));
    }
    return st;
  }

  /** Loopback demo: after we are in a room, the bot joins and readies up. */
  async inviteBot(): Promise<void> {
    if (this.bot && this.lobby.key) await this.bot.join(this.lobby.key);
  }

  /**
   * Renames me everywhere it shows. The identity is captured when the controller is built, which
   * on a cold start can be before the account's nickname has arrived — that is how a room full of
   * players all called RACER happens. Called again whenever the nickname changes.
   */
  setNick(nick: string): void {
    if (!nick || nick === this.me.nick) return;
    this.me.nick = nick;
    void this.lobby.setNick(nick).catch(() => {});
  }

  /** Host: freeze the roster, announce START, and start locally. */
  async startRaceAsHost(): Promise<void> {
    const v = this.lobby.view;
    if (!v.isHost) return;
    this.hostEpoch++;
    const roster = buildRoster(
      v.players.map((p) => ({
        account: p.account,
        nick: p.nick,
        characterId: p.characterId,
        joinedAt: p.joinedAt,
        cos: p.cos,
      })),
      v.hostAccount,
    );
    const msg: StartMsg = { trackId: v.trackId, difficulty: v.difficulty, laps: v.laps, roster, hostEpoch: this.hostEpoch, items: v.items };
    await this.lobby.setStarted(true).catch(() => {});
    this.beginRace(msg, 'host');
    this.hostSession?.sendStart(msg);
  }

  /** Game calls this once the race objects exist (both roles). */
  attachRace(hooks: OnlineRaceHooks): void {
    if (this.hostSession) {
      const rm = hooks.raceManager;
      this.hostSession.attach({
        karts: hooks.karts,
        phase: () => PHASE_MAP[rm.currentPhase] ?? PHASE.grid,
        countdown: () => 0,
        raceTime: () => rm.raceTime,
        items: hooks.items?.getNetItems ? () => hooks.items!.getNetItems!() : undefined,
        standings: () =>
          rm.getStandings().map((s) => ({
            kartId: s.kartId,
            name: this.nickOf(s.kartId) ?? s.name,
            color: s.color,
            place: s.place,
            finishTime: s.finishTime,
            account: this.roster.find((r) => r.kartId === s.kartId)?.account,
          })),
      });
    }
    if (this.clientSession) {
      this.clientSession.attach({
        karts: hooks.karts,
        totalLaps: hooks.totalLaps,
        items: hooks.items?.applyNetItems ? hooks.items : undefined,
        replay: hooks.replay,
      });
      this.clientSession.sendLoaded();
    }
  }

  /** Host: apply the latest remote inputs to the karts they drive, then fire their item uses. */
  applyRemoteInputs(karts: readonly IKart[], items?: IItemManager): void {
    const hs = this.hostSession;
    if (!hs) return;
    for (const r of this.roster) {
      if (r.kartId === this.localKartId) continue;
      const inp = hs.inputFor(r.kartId);
      if (inp) karts[r.kartId]?.setInput(inp);
    }
    if (items) {
      for (const req of hs.takeUseRequests()) {
        const k = karts[req.kartId];
        if (k) items.requestUse(k, req.aimBack);
      }
    }
  }

  nickOf(kartId: number): string | null {
    return this.roster.find((r) => r.kartId === kartId)?.nick ?? null;
  }

  isHumanKart(kartId: number): boolean {
    return this.roster.some((r) => r.kartId === kartId);
  }

  /** After results: back to the room (host clears READY + started). */
  async backToRoom(): Promise<void> {
    this.teardownSessions();
    if (this.lobby.view.isHost) {
      await this.lobby.setStarted(false).catch(() => {});
      await this.lobby.resetReady().catch(() => {});
    }
  }

  async leave(): Promise<void> {
    this.clientSession?.sendLeave();
    this.teardownSessions();
    await this.lobby.leave().catch(() => {});
  }

  dispose(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('pageshow', this.onVisibility);
    this.teardownSessions();
    this.lobby.dispose();
    this.bot?.dispose();
  }

  // ------------------------------------------------------------------ private

  isGone(account: string): boolean {
    return this.gone.has(account);
  }

  private onMessage(event: string, payload: unknown, from: string): void {
    this.hostSession?.handleMessage(event, payload, from);
    this.clientSession?.handleMessage(event, payload, from);
    if (event === MSG.LEAVE) {
      const acct = (payload as { account?: string })?.account ?? from;
      this.gone.add(acct);
    }
    if (event === MSG.START && from !== this.transport.account) {
      const msg = payload as StartMsg;
      if (!msg || !Array.isArray(msg.roster)) return;
      if (kartIdOf(msg.roster, this.transport.account) === null) return; // not in this race
      this.beginRace(msg, 'client');
    } else if (event === MSG.LEAVE) {
      const acct = (payload as { account?: string })?.account ?? from;
      const entry = this.roster.find((r) => r.account === acct);
      if (entry) this.onHumanLeft?.(entry.kartId, entry.nick);
    }
  }

  private beginRace(msg: StartMsg, role: 'host' | 'client'): void {
    this.teardownSessions();
    this.roster = msg.roster;
    this.hostEpoch = msg.hostEpoch;
    const localKartId = kartIdOf(msg.roster, this.transport.account) ?? 0;
    this.gone.clear();
    if (role === 'host') {
      this.hostSession = new HostSession(this.transport, msg.roster, msg.hostEpoch, false);
      this.hostSession.onHumanLeft = (id) => this.onHumanLeft?.(id, this.nickOf(id) ?? '?');
    } else {
      const hostAccount = msg.roster.find((r) => r.kartId === 0)?.account ?? '';
      this.clientSession = new ClientSession(this.transport, msg.roster, localKartId, () => performance.now(), msg.hostEpoch, hostAccount, false);
      this.clientSession.onPhase = (p) => this.onPhase?.(p);
      this.clientSession.onResults = (s) => this.onResults?.(s);
      this.clientSession.onHostLost = (s) => this.handleHostLost(s);
      this.clientSession.onHostChanged = (acct, epoch) => {
        this.hostEpoch = epoch;
        this.clearMigrationTimer();
        this.onHostChanged?.(this.roster.find((r) => r.account === acct)?.nick ?? acct);
      };
    }
    const me = msg.roster.find((r) => r.kartId === localKartId);
    const settings: RaceSettings = {
      characterId: me?.characterId ?? this.me.characterId,
      trackId: msg.trackId,
      difficulty: msg.difficulty as Difficulty,
      laps: msg.laps,
      online: { role, roster: msg.roster, localKartId, items: msg.items !== false },
    };
    this.onRaceStart?.(settings);
  }

  // ------------------------------------------------------------ host migration

  /** The current host stopped sending snapshots: the earliest remaining racer takes over. */
  private handleHostLost(standings: StandingMsg[]): void {
    const cs = this.clientSession;
    if (!cs) return;
    const oldHost = cs.currentHost.account || this.roster.find((r) => r.kartId === 0)?.account || '';
    if (oldHost) this.gone.add(oldHost);
    const next = pickNextHost(this.roster, this.gone);
    if (!next) {
      this.onHostLost?.(standings);
      return;
    }
    if (next.account === this.transport.account) {
      this.promote();
      return;
    }
    // Somebody else should promote; if their snapshots never show up, skip them and retry.
    this.onMigrating?.();
    this.clearMigrationTimer();
    this.migrationTimer = setTimeout(() => {
      this.migrationTimer = null;
      const live = this.clientSession;
      if (!live || live.currentHost.account !== oldHost) return; // a new host took over
      this.gone.add(next.account);
      this.handleHostLost(live.standingsFromLatest());
    }, HOST_TIMEOUT_MS);
  }

  private promote(): void {
    const cs = this.clientSession;
    const snap = cs?.latest() ?? null;
    const epoch = Math.max(this.hostEpoch, cs?.currentHost.hostEpoch ?? 0) + 1;
    this.hostEpoch = epoch;
    cs?.dispose();
    this.clientSession = null;
    const hs = new HostSession(this.transport, this.roster, epoch, false);
    hs.markGone(this.gone);
    hs.markAllLoaded();
    hs.onHumanLeft = (id) => this.onHumanLeft?.(id, this.nickOf(id) ?? '?');
    this.hostSession = hs;
    void this.transport.updateRoomState({ hostAccount: this.transport.account, hostEpoch: epoch }).catch(() => {});
    this.onPromoted?.(snap); // Game re-attaches the race → hs.attach(...), then we announce
    hs.announce();
  }

  private clearMigrationTimer(): void {
    if (this.migrationTimer) clearTimeout(this.migrationTimer);
    this.migrationTimer = null;
  }

  private teardownSessions(): void {
    this.clearMigrationTimer();
    this.hostSession?.dispose();
    this.clientSession?.dispose();
    this.hostSession = null;
    this.clientSession = null;
  }
}

/**
 * Loopback demo racer: joins, readies up, and on START drives flat out with a gentle steer so
 * the host has something to simulate. No local simulation of its own.
 */
class LoopbackBot {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private useSeq = 0;
  private started = false;

  constructor(private readonly t: Transport) {
    t.onMessage((event, payload, from) => {
      if (from === t.account) return;
      if (event === MSG.START) {
        this.started = true;
        this.t.send(MSG.LOADED, { account: t.account });
      } else if (event === MSG.RESULTS) {
        this.started = false;
      }
    });
  }

  async join(key: string): Promise<void> {
    await this.t.joinRoom(key);
    await this.t.updateRoomState({
      ['p_' + this.t.account]: { nick: 'Bot', characterId: CHARACTERS[4]?.id ?? 'juno', ready: true, joinedAt: Date.now() },
    });
    this.timer = setInterval(() => this.pump(), 50);
  }

  private pump(): void {
    if (!this.started) return;
    this.seq = (this.seq + 1) & 0xffff;
    if (this.seq % 60 === 0) this.useSeq = (this.useSeq + 1) & 0xff;
    const input = { ...createEmptyInput(), throttle: 1, steer: 0 };
    this.t.send(
      MSG.INPUT,
      encodeInput({ seq: this.seq, steer: input.steer, throttle: input.throttle, brake: 0, drift: false, useItemHeld: false, lookBack: false, useSeq: this.useSeq }),
      true,
    );
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
