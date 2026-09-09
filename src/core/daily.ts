/**
 * Daily seeded challenge (contract addition, progression).
 *
 * The date is the only input: it picks a circuit, a rule and a kart class, so a challenge exists
 * every day for as long as the game is installed with nobody authoring anything. Every player on
 * a given date gets the same one, which is what makes its leaderboard worth reading.
 *
 * The day key is `YYYY-MM-DD` in UTC, matching `todayKey()` in root server.js — the server stamps
 * submissions with its own clock, so a client on a different definition of "today" would file its
 * time under a day nobody else is racing.
 *
 * Pure: no DOM, no storage, no Three.
 */
import type { Difficulty, WeightClass } from './types';

export type DailyRuleId = 'clean' | 'sprint' | 'endurance' | 'expert';

export interface DailyRule {
  id: DailyRuleId;
  difficulty: Difficulty;
  /** Multiplier on the circuit's own lap count, floored to at least one lap. */
  lapScale: number;
}

/**
 * Four rules, all expressed in settings a race already accepts. Nothing here needs a new
 * mechanic, which is the point: a daily that depends on new content stops working the day
 * content stops being made.
 */
export const DAILY_RULES: readonly DailyRule[] = [
  { id: 'clean', difficulty: 'normal', lapScale: 1 },
  { id: 'sprint', difficulty: 'normal', lapScale: 0.5 },
  { id: 'endurance', difficulty: 'normal', lapScale: 2 },
  { id: 'expert', difficulty: 'hard', lapScale: 1 },
];

/** Kart classes a challenge can demand. `any` is the common case; the rest narrow the roster. */
export type DailyClass = WeightClass | 'any';
export const DAILY_CLASSES: readonly DailyClass[] = ['any', 'any', 'light', 'medium', 'heavy'];

export interface DailyChallenge {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  trackId: string;
  rule: DailyRule;
  klass: DailyClass;
  laps: number;
  /** Stable 32-bit seed, for anything else that wants to vary with the day. */
  seed: number;
}

/** UTC day key. Pass a date only in tests. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * FNV-1a over the day string. Small, dependency-free and stable across engines — a hash that
 * changed between browsers would hand two players different challenges on the same date.
 */
export function seedOf(day: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The challenge for `day`. `tracks` is the circuit list with its own lap counts; passing it in
 * keeps this module free of the track registry (and lets tests pin a roster).
 */
export function dailyChallenge(day: string, tracks: readonly { id: string; laps: number }[]): DailyChallenge {
  if (tracks.length === 0) throw new Error('dailyChallenge needs at least one track');
  const seed = seedOf(day);
  // Three independent draws off one seed: different shifts, so a change of day moves all three.
  const track = tracks[seed % tracks.length];
  const rule = DAILY_RULES[(seed >>> 8) % DAILY_RULES.length];
  const klass = DAILY_CLASSES[(seed >>> 16) % DAILY_CLASSES.length];
  const baseLaps = track.laps > 0 ? track.laps : 3;
  return {
    day,
    trackId: track.id,
    rule,
    klass,
    laps: Math.max(1, Math.round(baseLaps * rule.lapScale)),
    seed,
  };
}

/** True when this character may enter today's challenge. */
export function allowsCharacter(challenge: DailyChallenge, weightClass: WeightClass): boolean {
  return challenge.klass === 'any' || challenge.klass === weightClass;
}

/** Per-account daily record, kept in server user state. */
export interface DailyState {
  day: string;
  /** Attempt already spent today. */
  used: boolean;
  /** Best time posted today, ms. 0 = none. */
  timeMs: number;
}

/** A state from an earlier day is a fresh day: the attempt comes back. */
export function dailyStateFor(day: string, stored: DailyState | null | undefined): DailyState {
  if (!stored || stored.day !== day) return { day, used: false, timeMs: 0 };
  return stored;
}
