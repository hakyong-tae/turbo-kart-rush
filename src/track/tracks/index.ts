import type { TrackDefinition } from '../../core/types';
import { sunnyCircuit } from './sunnyCircuit';
import { coralCoast } from './coralCoast';
import { duneDrift } from './duneDrift';
import { frostbiteFalls } from './frostbiteFalls';
import { neonNexus } from './neonNexus';
import { magmaRidge } from './magmaRidge';
import { switchbackPass } from './switchbackPass';
import { prismSkyway } from './prismSkyway';
import { validateAllTracks } from './validate';

export { sunnyCircuit, coralCoast, duneDrift, frostbiteFalls, neonNexus, magmaRidge, switchbackPass, prismSkyway };

/**
 * The eight race tracks, in menu order (easy -> hard). Adding one here also needs the id in
 * `TRACKS` in root server.js, or times set on it are rejected by the leaderboard.
 */
export const TRACKS: TrackDefinition[] = [
  sunnyCircuit,
  coralCoast,
  duneDrift,
  frostbiteFalls,
  neonNexus,
  magmaRidge,
  switchbackPass,
  prismSkyway,
];

/** Look up a track by id; falls back to the first track for unknown ids. */
export function getTrackDef(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

if (import.meta.env.DEV) {
  validateAllTracks(TRACKS);
}
