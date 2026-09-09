/**
 * Server-authoritative entitlements cache: { premium, premiumRaces, nickname, cos }.
 * The gameserver user state is the single source of truth (root server.js); this module
 * only caches it and exposes subscriptions. Outside a Verse8 host (local dev) an in-memory
 * mock store applies the same rules so every UI path can be exercised.
 */
import { packCosmetics, sanitize, unpackCosmetics, type KartCosmetics } from '../core/cosmetics';
import { CHARACTERS } from '../kart/roster';
import { inVerse8Host } from './embed';
import {
  fetchEntitlements,
  isConnected,
  serverConsumePremiumRace,
  serverGrantPremiumRaces,
  serverSetCosmetics,
  serverSetNickname,
  type Entitlements,
} from './server';

const PREMIUM_IDS = new Set(CHARACTERS.filter((c) => c.premium).map((c) => c.id));
const GRANT_SIZE = 3;
const GRANT_CAP = 9;

export type EntitlementState = Entitlements & { loaded: boolean };

const EMPTY: EntitlementState = { premium: false, premiumRaces: 0, nickname: '', cos: '', loaded: false };
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
export function canRace(characterId: string): boolean {
  if (!isPremium(characterId)) return true;
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
  applyEntitlements({ ...state, cos: packed });
  if (!useServer()) return true;
  const r = await serverSetCosmetics(packed);
  if (!r) return false;
  applyEntitlements({ ...state, cos: r.cos });
  return true;
}

/** Inside the host the server is the truth; outside, the mock store rules apply. */
function useServer(): boolean {
  return inVerse8Host();
}

export async function refreshEntitlements(): Promise<void> {
  if (!useServer()) return;
  const e = await fetchEntitlements();
  if (e) applyEntitlements(e);
}

/** After a host-verified rewarded ad: +3 premium races (server caps at 9, 10 grants/day). */
export async function grantPremiumRaces(): Promise<boolean> {
  if (!useServer()) return mockStore.grant();
  const r = await serverGrantPremiumRaces();
  if (!r) return false;
  applyEntitlements({ ...state, premiumRaces: r.premiumRaces });
  return r.granted;
}

/** Starting a race with `characterId`: spends one ticket when the kart is premium. */
export async function consumePremiumRace(characterId: string): Promise<boolean> {
  if (!useServer()) return mockStore.consume(characterId).ok;
  const r = await serverConsumePremiumRace(characterId);
  // Server unreachable inside the host: only free karts (or a confirmed purchase) may start.
  if (!r) return !isPremium(characterId) || state.premium;
  applyEntitlements({ ...state, premiumRaces: r.premiumRaces });
  return r.ok;
}

/** Returns the stored (normalised) nickname, or null when the server rejected / is absent. */
export async function setNickname(name: string): Promise<string | null> {
  if (!useServer()) {
    applyEntitlements({ ...state, nickname: name });
    return name;
  }
  const r = await serverSetNickname(name);
  if (!r) return null;
  applyEntitlements({ ...state, nickname: r.nickname });
  return r.nickname;
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
}
