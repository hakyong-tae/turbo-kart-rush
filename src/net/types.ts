/**
 * Net layer contracts (ported from soldat-web/src/net/types.ts). Sessions and lobby code
 * depend only on these — transport.ts (real agent8) and loopback.ts (tests/demo) implement them.
 */
import type { Difficulty } from '../core/types';

/** Room participant — value of the roomState key `p_{account}`. */
export interface RoomPlayer {
  nick: string;
  characterId: string;
  ready: boolean;
  joinedAt: number;
  ping?: number;
  /** Packed garage look (src/core/cosmetics.ts). Absent for a player who never opened the garage. */
  cos?: string;
}

/** Whole room state (agent8 roomState — flat keys: scalars + `p_{account}`). */
export interface RoomState {
  hostAccount?: string;
  trackId?: string;
  difficulty?: Difficulty;
  laps?: number;
  items?: boolean; // always false in this spec (placeholder for phase 2)
  started?: boolean;
  hostEpoch?: number;
  [playerKey: string]: unknown; // 'p_{account}' → RoomPlayer
}

export interface RoomListing {
  key: string;
  count: number;
  trackId: string;
  started: boolean;
}

export type MessageHandler = (event: string, payload: unknown, fromAccount: string) => void;

export interface Transport {
  readonly account: string;
  readonly status: 'offline' | 'connecting' | 'online';
  connect(): Promise<Transport['status']>;
  listRooms(): Promise<RoomListing[]>;
  /** Join by code, or null for quick race (server picks an open room or creates one). Returns the room key. */
  joinRoom(key: string | null): Promise<string>;
  /** Always a fresh room. Returns the new code. */
  createRoom(): Promise<string>;
  touchRoom?(key: string, trackId: string, started: boolean): Promise<void>;
  leaveRoom(): Promise<void>;
  getRoomState(): Promise<RoomState>;
  /** Shallow merge; null deletes a key. */
  updateRoomState(patch: Record<string, unknown>): Promise<void>;
  /** broadcastToRoom relay. hot = high-frequency latest-wins (snapshots / inputs, may be dropped). */
  send(event: string, payload: unknown, hot?: boolean): void;
  onMessage(handler: MessageHandler): void;
  onRoomState(handler: (s: RoomState) => void): void;
  ping?(): Promise<number>;
}

export function playersOf(state: RoomState): { account: string; player: RoomPlayer }[] {
  const out: { account: string; player: RoomPlayer }[] = [];
  for (const key of Object.keys(state)) {
    if (!key.startsWith('p_')) continue;
    const v = state[key];
    if (v && typeof v === 'object') out.push({ account: key.slice(2), player: v as RoomPlayer });
  }
  return out;
}
