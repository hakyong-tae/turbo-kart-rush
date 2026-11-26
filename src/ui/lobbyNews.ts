/**
 * Red dots on the lobby: a button with something new behind it says so until it is opened.
 *
 *   - garage: an item the account owns that the player has not tapped in the garage since it
 *     arrived (the unlock ladder, the check-in and level-ups all hand out looks). The garage
 *     dots the item and its tab; tapping the item clears it, and the lobby dot goes with the last;
 *   - daily challenge: today's has not been opened yet;
 *   - cup cell: the cup it names is open and has never been raced.
 *
 * What was last seen is kept on this device only (two `tkr.seen.*` keys). It is a nudge, not
 * account state: a cleared browser shows the dots again, and that is all it costs.
 */
import type { CupId, CupProgress } from '../core/cups';
import { isCupUnlocked } from '../core/cups';

export const SEEN_GARAGE_KEY = 'tkr.seen.garage';
export const SEEN_DAILY_KEY = 'tkr.seen.daily';

/** True when `owned` holds a token that `seen` does not. */
export function hasUnseen(owned: Iterable<string>, seen: readonly string[]): boolean {
  const known = new Set(seen);
  for (const token of owned) if (!known.has(token)) return true;
  return false;
}

/** The cup cell's dot: the cup to win next is open and has never been finished. */
export function cupIsNews(goal: CupId | null, progress: CupProgress): boolean {
  return Boolean(goal && isCupUnlocked(goal, progress) && progress[goal] === undefined);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the dot just stays */
  }
}

function seenGarage(): string[] {
  try {
    const v: unknown = JSON.parse(read(SEEN_GARAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function garageIsNews(owned: Iterable<string>): boolean {
  return hasUnseen(owned, seenGarage());
}

export function markGarageSeen(owned: Iterable<string>): void {
  write(SEEN_GARAGE_KEY, JSON.stringify([...owned]));
}

/** An owned garage entry the player has not tapped yet. */
export function garageTokenIsNew(token: string, owned: ReadonlySet<string>): boolean {
  return owned.has(token) && !seenGarage().includes(token);
}

export function markGarageTokenSeen(token: string): void {
  const seen = seenGarage();
  if (!seen.includes(token)) write(SEEN_GARAGE_KEY, JSON.stringify([...seen, token]));
}

/**
 * The first time the dots run for an account older than the unlock ladder, everything it owns
 * is counted as seen: a returning player's whole collection is not news.
 */
export function ensureGarageBaseline(owned: Iterable<string>, legacy: boolean): void {
  if (!legacy || read(SEEN_GARAGE_KEY) !== null) return;
  markGarageSeen(owned);
}

export function dailyIsNews(day: string): boolean {
  return read(SEEN_DAILY_KEY) !== day;
}

export function markDailySeen(day: string): void {
  write(SEEN_DAILY_KEY, day);
}
