// Verse8 GameServer connection — TS port of the battle-tested wrapper from
// server-survival-v8/src/verse8/gameserver.js (via block-blaster-v8). The load-bearing rules:
//
//   ⚠️ Connect through the SDK's zustand STORE, never GameServer.connect().
//   The SDK registers global focus listeners that re-call the store's connect() whenever
//   the store believes it is disconnected; connecting the GameServer directly leaves the
//   store's flag false forever → infinite reconnect storm on every window focus.
//
//   * Single-flight: connect() is not idempotent; all callers share one attempt.
//   * Per-caller budget: callers race the shared attempt against a timeout.
//   * Epoch-guarded writes: a stale attempt cannot clobber a fresh success.

import { GameServer } from '@agent8/gameserver';

let instance: any = null;
let connected = false;
let attemptPromise: Promise<boolean> | null = null;
let connectEpoch = 0;

const CONNECT_BUDGET_MS = 6000;

function getGameServer(): any {
  if (!instance) instance = (GameServer as any).getInstance();
  return instance;
}

async function connectViaStore(budgetMs: number): Promise<boolean> {
  // Deep import path MUST stay a literal — the package has no exports map and a variable
  // specifier (or a @vite-ignore hint) leaves the bare name in the browser output.
  const { useGameServerStore } = await import('@agent8/gameserver/dist/src/store/useGameServerStore');
  const store = useGameServerStore.getState();
  if (store.connected) return true;

  void store.connect();

  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (useGameServerStore.getState().connected) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Do NOT retry connect() here — a second call would tear down a socket that may be
  // seconds from being ready.
  return false;
}

export async function ensureConnected(budgetMs = CONNECT_BUDGET_MS): Promise<boolean> {
  if (connected) return true;

  if (!attemptPromise) {
    const epoch = ++connectEpoch;
    attemptPromise = connectViaStore(budgetMs)
      .then((ok) => {
        if (epoch === connectEpoch) connected = Boolean(ok);
        return connected;
      })
      .catch((err) => {
        console.warn('[v8] gameserver connect failed:', err);
        if (epoch === connectEpoch) connected = false;
        return false;
      })
      .finally(() => {
        if (epoch === connectEpoch) attemptPromise = null;
      });
  }

  const shared = attemptPromise;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      shared,
      new Promise<boolean>((resolve) => {
        budgetTimer = setTimeout(() => resolve(false), budgetMs);
      }),
    ]);
  } finally {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
  }
}

export function isConnected(): boolean {
  return connected;
}

/** Account id of the connected player ('' before the socket is up) — surfaced in Settings for support. */
export function currentAccount(): string {
  if (!connected) return '';
  try {
    return String(getGameServer().account ?? '');
  } catch {
    return '';
  }
}

/** Call a server function, or return `fallback` when the platform is absent. */
export async function callServer<T>(fn: string, args: unknown[] = [], fallback: T, budgetMs = CONNECT_BUDGET_MS): Promise<T> {
  if (!(await ensureConnected(budgetMs))) return fallback;
  try {
    return (await getGameServer().remoteFunction(fn, args)) as T;
  } catch (err) {
    console.warn(`[v8] remoteFunction ${fn} failed:`, err);
    return fallback;
  }
}

// ── Game-specific calls (see root server.js) ────────────────────────────────

export interface TimeRow {
  name: string;
  timeMs: number;
  characterId: string;
  difficulty: string;
  /** The look the time was set with, packed. Empty for rows written before the garage. */
  cos?: string;
  account?: string;
}
export interface TopTimes {
  rows: TimeRow[];
  myRank: number | null;
  myBest: number | null;
}
export interface SubmitResult {
  updated: boolean;
  rank: number | null;
  timeMs: number;
}
export interface Entitlements {
  /** Paid tier: the garage's patterns and effects, and every kart, forever. */
  premium: boolean;
  premiumRaces: number;
  nickname: string;
  /** Packed cosmetics string, opaque here; unpacked by src/core/cosmetics.ts. */
  cos: string;
  /** Best Grand Prix placing per cup id. */
  cups: Record<string, number>;
}

export function submitTime(
  trackId: string,
  timeMs: number,
  characterId: string,
  difficulty: string,
): Promise<SubmitResult | null> {
  return callServer<SubmitResult | null>('submitTime', [trackId, Math.floor(timeMs), characterId, difficulty], null);
}
export function fetchTopTimes(trackId: string, limit = 20): Promise<TopTimes | null> {
  // Records are often the first server call on a slow mobile network — give the connect more room.
  return callServer<TopTimes | null>('getTopTimes', [trackId, limit], null, 12000);
}
export function fetchEntitlements(): Promise<Entitlements | null> {
  return callServer<Entitlements | null>('getMyEntitlements', [], null, 12000);
}
export function serverGrantPremiumRaces(): Promise<{ granted: boolean; premiumRaces: number } | null> {
  return callServer<{ granted: boolean; premiumRaces: number } | null>('grantPremiumRaces', [], null);
}
export function serverConsumePremiumRace(characterId: string): Promise<{ ok: boolean; premiumRaces: number } | null> {
  return callServer<{ ok: boolean; premiumRaces: number } | null>('consumePremiumRace', [characterId], null);
}
export function serverSetNickname(name: string): Promise<{ nickname: string } | null> {
  return callServer<{ nickname: string } | null>('setNickname', [name], null);
}
export function serverSetCosmetics(packed: string): Promise<{ cos: string } | null> {
  return callServer<{ cos: string } | null>('setCosmetics', [packed], null);
}
export function serverSetCupProgress(progress: Record<string, number>): Promise<{ cups: Record<string, number> } | null> {
  return callServer<{ cups: Record<string, number> } | null>('setCupProgress', [progress], null);
}
