/**
 * Grand Prix cups (contract addition, progression).
 *
 * Three tracks, cumulative points, finish top three to open the next cup. All of it reuses what a
 * single race already produces — the `POINTS_BY_PLACE` table and a `RaceStanding[]` — so a cup is
 * bookkeeping over races that already work, not a second game mode.
 *
 * Pure: no DOM, no storage, no Three. Game owns the flow, this owns the rules.
 */
import type { RaceStanding } from './types';
import { pointsFor } from './teams';

export type CupId = 'rookie' | 'pro' | 'championship';

export interface CupDef {
  id: CupId;
  trackIds: readonly string[];
  /** Cup that must be podiumed first. Absent = open from the start. */
  requires?: CupId;
}

/**
 * Rookie is the three gentler circuits, Pro the three that punish, Championship is all six.
 * Track ids must exist in `src/track/tracks`; `cups.test.ts` checks that they do.
 */
export const CUPS: readonly CupDef[] = [
  { id: 'rookie', trackIds: ['sunny_circuit', 'coral_coast', 'dune_drift'] },
  { id: 'pro', trackIds: ['frostbite_falls', 'neon_nexus', 'magma_ridge'], requires: 'rookie' },
  {
    id: 'championship',
    trackIds: ['sunny_circuit', 'coral_coast', 'dune_drift', 'frostbite_falls', 'neon_nexus', 'magma_ridge'],
    requires: 'pro',
  },
];

/** Podium finish or better opens the next cup. */
export const UNLOCK_PLACE = 3;

export function getCup(id: CupId): CupDef {
  const cup = CUPS.find((c) => c.id === id);
  if (!cup) throw new Error(`Unknown cup: ${id}`);
  return cup;
}

/** Per-account cup record: the best final placing in each cup. Missing = never finished. */
export type CupProgress = Partial<Record<CupId, number>>;

export function isCupUnlocked(id: CupId, progress: CupProgress): boolean {
  const cup = getCup(id);
  if (!cup.requires) return true;
  const best = progress[cup.requires];
  return best !== undefined && best > 0 && best <= UNLOCK_PLACE;
}

/** Records a cup result, keeping the better placing. Returns a new object; never mutates. */
export function recordCupResult(progress: CupProgress, id: CupId, place: number): CupProgress {
  if (place <= 0) return progress;
  const best = progress[id];
  if (best !== undefined && best <= place) return progress;
  return { ...progress, [id]: place };
}

// --- scoring -----------------------------------------------------------------

export interface CupEntry {
  kartId: number;
  name: string;
  characterId?: string;
  cos?: string;
  points: number;
  /** Places taken so far, in race order. */
  places: number[];
  isPlayer: boolean;
}

/**
 * Running cup table after `standings` is added to `table`.
 *
 * Ties break on the better single finish, then on kart id, so the order is stable across clients
 * and across races — a cup that reshuffled equal-point racers every round would read as a bug.
 */
export function addRaceToCup(table: readonly CupEntry[], standings: readonly RaceStanding[]): CupEntry[] {
  const byKart = new Map<number, CupEntry>();
  for (const e of table) byKart.set(e.kartId, { ...e, places: e.places.slice() });
  for (const s of standings) {
    // Same table and the same retirement rule as a team race: no finish time, no points.
    const points = pointsFor(s.place, s.finishTime);
    const existing = byKart.get(s.kartId);
    if (existing) {
      existing.points += points;
      existing.places.push(s.place);
      // The name and look can change between races (a re-picked kart); keep the latest.
      existing.name = s.name;
      existing.characterId = s.characterId ?? existing.characterId;
      existing.cos = s.cos ?? existing.cos;
    } else {
      byKart.set(s.kartId, {
        kartId: s.kartId,
        name: s.name,
        characterId: s.characterId,
        cos: s.cos,
        points,
        places: [s.place],
        isPlayer: s.isPlayer,
      });
    }
  }
  return sortCup(Array.from(byKart.values()));
}

export function sortCup(entries: CupEntry[]): CupEntry[] {
  return entries.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const bestA = a.places.length > 0 ? Math.min(...a.places) : Infinity;
    const bestB = b.places.length > 0 ? Math.min(...b.places) : Infinity;
    if (bestA !== bestB) return bestA - bestB;
    return a.kartId - b.kartId;
  });
}

/** 1-based cup placing for the local player, or 0 when they are not in the table. */
export function cupPlaceOf(table: readonly CupEntry[]): number {
  const i = table.findIndex((e) => e.isPlayer);
  return i < 0 ? 0 : i + 1;
}
