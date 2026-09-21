/**
 * Server-authoritative entitlements cache: { premium, premiumRaces, nickname, cos, cups }.
 * The gameserver user state is the single source of truth (root server.js); this module
 * only caches it and exposes subscriptions. Outside a Verse8 host (local dev) an in-memory
 * mock store applies the same rules so every UI path can be exercised.
 */
import { packCosmetics, sanitize, unpackCosmetics, type KartCosmetics } from '../core/cosmetics';
import { CUPS, recordCupResult, type CupId, type CupProgress } from '../core/cups';
import { CHARACTERS } from '../kart/roster';
import { inVerse8Host } from './embed';
import {
  fetchEntitlements,
  isConnected,
  serverConsumePremiumRace,
  serverGrantPremiumRaces,
  serverSetCosmetics,
  serverSetCupProgress,
  serverSetNickname,
  type Entitlements,
} from './server';

const PREMIUM_IDS = new Set(CHARACTERS.filter((c) => c.premium).map((c) => c.id));
const GRANT_SIZE = 3;
const GRANT_CAP = 9;

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
  return state.premium || state.premiumRaces > 0;
}

/**
 * The look to drive with, already gated: a free player's saved paid pattern stays on the server
 * but is never rendered, so buying the tier brings it straight back.
 */
export function getCosmetics(): KartCosmetics {
  return sanitize(unpackCosmetics(state.cos), state.premium);
}

/** Saves the garage look. Cached optimistically so the preview never waits on the network. */
export async function saveCosmetics(cos: KartCosmetics): Promise<boolean> {
  const packed = packCosmetics(cos);
  mergeEntitlements({ cos: packed });
  if (!useServer()) return true;
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
  if (!useServer()) return;
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
  if (!useServer()) return mockStore.grant();
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
  if (!useServer()) return mockStore.consume(characterId).ok;
  const r = await serverConsumePremiumRace(characterId);
  // Server unreachable inside the host: only free karts (or a confirmed purchase) may start.
  if (!r) return !isPremium(characterId) || state.premium;
  mergeEntitlements({ premiumRaces: r.premiumRaces });
  if (!state.loaded) void refreshEntitlements();
  return r.ok;
}

/** Returns the stored (normalised) nickname, or null when the server rejected / is absent. */
export async function setNickname(name: string): Promise<string | null> {
  if (!useServer()) {
    mergeEntitlements({ nickname: name });
    return name;
  }
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
  if (!useServer()) return;
  const r = await serverSetCupProgress(next as Record<string, number>);
  if (r) mergeEntitlements({ cups: r.cups });
}

export function serverReachable(): boolean {
  return useServer() && isConnected();
}

// ── Local-dev mock store (never reached inside the host) ────────────────────
export const mockStore = {
  grant(): boolean {
    applyEntitlements({ ...state, premiumRaces: Math.min(GRANT_CAP, state.premiumRaces + GRANT_SIZE) });
    return true;
  },
  consume(characterId: string): { ok: boolean; premiumRaces: number } {
    if (!isPremium(characterId) || state.premium) return { ok: true, premiumRaces: state.premiumRaces };
    if (state.premiumRaces <= 0) return { ok: false, premiumRaces: 0 };
    applyEntitlements({ ...state, premiumRaces: state.premiumRaces - 1 });
    return { ok: true, premiumRaces: state.premiumRaces };
  },
  purchase(): void {
    applyEntitlements({ ...state, premium: true });
  },
};

export function _resetForTests(): void {
  state = EMPTY;
  listeners.clear();
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  attempt = 0;
}

/** Test seam: the partial merge used by the grant/consume/nickname replies. */
export const _mergeForTests = mergeEntitlements;
