import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { TrackDefinition } from '../../core/types';
import { coralCoast } from './coralCoast';
import { magmaRidge } from './magmaRidge';
import { validateTrackDefinition } from './validate';

function lengthOf(def: TrackDefinition): number {
  const pts = def.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  curve.arcLengthDivisions = 1000;
  return curve.getLength();
}

describe.each([
  ['coral_coast', coralCoast, 'beach', 2],
  ['magma_ridge', magmaRidge, 'volcano', 3],
] as const)('%s', (id, def, theme, difficulty) => {
  it('has the expected identity', () => {
    expect(def.id).toBe(id);
    expect(def.theme).toBe(theme);
    expect(def.difficulty).toBe(difficulty);
    expect(def.laps).toBe(3);
  });
  it('passes the geometry validator', () => {
    expect(validateTrackDefinition(def)).toEqual([]);
  });
  it('is 900..1400 m long', () => {
    const L = lengthOf(def);
    expect(L).toBeGreaterThan(900);
    expect(L).toBeLessThan(1400);
  });
  it('places item rows and pads inside [0,1) with 4 rows / 3 pads', () => {
    expect(def.itemBoxRows).toHaveLength(4);
    expect(def.boostPads).toHaveLength(3);
    for (const t of [...def.itemBoxRows, ...def.boostPads]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
  });
});
