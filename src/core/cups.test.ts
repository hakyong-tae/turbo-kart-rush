import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track/tracks';
import {
  CUPS,
  addRaceToCup,
  cupPlaceOf,
  cupsOpenedBy,
  goldCount,
  nextCupGoal,
  trophyFor,
  isCupUnlocked,
  recordCupResult,
  type CupEntry,
  type CupProgress,
} from './cups';
import type { RaceStanding } from './types';

const standing = (kartId: number, place: number, opts: Partial<RaceStanding> = {}): RaceStanding => ({
  kartId,
  name: `K${kartId}`,
  color: 0,
  place,
  finishTime: 60 + place,
  isPlayer: kartId === 0,
  ...opts,
});

/** One race where kart i finished in place i+1. */
const race = (order: number[]): RaceStanding[] => order.map((kartId, i) => standing(kartId, i + 1));

describe('cup definitions', () => {
  it('only names tracks that exist', () => {
    const ids = new Set(TRACKS.map((t) => t.id));
    for (const cup of CUPS) for (const id of cup.trackIds) expect(ids.has(id), `${cup.id}: ${id}`).toBe(true);
  });

  it('every track is raced in some cup, and each cup has at least three', () => {
    const raced = new Set(CUPS.flatMap((c) => c.trackIds));
    for (const t of TRACKS) expect(raced.has(t.id), t.id).toBe(true);
    for (const cup of CUPS) {
      expect(cup.trackIds.length, cup.id).toBeGreaterThanOrEqual(3);
      expect(new Set(cup.trackIds).size, cup.id).toBe(cup.trackIds.length);
    }
  });

  it('a cup only waits on a cup that exists and is listed before it', () => {
    CUPS.forEach((cup, i) => {
      if (!cup.requires) return;
      const at = CUPS.findIndex((c) => c.id === cup.requires);
      expect(at, cup.id).toBeGreaterThanOrEqual(0);
      expect(at, cup.id).toBeLessThan(i);
    });
  });
});

describe('unlocking', () => {
  it('opens the first cup to everyone and gates the rest behind a podium', () => {
    const none: CupProgress = {};
    expect(isCupUnlocked('rookie', none)).toBe(true);
    expect(isCupUnlocked('pro', none)).toBe(false);
    expect(isCupUnlocked('pro', { rookie: 4 })).toBe(false);
    expect(isCupUnlocked('pro', { rookie: 3 })).toBe(true);
    expect(isCupUnlocked('championship', { rookie: 1 })).toBe(false);
    expect(isCupUnlocked('championship', { rookie: 1, pro: 2 })).toBe(true);
    expect(isCupUnlocked('stunt', none)).toBe(false);
    expect(isCupUnlocked('stunt', { rookie: 3 })).toBe(true);
    expect(isCupUnlocked('extreme', { rookie: 1, stunt: 1 })).toBe(false);
    expect(isCupUnlocked('extreme', { rookie: 1, pro: 3 })).toBe(true);
  });

  it('keeps the best placing and never regresses', () => {
    let p: CupProgress = {};
    p = recordCupResult(p, 'rookie', 5);
    expect(p.rookie).toBe(5);
    p = recordCupResult(p, 'rookie', 2);
    expect(p.rookie).toBe(2);
    p = recordCupResult(p, 'rookie', 7);
    expect(p.rookie).toBe(2);
    // A cup abandoned before the last race reports no placing at all.
    expect(recordCupResult(p, 'pro', 0).pro).toBeUndefined();
  });
});

describe('cup scoring', () => {
  it('accumulates points across races and ranks by total', () => {
    let table: CupEntry[] = [];
    table = addRaceToCup(table, race([1, 0, 2])); // kart1 10, kart0 8, kart2 6
    table = addRaceToCup(table, race([0, 2, 1])); // kart0 +10, kart2 +8, kart1 +6
    expect(table.map((e) => [e.kartId, e.points])).toEqual([
      [0, 18],
      [1, 16],
      [2, 14],
    ]);
    expect(cupPlaceOf(table)).toBe(1);
  });

  it('scores a retirement as zero and still tracks the entrant', () => {
    const table = addRaceToCup([], [standing(0, 1), standing(1, 2, { finishTime: -1 })]);
    expect(table.map((e) => e.points)).toEqual([10, 0]);
    expect(table[1].places).toEqual([2]);
  });

  it('breaks a points tie on the better single finish, then on kart id', () => {
    let table: CupEntry[] = [];
    // kart0: 2nd then 3rd (8+6). kart1: 3rd then 2nd (6+8). Equal points, kart0 has the better 2nd.
    table = addRaceToCup(table, race([2, 0, 1]));
    table = addRaceToCup(table, race([2, 1, 0]));
    expect(table.map((e) => e.kartId)).toEqual([2, 0, 1]);
    expect(table[1].points).toBe(table[2].points);
  });

  it('is stable: replaying the same races gives the same order', () => {
    const races = [race([3, 1, 0, 2]), race([1, 3, 2, 0]), race([0, 2, 1, 3])];
    const once = races.reduce<CupEntry[]>((t, r) => addRaceToCup(t, r), []);
    const twice = races.reduce<CupEntry[]>((t, r) => addRaceToCup(t, r), []);
    expect(twice.map((e) => e.kartId)).toEqual(once.map((e) => e.kartId));
  });

  it('carries the latest name and look so the cup table can show the kart', () => {
    let table = addRaceToCup([], [standing(0, 1, { characterId: 'zippy', cos: 'b:ff0000' })]);
    table = addRaceToCup(table, [standing(0, 2, { name: 'Renamed', cos: 'b:00ff00' })]);
    expect(table[0].name).toBe('Renamed');
    expect(table[0].cos).toBe('b:00ff00');
    expect(table[0].characterId).toBe('zippy');
  });
});

describe('trophies and the next goal', () => {
  it('reads a placing as a medal', () => {
    expect(trophyFor(1)).toBe('gold');
    expect(trophyFor(2)).toBe('silver');
    expect(trophyFor(3)).toBe('bronze');
    expect(trophyFor(4)).toBeNull();
    expect(trophyFor(undefined)).toBeNull();
  });

  it('points a new account at the Rookie Cup', () => {
    expect(nextCupGoal({})).toBe('rookie');
  });

  it('moves on to an unraced open cup before asking for a better colour', () => {
    // A bronze in Rookie opens Pro and Stunt; Pro has no trophy yet, so it comes first.
    expect(nextCupGoal({ rookie: 3 })).toBe('pro');
    // Every open cup has some trophy: the first one short of gold.
    expect(nextCupGoal({ rookie: 3, pro: 2, stunt: 1, championship: 1, extreme: 1 })).toBe('rookie');
  });

  it('stays on a cup that is open but not podiumed', () => {
    expect(nextCupGoal({ rookie: 5 })).toBe('rookie');
  });

  it('has nothing left when every cup is gold', () => {
    const all: CupProgress = {};
    for (const c of CUPS) all[c.id] = 1;
    expect(nextCupGoal(all)).toBeNull();
    expect(goldCount(all)).toBe(CUPS.length);
  });

  it('names the cups a finish opens', () => {
    expect(cupsOpenedBy({}, 'rookie', 2).sort()).toEqual(['pro', 'stunt']);
    expect(cupsOpenedBy({}, 'rookie', 4)).toEqual([]);
    expect(cupsOpenedBy({ rookie: 3 }, 'rookie', 1)).toEqual([]);
  });
});
