import { describe, expect, it } from 'vitest';
import { BADGES, ENGINE_PACKS, FLAMES, PATTERNS, TRAILS, UNDERGLOWS, WHEEL_FX, paidCosmetics } from './cosmetics';
import {
  COS_PRICES,
  FULL_RACES,
  LEVEL_REWARDS,
  MAX_LEVEL,
  MISSIONS,
  RACE_CAP,
  SHOWCASE,
  STREAK_REWARDS,
  earnRule,
  formatCoins,
  levelInfo,
  parseMissionKey,
  priceOf,
  raceCoins,
  raceRate,
  raceXp,
  streakCoins,
} from './economy';

describe('race coins', () => {
  it('pays the approved table on normal', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => raceCoins(p, false, 'normal', 0))).toEqual([60, 45, 35, 28, 22, 18, 14, 10]);
    expect(raceCoins(1, true, 'normal', 0)).toBe(5);
  });

  it('scales by difficulty and rounds once, in integers', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => raceCoins(p, false, 'easy', 0))).toEqual([48, 36, 28, 22, 18, 14, 11, 8]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => raceCoins(p, false, 'hard', 0))).toEqual([78, 59, 46, 36, 29, 23, 18, 13]);
    expect(raceCoins(5, true, 'hard', 0)).toBe(7);
  });

  it('full rate for ten races, 30% to the cap, nothing after', () => {
    expect(raceRate(0)).toBe(100);
    expect(raceRate(FULL_RACES - 1)).toBe(100);
    expect(raceRate(FULL_RACES)).toBe(30);
    expect(raceRate(RACE_CAP - 1)).toBe(30);
    expect(raceRate(RACE_CAP)).toBe(0);
    expect(raceCoins(1, false, 'hard', FULL_RACES)).toBe(23);
    expect(raceCoins(1, false, 'hard', RACE_CAP)).toBe(0);
    expect(raceCoins(99, false, 'normal', 0)).toBe(0);
  });
});

describe('garage prices', () => {
  it('has one price per catalogue entry, free exactly where the catalogue says free', () => {
    const lists = { p: PATTERNS, u: UNDERGLOWS, t: TRAILS, f: FLAMES, w: WHEEL_FX, e: ENGINE_PACKS, g: BADGES };
    for (const [key, list] of Object.entries(lists)) {
      expect(COS_PRICES[key], key).toHaveLength(list.length);
      list.forEach((entry, i) => expect(COS_PRICES[key][i] === 0, `${key}:${i}`).toBe(entry.free));
    }
  });

  it('the 73 paid entries follow the approved price bands and total 42,200', () => {
    const paid = paidCosmetics().filter((p) => !p.entry.earn);
    expect(paid).toHaveLength(73);
    const byId = (field: string, id: string): number | undefined => {
      const ref = paid.find((p) => p.field === field && p.id === id);
      return ref ? priceOf(ref.token) : undefined;
    };
    // Livery bands follow PATTERNS order: stripes, racing + geometric, organic, fades, special.
    expect(byId('pattern', 'stripe')).toBe(400);
    expect(byId('pattern', 'wideBand')).toBe(400);
    expect(byId('pattern', 'rally')).toBe(500);
    expect(byId('pattern', 'grid')).toBe(500);
    expect(byId('pattern', 'camo')).toBe(600);
    expect(byId('pattern', 'wave')).toBe(600);
    expect(byId('pattern', 'twoTone')).toBe(700);
    expect(byId('pattern', 'iridescent')).toBe(700);
    expect(byId('pattern', 'carbon')).toBe(1000);
    expect(byId('pattern', 'wireframe')).toBe(1000);
    expect(byId('badge', 'bolt')).toBe(300);
    expect(byId('wheelFx', 'spinBlur')).toBe(400);
    expect(byId('underglow', 'ripple')).toBe(500);
    expect(byId('trail', 'pixels')).toBe(600);
    expect(byId('flame', 'pulseJet')).toBe(700);
    expect(byId('enginePack', 'chiptune')).toBe(800);
    expect(paid.reduce((sum, p) => sum + (priceOf(p.token) ?? 0), 0)).toBe(42200);
  });

  it('priceOf answers undefined for what the table does not know', () => {
    expect(priceOf('p:0')).toBe(0);
    expect(priceOf('p:zz')).toBeUndefined();
    expect(priceOf('k:rosa')).toBeUndefined();
    expect(priceOf('nonsense')).toBeUndefined();
  });

  it('formats amounts with grouping', () => {
    expect(formatCoins(0)).toBe('0');
    expect(formatCoins(950)).toBe('950');
    expect(formatCoins(2500)).toBe('2,500');
    expect(formatCoins(1234567.9)).toBe('1,234,567');
  });
});

describe('levels', () => {
  it('100 to level 2, 50 more for each level after, capped at 30', () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelInfo(99)).toEqual({ level: 1, into: 99, need: 100 });
    expect(levelInfo(100)).toEqual({ level: 2, into: 0, need: 150 });
    expect(levelInfo(249)).toEqual({ level: 2, into: 149, need: 150 });
    expect(levelInfo(250)).toEqual({ level: 3, into: 0, need: 200 });
    // 100 + 150 + … + 1500 = 23,200 lifetime experience for the top level.
    expect(levelInfo(23199)).toMatchObject({ level: MAX_LEVEL - 1, need: 1500 });
    expect(levelInfo(23200)).toEqual({ level: MAX_LEVEL, into: 0, need: 0 });
    expect(levelInfo(999999)).toEqual({ level: MAX_LEVEL, into: 0, need: 0 });
    expect(levelInfo(-5).level).toBe(1);
    expect(levelInfo(Number.NaN).level).toBe(1);
  });

  it('race experience follows the table and the daily rate, not the difficulty', () => {
    expect([1, 2, 3, 4, 8].map((p) => raceXp(p, false, 0))).toEqual([60, 50, 40, 30, 30]);
    expect(raceXp(1, true, 0)).toBe(10);
    expect(raceXp(1, false, FULL_RACES)).toBe(18);
    expect(raceXp(1, false, RACE_CAP)).toBe(0);
  });
});

describe('check-in', () => {
  it('seven-day cycle that wraps', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(streakCoins)).toEqual([50, 60, 80, 100, 120, 150, 300]);
    expect(streakCoins(8)).toBe(50);
    expect(streakCoins(14)).toBe(300);
    expect(streakCoins(0)).toBe(50);
  });
});

describe('earn-only entries', () => {
  const earnOnly = paidCosmetics().filter((p) => p.entry.earn);

  it('there are 14: six by level, three by check-ins, five on the coin shelf', () => {
    expect(earnOnly).toHaveLength(14);
    const rules = earnOnly.map((p) => earnRule(p.token));
    expect(rules.filter((r) => r?.kind === 'level').map((r) => (r as { at: number }).at).sort((a, b) => a - b)).toEqual([5, 10, 15, 20, 25, 30]);
    expect(rules.filter((r) => r?.kind === 'days').map((r) => (r as { at: number }).at).sort((a, b) => a - b)).toEqual([7, 14, 30]);
    expect(rules.filter((r) => r?.kind === 'coins')).toHaveLength(5);
  });

  it('every earn-only entry has exactly one rule, and nothing else has one', () => {
    const tokens = [...Object.values(LEVEL_REWARDS), ...Object.values(STREAK_REWARDS), ...SHOWCASE];
    expect(new Set(tokens).size).toBe(tokens.length);
    expect([...tokens].sort()).toEqual(earnOnly.map((p) => p.token).sort());
    for (const p of paidCosmetics().filter((x) => !x.entry.earn)) expect(earnRule(p.token), p.token).toBeNull();
  });

  it('rewards are not for sale; the shelf is priced 1,500 to 2,500', () => {
    for (const token of [...Object.values(LEVEL_REWARDS), ...Object.values(STREAK_REWARDS)]) expect(priceOf(token), token).toBe(-1);
    const shelf = SHOWCASE.map((token) => priceOf(token) ?? 0);
    expect(Math.min(...shelf)).toBe(1500);
    expect(Math.max(...shelf)).toBe(2500);
  });
});

describe('missions', () => {
  it('sixteen candidates, at least four in each tier', () => {
    expect(MISSIONS).toHaveLength(16);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(16);
    for (const tier of [0, 1, 2]) expect(MISSIONS.filter((m) => m.tier === tier).length).toBeGreaterThanOrEqual(4);
  });

  it('parses stored keys, with or without a parameter', () => {
    expect(parseMissionKey('drift')).toMatchObject({ def: { id: 'drift', target: 10, stat: 'drift' }, param: '' });
    expect(parseMissionKey('track:coral_coast')).toMatchObject({ def: { id: 'track' }, param: 'coral_coast' });
    expect(parseMissionKey('class:heavy')?.param).toBe('heavy');
    expect(parseMissionKey('nonsense')).toBeNull();
  });
});
