import { describe, expect, it } from 'vitest';
import { TRACKS } from '../track/tracks';
import {
  CUPS,
  addRaceToCup,
  cupPlaceOf,
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

  it('the championship runs every track and each cup has at least three', () => {
    const champ = CUPS.find((c) => c.id === 'championship');
    expect(champ?.trackIds.length).toBe(TRACKS.length);
    for (const cup of CUPS) expect(cup.trackIds.length, cup.id).toBeGreaterThanOrEqual(3);
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
