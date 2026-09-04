import type { TrackDefinition } from '../../core/types';
import { sunnyCircuit } from './sunnyCircuit';
import { coralCoast } from './coralCoast';
import { duneDrift } from './duneDrift';
import { frostbiteFalls } from './frostbiteFalls';
import { neonNexus } from './neonNexus';
import { magmaRidge } from './magmaRidge';
import { validateAllTracks } from './validate';

export { sunnyCircuit, coralCoast, duneDrift, frostbiteFalls, neonNexus, magmaRidge };

/** The six race tracks, in menu order (easy -> hard). */
export const TRACKS: TrackDefinition[] = [sunnyCircuit, coralCoast, duneDrift, frostbiteFalls, neonNexus, magmaRidge];

/** Look up a track by id; falls back to the first track for unknown ids. */
export function getTrackDef(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

if (import.meta.env.DEV) {
  validateAllTracks(TRACKS);
}
