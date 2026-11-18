/**
 * Server-authoritative account cache: { premium, premiumRaces, nickname, cos, cups, coins, own }.
 * The gameserver user state is the single source of truth (root server.js); this module
 * only caches it and exposes subscriptions. Outside a Verse8 host (local dev) the same server.js
 * runs in the page against localStorage (`localServer.ts`), so every UI path can be exercised on
 * the real rules and the wallet survives a reload.
 */
import { kartToken, packCosmetics, parseOwned, sanitize, unpackCosmetics, type KartCosmetics } from '../core/cosmetics';
import { CUPS, recordCupResult, type CupId, type CupProgress } from '../core/cups';
import { CHARACTERS } from '../kart/roster';
import { inVerse8Host } from './embed';
import {
  fetchEntitlements,
  isConnected,
  serverBeginRace,
  serverBuyCosmetic,
  serverBuyKart,
  serverClaimAttendance,
  serverConsumePremiumRace,
  serverDoubleRaceCoins,
  serverFinishRace,
  serverGrantPremiumRaces,
  serverSetCosmetics,
  serverSetCupProgress,
  serverSetNickname,
  serverSwapMission,
  type AttendanceReply,
  type BuyReply,
  type DoubleReply,
  type Entitlements,
  type MissionsView,
  type RaceAward,
  type RaceReport,
  type StreakView,
  type SwapReply,
} from './server';

const PREMIUM_IDS = new Set(CHARACTERS.filter((c) => c.premium).map((c) => c.id));

export type EntitlementState = Entitlements & { loaded: boolean };

const EMPTY: EntitlementState = { premium: false, premiumRaces: 0, nickname: '', cos: '', cups: {}, loaded: false };
let state: EntitlementState = EMPTY;
const listeners = new Set<(e: EntitlementState) => void>();

export function isPremium(characterId: string): boolean {
  return PREMIUM_IDS.has(characterId);
}
export function getEntitlements(): EntitlementState {
  return state;
}
export function onEntitlementsChange(fn: (e: EntitlementState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function applyEntitlements(next: Entitlements): void {
  state = { ...next, loaded: true };
  for (const fn of Array.from(listeners)) fn(state);
}

/**
 * Merges a field the server just told us about, without claiming the rest of the record is known.
 *
 * `grantPremiumRaces` and friends learn one number from their own reply. Folding that into `state`
 * with `applyEntitlements` used to stamp `loaded: true` over a record that had never been fetched,
 * so a session whose first fetch was lost would go on believing the player's nickname was empty —
 * and then race under a bot's handle. Loaded means fetched, and only a fetch may set it.
 */
function mergeEntitlements(patch: Partial<Entitlements>): void {
  state = { ...state, ...patch };
  for (const fn of Array.from(listeners)) fn(state);
}
/**
 * True while the server is the authority but its answer has not arrived yet.
 *
 * "Not known" and "nothing" are different answers, and conflating them is what locked a kart on
 * the phone that the same account could drive on the desktop. Every read of this record that
 * drives UI has to ask which of the two it is looking at.
 */
export function entitlementsPending(): boolean {
  return useServer() && !state.loaded;
}

export function canRace(characterId: string): boolean {
  if (!isPremium(characterId)) return true;
  // While the record is still on its way, let the player through. Nothing is given away by this:
  // starting a premium race spends a ticket through `consumePremiumRace`, which is decided on the
  // server, so an optimistic card here can only ever be corrected — never exploited.
  if (entitlementsPending()) return true;
  return state.premium || ownsKart(characterId) || state.premiumRaces > 0;
}

// ── Wallet and ownership ────────────────────────────────────────────────────

export function getCoins(): number {
  return typeof state.coins === 'number' && state.coins > 0 ? Math.floor(state.coins) : 0;
}

let ownedSource: string | undefined;
let ownedSet: ReadonlySet<string> = new Set();

/** Ownership tokens of this account (see core/cosmetics.ts). Parsed once per change of the record. */
export function getOwned(): ReadonlySet<string> {
  if (state.own !== ownedSource) {
    ownedSource = state.own;
    ownedSet = parseOwned(state.own);
  }
  return ownedSet;
}

/** A premium kart unlocked for good, by the pass or with coins. Tickets do not count as owning. */
export function ownsKart(characterId: string): boolean {
  return state.premium || getOwned().has(kartToken(characterId));
}

/** Races already paid for today; `core/economy.raceRate` turns it into the next race's rate. */
export function racesToday(): number {
  return state.eco && state.eco.day === new Date().toISOString().slice(0, 10) ? state.eco.races : 0;
}

/** Lifetime experience. `core/economy.levelInfo` turns it into a level and a bar. */
export function getXp(): number {
  return typeof state.xp === 'number' && state.xp > 0 ? Math.floor(state.xp) : 0;
}

/** The check-in record, or null while the account has not been read (or the server predates it). */
export function getStreak(): StreakView | null {
  return state.streak ?? null;
}

/**
 * Today's missions, or null when unknown. A set fetched before midnight UTC is yesterday's by the
 * time the player looks at it; that reads as unknown too, and the caller refreshes.
 */
export function getMissions(): MissionsView | null {
  const m = state.missions;
  return m && m.day === new Date().toISOString().slice(0, 10) ? m : null;
}

/**
 * The look to drive with, already gated: a paid pattern the player does not own stays on the
 * server but is never rendered, so unlocking it brings it straight back.
 */
export function getCosmetics(): KartCosmetics {
  return sanitize(unpackCosmetics(state.cos), state.premium, getOwned());
}

/** Saves the garage look. Cached optimistically so the preview never waits on the network. */
export async function saveCosmetics(cos: KartCosmetics): Promise<boolean> {
  const packed = packCosmetics(cos);
  mergeEntitlements({ cos: packed });
  const r = await serverSetCosmetics(packed);
  if (!r) return false;
  mergeEntitlements({ cos: r.cos });
  return true;
}

/** Inside the host the server is the truth; outside, the mock store rules apply. */
function useServer(): boolean {
  return inVerse8Host();
}

/**
 * Pulls the record from the server, and keeps trying until it arrives.
 *
 * The connection has a budget, and on a cold start — the app launched from nothing, on a phone,
 * on mobile data — it loses that race often. This used to be called once: if that one call came
 * back empty the session ran on `EMPTY` forever, which is why the nickname box was blank after a
 * restart four times in five, why the ticket count read zero on one device while another still
 * showed three, and why an ad watched in that state paid for nothing.
 *
 * So: retry with a widening gap, and never stop while the record is still unknown.
 */
const RETRY_MS = [400, 1000, 2000, 4000, 8000, 15000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;

export async function refreshEntitlements(): Promise<void> {
  const e = await fetchEntitlements();
  if (e) {
    attempt = 0;
    applyEntitlements(e);
    return;
  }
  if (retryTimer !== null) return;
  const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
  attempt++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void refreshEntitlements();
  }, wait);
}

/**
 * Re-reads the record whenever the player comes back to the game.
 *
 * Two devices share one account, so the other one may have spent a ticket while this tab was in
 * the background — the case QA hit going from PC back to the phone. Coming back to a stale count
 * is how a player ends up watching an ad they had already paid for.
 */
export function watchForeground(): void {
  if (!useServer() || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshEntitlements();
  });
  window.addEventListener('focus', () => void refreshEntitlements());
}

/** After a host-verified rewarded ad: +3 premium races (server caps at 9, 10 grants/day). */
export async function grantPremiumRaces(): Promise<boolean> {
  const r = await serverGrantPremiumRaces();
  if (!r) return false;
  mergeEntitlements({ premiumRaces: r.premiumRaces });
  // The reply is the only place the real total is known, so make sure the rest of the record
  // catches up too — this is usually the first successful call of a session that started offline.
  if (!state.loaded) void refreshEntitlements();
  return r.granted;
}

/** Starting a race with `characterId`: spends one ticket when the kart is premium. */
export async function consumePremiumRace(characterId: string): Promise<boolean> {
  const r = await serverConsumePremiumRace(characterId);
  // Server unreachable inside the host: only free karts (or a confirmed purchase) may start.
  if (!r) return !isPremium(characterId) || ownsKart(characterId);
  mergeEntitlements({ premiumRaces: r.premiumRaces });
  if (!state.loaded) void refreshEntitlements();
  return r.ok;
}

/** Returns the stored (normalised) nickname, or null when the server rejected / is absent. */
export async function setNickname(name: string): Promise<string | null> {
  const r = await serverSetNickname(name);
  if (!r) return null;
  mergeEntitlements({ nickname: r.nickname });
  return r.nickname;
}

/** Best placing per cup, filtered to ids this build knows about. */
export function getCupProgress(): CupProgress {
  const out: CupProgress = {};
  for (const cup of CUPS) {
    const v = state.cups?.[cup.id];
    if (typeof v === 'number' && v >= 1) out[cup.id] = v;
  }
  return out;
}

/**
 * Records a finished cup. Cached immediately so the next screen already shows the unlock, then
 * pushed; the server keeps the better of the two, so a lost round trip costs nothing.
 */
export async function saveCupResult(id: CupId, place: number): Promise<void> {
  const next = recordCupResult(getCupProgress(), id, place);
  if (next === getCupProgress()) return;
  mergeEntitlements({ cups: { ...state.cups, ...next } as Record<string, number> });
  const r = await serverSetCupProgress(next as Record<string, number>);
  if (r) mergeEntitlements({ cups: r.cups });
}

export function serverReachable(): boolean {
  return useServer() && isConnected();
}

// ── Race rewards and spending ───────────────────────────────────────────────
//
// Unlike the garage look, none of this is cached optimistically. A coin shown and then taken back
// is the worst thing a wallet can do, so the balance on screen only ever moves on the server's word.

/** Calls that change the wallet run one at a time, so two replies cannot land out of order. */
let walletQueue: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const next = walletQueue.then(job, job);
  walletQueue = next.catch(() => undefined);
  return next;
}

let ticket: Promise<string | null> | null = null;

/**
 * Opens a race on the server. Not awaited by the caller: the race starts regardless, and
 * `finishRace` picks the ticket up when the player crosses the line.
 */
export function beginRace(settings: { trackId: string; characterId: string; difficulty: string; mode?: string }): void {
  ticket = queued(() => serverBeginRace(settings.trackId, settings.characterId, settings.difficulty, settings.mode ?? 'solo')).then(
    (r) => r?.raceId ?? null,
  );
}

/** Forgets the open race: a run that must not be paid for (dev auto-drive, tuned balance). */
export function abandonRace(): void {
  ticket = null;
}

/**
 * Settles the race `beginRace` opened. Null when there was nothing to settle or the server did not
 * answer; a refusal (`ok: false`) is returned as it came, with the reason.
 */
export async function finishRace(report: RaceReport): Promise<RaceAward | null> {
  const mine = ticket;
  ticket = null;
  if (!mine) return null;
  const raceId = await mine;
  if (!raceId) return null;
  const award = await queued(() => serverFinishRace(raceId, report));
  if (award) {
    const patch: Partial<Entitlements> = {
      coins: award.coins,
      eco: { ...state.eco, day: new Date().toISOString().slice(0, 10), races: award.races },
    };
    if (award.xp !== undefined) patch.xp = award.xp;
    if (award.own !== undefined) patch.own = award.own;
    if (award.missions) patch.missions = award.missions;
    mergeEntitlements(patch);
  }
  return award;
}

/** After a host-verified rewarded ad: the last race's coins, once more. */
export async function doubleRaceCoins(raceId: string): Promise<DoubleReply | null> {
  const r = await queued(() => serverDoubleRaceCoins(raceId));
  if (r) mergeEntitlements({ coins: r.coins });
  return r;
}

/**
 * Claims today's check-in. `recover` is only meaningful for a run broken by one missed day:
 * true (after a rewarded ad) carries it on, false starts over, undefined asks which.
 */
export async function claimAttendance(recover?: boolean): Promise<AttendanceReply | null> {
  const r = await queued(() => serverClaimAttendance(recover));
  if (r) {
    const patch: Partial<Entitlements> = { coins: r.coins, streak: r.streak };
    if (r.own !== undefined) patch.own = r.own;
    mergeEntitlements(patch);
  }
  return r;
}

/** After a host-verified rewarded ad: trades one unfinished mission for another of its tier. */
export async function swapMission(index: number): Promise<SwapReply | null> {
  const r = await queued(() => serverSwapMission(index));
  if (r) mergeEntitlements({ missions: r.missions });
  return r;
}

function applyPurchase(r: BuyReply | null): BuyReply | null {
  if (r) mergeEntitlements({ coins: r.coins, own: r.own });
  return r;
}

/** Buys one garage entry with coins. Null when the server did not answer. */
export function buyCosmetic(token: string): Promise<BuyReply | null> {
  return queued(() => serverBuyCosmetic(token)).then(applyPurchase);
}

/** Unlocks one premium kart for good with coins. Null when the server did not answer. */
export function buyKart(characterId: string): Promise<BuyReply | null> {
  return queued(() => serverBuyKart(characterId)).then(applyPurchase);
}

// ── Local-dev stand-ins (never reached inside the host) ─────────────────────
//
// These used to keep their own copy of the ticket rules in memory. They now drive the in-page
// server like everything else, which also means a mock purchase survives a reload.
export const mockStore = {
  grant(): Promise<boolean> {
    return grantPremiumRaces();
  },
  async consume(characterId: string): Promise<{ ok: boolean; premiumRaces: number }> {
    const ok = await consumePremiumRace(characterId);
    return { ok, premiumRaces: state.premiumRaces };
  },
  async purchase(): Promise<void> {
    const { localPurchase } = await import('./localServer');
    await localPurchase('premium-garage');
    await refreshEntitlements();
  },
};

export function _resetForTests(): void {
  state = EMPTY;
  ticket = null;
  walletQueue = Promise.resolve();
  listeners.clear();
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  attempt = 0;
}

/** Test seam: the partial merge used by the grant/consume/nickname replies. */
export const _mergeForTests = mergeEntitlements;
