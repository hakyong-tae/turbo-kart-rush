import { describe, expect, it } from 'vitest';
import { computeTeamResult, pointsFor, teamOf } from './teams';
import type { RaceStanding } from './types';

function standing(kartId: number, place: number, finishTime: number): RaceStanding {
  return { kartId, name: `K${kartId}`, color: 0, place, finishTime, isPlayer: kartId === 0 };
}

describe('teams', () => {
  it('splits eight karts 4 v 4 by slot parity', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(teamOf)).toEqual(['red', 'blue', 'red', 'blue', 'red', 'blue', 'red', 'blue']);
  });

  it('scores 10/8/6/5/4/3/2/1 and 0 for retirees', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => pointsFor(p, 100))).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(pointsFor(1, -1)).toBe(0);
    expect(pointsFor(9, 100)).toBe(0);
  });

  it('points mode: totals decide, retirees add nothing', () => {
    // red: P1(10) + P4(5) + P5(4) + DNF(0) = 19 ; blue: P2(8) + P3(6) + P6(3) + P7(2) = 19 → draw
    const s = [standing(0, 1, 90), standing(1, 2, 91), standing(3, 3, 92), standing(2, 4, 93), standing(4, 5, 94), standing(5, 6, 95), standing(7, 7, 96), standing(6, 8, -1)];
    const r = computeTeamResult(s, 'teamPoints');
    expect(r.red).toBe(19);
    expect(r.blue).toBe(19);
    expect(r.winner).toBe('draw');
    // Give blue one more place.
    const r2 = computeTeamResult([standing(0, 1, 90), standing(1, 2, 91), standing(3, 3, 92), standing(5, 4, 93)], 'teamPoints');
    expect(r2.winner).toBe('blue');
  });

  it('first-place mode: the team with P1 wins even when the other team fills 2nd–5th', () => {
    const s = [standing(0, 1, 90), standing(1, 2, 91), standing(3, 3, 92), standing(5, 4, 93), standing(7, 5, 94), standing(2, 6, 95), standing(4, 7, 96), standing(6, 8, 97)];
    const r = computeTeamResult(s, 'teamFirst');
    expect(r.firstTeam).toBe('red');
    expect(r.winner).toBe('red');
    expect(r.blue).toBeGreaterThan(r.red); // points would have said blue
  });
});
