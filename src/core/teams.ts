/**
 * Team race rules (contract addition, gameplay-4).
 *
 *   teamPoints — every finisher scores by place (10/8/6/5/4/3/2/1), retirees 0; higher total wins.
 *   teamFirst  — the team that owns 1st place wins outright, whatever the rest did.
 *
 * Teams are fixed by kart slot: even ids = RED, odd ids = BLUE (4 v 4 with 8 karts), so every
 * client and the host agree without any extra network state.
 */
import type { RaceMode, RaceStanding, Team } from './types';

export const POINTS_BY_PLACE: readonly number[] = [10, 8, 6, 5, 4, 3, 2, 1];
export const TEAM_COLORS: Readonly<Record<Team, number>> = { red: 0xff3b4a, blue: 0x3a7bff };

export function teamOf(kartId: number): Team {
  return kartId % 2 === 0 ? 'red' : 'blue';
}

export function isTeamMode(mode: RaceMode | undefined): mode is 'teamPoints' | 'teamFirst' {
  return mode === 'teamPoints' || mode === 'teamFirst';
}

/** Points for a finishing place; retirees (no finish time) and out-of-range places score 0. */
export function pointsFor(place: number, finishTime: number): number {
  if (!(finishTime > 0)) return 0;
  if (place < 1 || place > POINTS_BY_PLACE.length) return 0;
  return POINTS_BY_PLACE[place - 1];
}

export interface TeamResult {
  mode: RaceMode;
  red: number;
  blue: number;
  /** Team holding 1st place (null when nobody finished). */
  firstTeam: Team | null;
  winner: Team | 'draw';
}

export function computeTeamResult(standings: readonly RaceStanding[], mode: RaceMode): TeamResult {
  let red = 0;
  let blue = 0;
  let firstTeam: Team | null = null;
  for (const s of standings) {
    const team = s.team ?? teamOf(s.kartId);
    const pts = pointsFor(s.place, s.finishTime);
    if (team === 'red') red += pts;
    else blue += pts;
    if (s.place === 1 && s.finishTime > 0) firstTeam = team;
  }
  let winner: Team | 'draw';
  if (mode === 'teamFirst') winner = firstTeam ?? 'draw';
  else winner = red === blue ? 'draw' : red > blue ? 'red' : 'blue';
  return { mode, red, blue, firstTeam, winner };
}
