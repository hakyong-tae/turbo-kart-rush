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

/** Rewarded-ad doublings of a race's coins, and mission swaps, per UTC day. */
export const DOUBLES_PER_DAY = 5;
export const SWAPS_PER_DAY = 1;

// --- experience and levels ----------------------------------------------------------

/** Experience by finishing place; a retirement earns `RETIRE_XP`. Not scaled by difficulty. */
export const RACE_XP: readonly number[] = [60, 50, 40, 30, 30, 30, 30, 30];
export const RETIRE_XP = 10;
/** `LEVEL_BASE` to reach level 2, `LEVEL_STEP` more for each level after, up to `MAX_LEVEL`. */
export const LEVEL_BASE = 100;
export const LEVEL_STEP = 50;
export const MAX_LEVEL = 30;
/** Coins paid for every level gained. */
export const LEVEL_COINS = 100;

export interface LevelInfo {
  level: number;
  /** Experience banked toward the next level. */
  into: number;
  /** Experience the next level takes; 0 at the top level. */
  need: number;
}

/** Level for a lifetime experience total. The server's `levelOf` is the same loop. */
export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  let need = LEVEL_BASE;
  let left = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  while (level < MAX_LEVEL && left >= need) {
    left -= need;
    level += 1;
    need += LEVEL_STEP;
  }
  return level >= MAX_LEVEL ? { level, into: 0, need: 0 } : { level, into: left, need };
}

/** Experience for one race, at the day's rate. */
export function raceXp(place: number, retired: boolean, racesToday: number): number {
  const base = retired ? RETIRE_XP : (RACE_XP[place - 1] ?? 0);
  return Math.round((base * raceRate(racesToday)) / 100);
}

// --- check-in ---------------------------------------------------------------------

/** Check-in coins for day 1..7 of the cycle; the eighth day in a row is day 1 again. */
export const STREAK_COINS: readonly number[] = [50, 60, 80, 100, 120, 150, 300];

/** Coins for the `n`th day in a row (1-based). */
export function streakCoins(n: number): number {
  return STREAK_COINS[(Math.max(1, Math.floor(n)) - 1) % STREAK_COINS.length];
}

// --- garage prices -----------------------------------------------------------------

const run = (n: number, price: number): number[] => new Array<number>(n).fill(price);

/**
 * Coin price of every garage entry, by packed key and catalogue index (core/cosmetics.ts). 0 is
 * free, -1 is not for sale (earned by level or by check-ins). The pattern row follows `PATTERNS`
 * order: none, 5 stripes, 11 racing and geometric, 6 organic, 5 fades, 5 special. The entries
 * after the gap in a row are the earn-only ones.
 */
export const COS_PRICES: Readonly<Record<string, readonly number[]>> = {
  p: [0, ...run(5, 400), ...run(11, 500), ...run(6, 600), ...run(5, 700), ...run(5, 1000)],
  u: [0, ...run(6, 500)],
  t: [0, ...run(10, 600), /* comet, confetti, snow, meteor */ -1, -1, -1, 2000],
  f: [0, ...run(8, 700), /* aurora, dawn, inferno, supernova */ -1, -1, 2000, 2500],
  w: [0, ...run(4, 400), /* goldRim, neonRim */ -1, 1500],
  e: [0, ...run(5, 800)],
  g: [0, ...run(8, 300), /* medal, laurel, sun, trophy */ -1, -1, -1, 1500],
};

/** Level reached -> the garage entry it awards. */
export const LEVEL_REWARDS: Readonly<Record<number, string>> = { 5: 'g:9', 10: 'w:5', 15: 't:b', 20: 'f:9', 25: 't:c', 30: 'g:a' };
/** Total days checked in (not the current run) -> the garage entry it awards. */
export const STREAK_REWARDS: Readonly<Record<number, string>> = { 7: 'g:b', 14: 'f:a', 30: 't:d' };
/** Coin-only shelf: for sale, but like the rewards above not covered by the 100 VX pass. */
export const SHOWCASE: readonly string[] = ['w:6', 'g:c', 'f:b', 't:e', 'f:c'];

/** How an earn-only entry is come by; null for anything on the ordinary paid shelf. */
export type EarnRule = { kind: 'level'; at: number } | { kind: 'days'; at: number } | { kind: 'coins'; price: number };

export function earnRule(token: string): EarnRule | null {
  for (const [at, t] of Object.entries(LEVEL_REWARDS)) if (t === token) return { kind: 'level', at: Number(at) };
  for (const [at, t] of Object.entries(STREAK_REWARDS)) if (t === token) return { kind: 'days', at: Number(at) };
  if (SHOWCASE.includes(token)) return { kind: 'coins', price: priceOf(token) ?? 0 };
  return null;
}

// --- daily missions ----------------------------------------------------------------

export type MissionId =
  | 'finish' | 'items' | 'start' | 'track' | 'class'
  | 'podium' | 'drift' | 'draft' | 'hits' | 'tricks' | 'clean' | 'daily'
  | 'win' | 'hardPodium' | 'team' | 'cup';

/** Counters a race reports for the missions. `walls` is only ever read by `clean`. */
export type MissionStat = 'items' | 'start' | 'drift' | 'draft' | 'hits' | 'tricks' | 'walls';
export type RaceStats = Record<MissionStat, number>;

export interface MissionDef {
  id: MissionId;
  /** 0 easy, 1 normal, 2 hard. */
  tier: 0 | 1 | 2;
  target: number;
  /** Present: progress is this counter, summed over races. Absent: races that met the condition. */
  stat?: MissionStat;
}

/**
 * The candidates. The server picks the day's three and tracks them; this copy exists so the UI
 * can name them and so a counter mission can be announced the moment it is reached mid-race.
 */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'finish', tier: 0, target: 3 },
  { id: 'items', tier: 0, target: 8, stat: 'items' },
  { id: 'start', tier: 0, target: 2, stat: 'start' },
  { id: 'track', tier: 0, target: 1 },
  { id: 'class', tier: 0, target: 1 },
  { id: 'podium', tier: 1, target: 2 },
  { id: 'drift', tier: 1, target: 10, stat: 'drift' },
  { id: 'draft', tier: 1, target: 3, stat: 'draft' },
  { id: 'hits', tier: 1, target: 3, stat: 'hits' },
  { id: 'tricks', tier: 1, target: 5, stat: 'tricks' },
  { id: 'clean', tier: 1, target: 1 },
  { id: 'daily', tier: 1, target: 1 },
  { id: 'win', tier: 2, target: 1 },
  { id: 'hardPodium', tier: 2, target: 1 },
  { id: 'team', tier: 2, target: 1 },
  { id: 'cup', tier: 2, target: 1 },
];
/** Reward by tier (easy, normal, hard), and the bonus for finishing all three. */
export const MISSION_COINS: readonly number[] = [40, 70, 120];
export const MISSION_XP: readonly number[] = [20, 35, 60];
export const MISSION_BONUS = 100;
/** Most of each counter one race may report. */
export const STAT_CAP: Readonly<RaceStats> = { items: 30, start: 1, drift: 60, draft: 30, hits: 30, tricks: 40, walls: 999 };
/** A "clean" finish allows this many wall or obstacle hits. */
export const CLEAN_WALLS = 3;

export function emptyStats(): RaceStats {
  return { items: 0, start: 0, drift: 0, draft: 0, hits: 0, tricks: 0, walls: 0 };
}

/** A mission key as the server stores it: `drift`, `track:coral_coast`, `class:heavy`. */
export function parseMissionKey(key: string): { def: MissionDef; param: string } | null {
  const colon = key.indexOf(':');
  const id = colon < 0 ? key : key.slice(0, colon);
  const def = MISSIONS.find((m) => m.id === id);
  return def ? { def, param: colon < 0 ? '' : key.slice(colon + 1) } : null;
}

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
