/**
 * Room lobby state machine over a Transport: quick/code/create join, ready toggles, host
 * settings, heartbeat, and a derived view for the UI. No DOM here.
 */
import type { Difficulty } from '../core/types';
import { playersOf, type RoomPlayer, type RoomState, type Transport } from './types';

export interface LobbyPlayerView {
  account: string;
  nick: string;
  characterId: string;
  /** Packed garage look, shown in the lobby list and carried into the race roster. */
  cos?: string;
  ready: boolean;
  isHost: boolean;
  isMe: boolean;
  ping: number;
  joinedAt: number;
}

export interface LobbyView {
  roomKey: string | null;
  isHost: boolean;
  hostAccount: string;
  trackId: string;
  difficulty: Difficulty;
  laps: number;
  items: boolean;
  started: boolean;
  players: LobbyPlayerView[];
  /** ≥ 2 humans and everyone ready. */
  canStart: boolean;
}

export const HEARTBEAT_MS = 5000;

export class Lobby {
  onChange: ((view: LobbyView) => void) | null = null;

  private roomKey: string | null = null;
  private state: RoomState = {};
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly me: { nick: string; characterId: string; cos?: string },
    private readonly defaults: { trackId: string; difficulty: Difficulty; laps: number },
  ) {
    transport.onRoomState((s) => {
      this.state = s;
      this.emit();
    });
  }

  get view(): LobbyView {
    return this.derive();
  }

  get key(): string | null {
    return this.roomKey;
  }

  async quickJoin(): Promise<string> {
    return this.enter(await this.transport.joinRoom(null));
  }

  async joinCode(code: string): Promise<string> {
    return this.enter(await this.transport.joinRoom(code.trim().toUpperCase()));
  }

  async create(): Promise<string> {
    return this.enter(await this.transport.createRoom());
  }

  /**
   * After the app was backgrounded (mobile tab switch) the relay membership may be gone while
   * our local view still shows the room. Re-join the same key and re-publish our player entry;
   * if the room moved on (new host), the fresh state simply wins.
   */
  async resume(): Promise<void> {
    const key = this.roomKey;
    if (!key) return;
    try {
      await this.transport.joinRoom(key);
      await this.enter(key);
    } catch (e) {
      console.warn('[net] resume failed', e);
    }
  }

  async leave(): Promise<void> {
    this.stopHeartbeat();
    if (this.roomKey) await this.transport.leaveRoom();
    this.roomKey = null;
    this.state = {};
    this.emit();
  }

  async setReady(ready: boolean): Promise<void> {
    await this.patchMe({ ready });
  }

  async setCharacter(characterId: string): Promise<void> {
    this.me.characterId = characterId;
    await this.patchMe({ characterId, ready: false });
  }

  async setNick(nick: string): Promise<void> {
    this.me.nick = nick;
    await this.patchMe({ nick });
  }

  /** Host only. */
  async setSettings(patch: Partial<{ trackId: string; difficulty: Difficulty; laps: number; items: boolean }>): Promise<void> {
    if (!this.derive().isHost) return;
    await this.transport.updateRoomState({ ...patch });
  }

  /** Host only: flag the room as racing (hides it from quick-join). */
  async setStarted(started: boolean): Promise<void> {
    if (!this.derive().isHost) return;
    await this.transport.updateRoomState({ started });
    if (this.roomKey) await this.transport.touchRoom?.(this.roomKey, this.derive().trackId, started).catch(() => {});
  }

  /** Everyone back to not-ready (host, after a race). */
  async resetReady(): Promise<void> {
    const patch: Record<string, unknown> = {};
    for (const { account, player } of playersOf(this.state)) patch['p_' + account] = { ...player, ready: false };
    await this.transport.updateRoomState(patch);
  }

  dispose(): void {
    this.stopHeartbeat();
  }

  // ------------------------------------------------------------------ private

  private async enter(key: string): Promise<string> {
    this.roomKey = key;
    const current = await this.transport.getRoomState();
    this.state = current;
    const patch: Record<string, unknown> = {};
    const players = playersOf(current);
    const hostAlive = current.hostAccount && players.some((p) => p.account === current.hostAccount);
    if (!hostAlive) {
      patch.hostAccount = this.transport.account;
      patch.hostEpoch = ((current.hostEpoch as number) ?? 0) + 1;
      if (!current.trackId) patch.trackId = this.defaults.trackId;
      if (!current.difficulty) patch.difficulty = this.defaults.difficulty;
      if (!current.laps) patch.laps = this.defaults.laps;
      patch.items = true;
      patch.started = false;
    }
    const mine: RoomPlayer = {
      nick: this.me.nick,
      characterId: this.me.characterId,
      ready: false,
      joinedAt: Date.now(),
      cos: this.me.cos,
    };
    patch['p_' + this.transport.account] = mine;
    await this.transport.updateRoomState(patch);
    this.state = await this.transport.getRoomState();
    this.startHeartbeat();
    this.emit();
    return key;
  }

  private async patchMe(patch: Partial<RoomPlayer>): Promise<void> {
    const cur = this.state['p_' + this.transport.account] as RoomPlayer | undefined;
    const base: RoomPlayer =
      cur ?? { nick: this.me.nick, characterId: this.me.characterId, ready: false, joinedAt: Date.now(), cos: this.me.cos };
    await this.transport.updateRoomState({ ['p_' + this.transport.account]: { ...base, ...patch } });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.roomKey) return;
      const v = this.derive();
      if (v.isHost && this.transport.touchRoom) {
        this.transport.touchRoom(this.roomKey, v.trackId, v.started).catch((e) => console.warn('[net] touchRoom failed', e));
      }
      void this.repair();
    }, HEARTBEAT_MS);
  }

  /**
   * Puts us back in the room if it has forgotten us.
   *
   * A phone that goes to another app stops running timers and may lose the relay subscription;
   * coming back, the local view still shows the room while the room no longer lists the player.
   * Rather than trying to enumerate the ways that happens, this checks the one thing that
   * matters — am I in the room state — and re-publishes the entry when I am not. Runs on the
   * heartbeat and on every return to the foreground, and costs one state read when all is well.
   */
  async repair(): Promise<void> {
    const key = this.roomKey;
    if (!key) return;
    try {
      const state = await this.transport.getRoomState();
      const mine = state['p_' + this.transport.account];
      if (mine && typeof mine === 'object') {
        this.state = state;
        this.emit();
        return;
      }
      await this.transport.joinRoom(key);
      await this.enter(key);
    } catch (e) {
      console.warn('[net] room repair failed', e);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private derive(): LobbyView {
    const s = this.state;
    const hostAccount = (s.hostAccount as string) ?? '';
    const players = playersOf(s)
      .map(({ account, player }) => ({
        account,
        nick: player.nick,
        characterId: player.characterId,
        cos: typeof player.cos === 'string' ? player.cos : undefined,
        ready: !!player.ready,
        isHost: account === hostAccount,
        isMe: account === this.transport.account,
        ping: player.ping ?? 0,
        joinedAt: player.joinedAt ?? 0,
      }))
      .sort((a, b) => (a.isHost ? -1 : b.isHost ? 1 : a.joinedAt - b.joinedAt));
    const humans = players.length;
    // The host counts as ready by virtue of pressing START.
    const allReady = players.every((p) => p.ready || p.isHost);
    return {
      roomKey: this.roomKey,
      isHost: hostAccount === this.transport.account,
      hostAccount,
      trackId: (s.trackId as string) || this.defaults.trackId,
      difficulty: (s.difficulty as Difficulty) || this.defaults.difficulty,
      laps: (s.laps as number) || this.defaults.laps,
      items: s.items !== false,
      started: !!s.started,
      players,
      canStart: humans >= 2 && allReady,
    };
  }

  private emit(): void {
    this.onChange?.(this.derive());
  }
}
