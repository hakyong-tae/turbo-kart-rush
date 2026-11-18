/**
 * Economy rule tables (contract addition, progression).
 *
 * The client's copy of what root server.js computes with: what a race pays, what a garage entry
 * costs. Nothing here decides anything — the server works every amount out from its own tables —
 * but the garage has to print a price before the player presses BUY, and the results screen has to
 * say why a race paid less. `src/verse8/serverEconomy.test.ts` reads the server's tables out of
 * its source and holds them equal to these.
 *
 * Design: docs/superpowers/specs/2026-11-18-progression-server-design.md.
 * Pure: no DOM, no storage, no Three.
 */
import type { Difficulty } from './types';

/** Coins by finishing place, 1st to 8th. */
export const RACE_COINS: readonly number[] = [60, 45, 35, 28, 22, 18, 14, 10];
/** A retirement pays this whatever place it was classified in. */
export const RETIRE_COINS = 5;
/** Difficulty multiplier on race coins, in percent so the sum stays in integers. */
export const DIFF_PCT: Readonly<Record<Difficulty, number>> = { easy: 80, normal: 100, hard: 130 };

/** Per UTC day: this many races at full rate, then `REDUCED_PCT`, then nothing from `RACE_CAP` on. */
export const FULL_RACES = 10;
export const REDUCED_PCT = 30;
export const RACE_CAP = 60;

/** Permanent unlock of one premium kart. */
export const KART_PRICE = 2500;

/** Percent of the table a race pays when `racesToday` have already been paid for today. */
export function raceRate(racesToday: number): number {
  return racesToday < FULL_RACES ? 100 : racesToday < RACE_CAP ? REDUCED_PCT : 0;
}

/** Coins for one race. Same integer arithmetic as the server, so the two cannot round apart. */
export function raceCoins(place: number, retired: boolean, difficulty: Difficulty, racesToday: number): number {
  const base = retired ? RETIRE_COINS : (RACE_COINS[place - 1] ?? 0);
  return Math.round((base * DIFF_PCT[difficulty] * raceRate(racesToday)) / 10000);
}

const run = (n: number, price: number): number[] => new Array<number>(n).fill(price);

/**
 * Coin price of every garage entry, by packed key and catalogue index (core/cosmetics.ts). 0 is
 * free. The pattern row follows `PATTERNS` order: none, 5 stripes, 11 racing and geometric,
 * 6 organic, 5 fades, 5 special.
 */
export const COS_PRICES: Readonly<Record<string, readonly number[]>> = {
  p: [0, ...run(5, 400), ...run(11, 500), ...run(6, 600), ...run(5, 700), ...run(5, 1000)],
  u: [0, ...run(6, 500)],
  t: [0, ...run(10, 600)],
  f: [0, ...run(8, 700)],
  w: [0, ...run(4, 400)],
  e: [0, ...run(5, 800)],
  g: [0, ...run(8, 300)],
};

/** Price of a garage token (`p:f`), or undefined when the table does not know it. */
export function priceOf(token: string): number | undefined {
  const colon = token.indexOf(':');
  const row = colon > 0 ? COS_PRICES[token.slice(0, colon)] : undefined;
  return row ? row[Number.parseInt(token.slice(colon + 1), 36)] : undefined;
}

/** "1,300": coin amounts are grouped the same way in both languages. */
export function formatCoins(n: number): string {
  return Math.max(0, Math.floor(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
