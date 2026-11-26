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

export type CupId = 'rookie' | 'pro' | 'championship' | 'stunt' | 'extreme';

export interface CupDef {
  id: CupId;
  trackIds: readonly string[];
  /** Cup that must be podiumed first. Absent = open from the start. */
  requires?: CupId;
}

/**
 * Rookie is the three gentler circuits, Pro the three that punish, Championship is the original
 * eight end to end. The second wave of circuits has its own ladder: Stunt (the four easier ones,
 * open after a Rookie podium) and Extreme (the four hard ones, open after a Pro podium). Every
 * circuit is in at least one cup; `cups.test.ts` checks that, and that the ids exist.
 *
 * Order is display order. Root server.js keeps the same id list (`CUPS`).
 */
export const CUPS: readonly CupDef[] = [
  // Sunny Circuit is a new player's very first race, so the Rookie Cup opens somewhere new and
  // comes back to it in the middle.
  { id: 'rookie', trackIds: ['coral_coast', 'sunny_circuit', 'dune_drift'] },
  { id: 'pro', trackIds: ['frostbite_falls', 'neon_nexus', 'magma_ridge'], requires: 'rookie' },
  {
    id: 'championship',
    trackIds: [
      'sunny_circuit',
      'coral_coast',
      'dune_drift',
      'frostbite_falls',
      'neon_nexus',
      'magma_ridge',
      'switchback_pass',
      'prism_skyway',
    ],
    requires: 'pro',
  },
  { id: 'stunt', trackIds: ['windmill_way', 'tidal_run', 'stunt_park', 'tram_town'], requires: 'rookie' },
  { id: 'extreme', trackIds: ['canyon_rally', 'glacier_gap', 'ashfall_run', 'skyline_loop'], requires: 'pro' },
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

// --- trophies and the next goal -----------------------------------------------------

/**
 * A cup's trophy is its best placing read as a medal: first is gold, then silver, then bronze.
 * Fourth or worse, or never finished, is no trophy. The shelf in the lobby and the ceremony at
 * the end of a cup both read it from the same `CupProgress` the unlocks already use, so a trophy
 * needs no record of its own.
 */
export type Trophy = 'gold' | 'silver' | 'bronze';

export function trophyFor(place: number | undefined): Trophy | null {
  if (place === 1) return 'gold';
  if (place === 2) return 'silver';
  if (place === 3) return 'bronze';
  return null;
}

/** Gold trophies on the shelf, out of `CUPS.length`. */
export function goldCount(progress: CupProgress): number {
  return CUPS.filter((c) => progress[c.id] === 1).length;
}

/**
 * The cup to point the player at next: the first one in display order that is open and not yet
 * won outright. One with no trophy at all comes before one that only needs a better colour, so a
 * bronze in the Rookie Cup does not hold the player there while the Pro Cup sits unraced.
 * Null when every cup is gold.
 */
export function nextCupGoal(progress: CupProgress): CupId | null {
  const open = CUPS.filter((c) => isCupUnlocked(c.id, progress) && progress[c.id] !== 1);
  const fresh = open.find((c) => trophyFor(progress[c.id]) === null);
  return (fresh ?? open[0])?.id ?? null;
}

/** Cups that `place` in cup `id` opens which were closed under `before`. */
export function cupsOpenedBy(before: CupProgress, id: CupId, place: number): CupId[] {
  const after = recordCupResult(before, id, place);
  return CUPS.filter((c) => !isCupUnlocked(c.id, before) && isCupUnlocked(c.id, after)).map((c) => c.id);
}

// --- a cup left part-way --------------------------------------------------------------

/**
 * A cup the player stepped out of: which cup, how many of its races are done, the table so far
 * and the settings it runs on. Kept on the device so leaving for the lobby (or closing the tab)
 * between races does not throw the cup away.
 */
export interface CupRun {
  id: CupId;
  /** Races finished; the next one to run is `trackIds[done]`. */
  done: number;
  table: CupEntry[];
  characterId: string;
  difficulty: 'easy' | 'normal' | 'hard';
}

/** Reads a stored run back, or null when it is missing, damaged, or names a cup that is over. */
export function parseCupRun(raw: string | null): CupRun | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CupRun>;
    const cup = CUPS.find((c) => c.id === v.id);
    if (!cup || typeof v.done !== 'number' || !Number.isInteger(v.done)) return null;
    if (v.done < 0 || v.done >= cup.trackIds.length) return null;
    if (!Array.isArray(v.table) || typeof v.characterId !== 'string') return null;
    if (v.difficulty !== 'easy' && v.difficulty !== 'normal' && v.difficulty !== 'hard') return null;
    const table = v.table.filter(
      (e): e is CupEntry =>
        Boolean(e) && typeof e.kartId === 'number' && typeof e.name === 'string' && typeof e.points === 'number' && Array.isArray(e.places),
    );
    return { id: cup.id, done: v.done, table: sortCup(table), characterId: v.characterId, difficulty: v.difficulty };
  } catch {
    return null;
  }
}
