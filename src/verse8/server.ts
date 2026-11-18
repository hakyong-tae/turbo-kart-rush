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
import { inVerse8Host } from './embed';
import { resolveIdentity } from './identity';

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

  // Name the player explicitly. Left to itself the gameserver only reads `?account=`, and falls
  // back to an invented `anonymous-…` identity that a mobile webview can lose on every relaunch.
  const { account } = resolveIdentity();
  void store.connect(account ? { account } : undefined);

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

/**
 * Calls a function on whichever server holds this player's account: the gameserver inside a
 * Verse8 host, the in-page copy of server.js outside one (`localServer.ts`). The account record —
 * what is owned, what is in the wallet — goes through here, so local play runs on the real rules.
 * Records and rooms stay on `callServer`: there is no leaderboard to share with nobody.
 */
export async function callBackend<T>(fn: string, args: unknown[] = [], fallback: T, budgetMs = CONNECT_BUDGET_MS): Promise<T> {
  if (inVerse8Host()) return callServer(fn, args, fallback, budgetMs);
  try {
    const { callLocal } = await import('./localServer');
    return await callLocal<T>(fn, args);
  } catch (err) {
    console.warn(`[local] ${fn} failed:`, err);
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
  /** Coin balance. Absent on a reply from a server older than the economy. */
  coins?: number;
  /** Ownership tokens, comma-joined: garage entries (`p:f`) and karts (`k:rosa`). */
  own?: string;
  /** Today's ledger (UTC day). */
  eco?: EcoDay;
}

export interface EcoDay {
  day: string;
  /** Races already paid for today; decides the rate of the next one. */
  races: number;
}

/** What `finishRace` answers. A refusal carries a reason instead of throwing. */
export interface RaceAward {
  ok: boolean;
  reason?: 'no-race' | 'bad-time' | 'too-fast' | 'bad-place';
  raceId?: string;
  /** Balance after this race. */
  coins: number;
  earned?: { race: number; total: number };
  /** Races paid for today, this one included. */
  races: number;
  /** Percent of the table this race was paid at: 100, 30 or 0. */
  rate?: number;
}

/** What the race looked like from the driver's seat. Amounts are never part of it. */
export interface RaceReport {
  place: number;
  retired: boolean;
  /** Race clock at the player's finish (or retirement), ms. */
  timeMs: number;
}

export interface BuyReply {
  ok: boolean;
  reason?: 'unknown' | 'owned' | 'short' | 'earn';
  coins: number;
  own: string;
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
export interface DailyTop {
  day: string;
  /** Today's attempt already spent. */
  used: boolean;
  myTimeMs: number;
  myRank: number | null;
  entries: number;
  rows: TimeRow[];
}
export interface DailyResult {
  accepted: boolean;
  day: string;
  timeMs: number;
  rank: number | null;
}

export function fetchDailyTop(limit = 20): Promise<DailyTop | null> {
  return callServer<DailyTop | null>('getDailyTop', [limit], null, 12000);
}
export function submitDailyTime(timeMs: number, characterId: string): Promise<DailyResult | null> {
  return callServer<DailyResult | null>('submitDaily', [Math.floor(timeMs), characterId], null);
}

export function fetchEntitlements(): Promise<Entitlements | null> {
  return callBackend<Entitlements | null>('getMyEntitlements', [], null, 12000);
}
export function serverGrantPremiumRaces(): Promise<{ granted: boolean; premiumRaces: number } | null> {
  return callBackend<{ granted: boolean; premiumRaces: number } | null>('grantPremiumRaces', [], null);
}
export function serverConsumePremiumRace(characterId: string): Promise<{ ok: boolean; premiumRaces: number } | null> {
  return callBackend<{ ok: boolean; premiumRaces: number } | null>('consumePremiumRace', [characterId], null);
}
export function serverSetNickname(name: string): Promise<{ nickname: string } | null> {
  return callBackend<{ nickname: string } | null>('setNickname', [name], null);
}
export function serverSetCosmetics(packed: string): Promise<{ cos: string } | null> {
  return callBackend<{ cos: string } | null>('setCosmetics', [packed], null);
}
export function serverSetCupProgress(progress: Record<string, number>): Promise<{ cups: Record<string, number> } | null> {
  return callBackend<{ cups: Record<string, number> } | null>('setCupProgress', [progress], null);
}

export function serverBeginRace(trackId: string, characterId: string, difficulty: string, mode: string): Promise<{ raceId: string } | null> {
  return callBackend<{ raceId: string } | null>('beginRace', [trackId, characterId, difficulty, mode], null);
}
export function serverFinishRace(raceId: string, report: RaceReport): Promise<RaceAward | null> {
  return callBackend<RaceAward | null>('finishRace', [raceId, report], null);
}
export function serverBuyCosmetic(token: string): Promise<BuyReply | null> {
  return callBackend<BuyReply | null>('buyCosmetic', [token], null);
}
export function serverBuyKart(characterId: string): Promise<BuyReply | null> {
  return callBackend<BuyReply | null>('buyKart', [characterId], null);
}
