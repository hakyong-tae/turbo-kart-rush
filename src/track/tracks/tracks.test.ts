import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { TrackDefinition } from '../../core/types';
import { coralCoast } from './coralCoast';
import { magmaRidge } from './magmaRidge';
import { prismSkyway } from './prismSkyway';
import { switchbackPass } from './switchbackPass';
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
  ['switchback_pass', switchbackPass, 'snow', 3],
  ['prism_skyway', prismSkyway, 'neon', 3],
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
  it('spaces its item rows and boost pads legally around the lap', () => {
    // Counts are the track designer's call — Prism Skyway chains three pads down its one straight
    // — but the placement rules are not: every t must be a real point on the lap, rows must not
    // sit on top of each other, and a lap needs enough of both to be worth driving twice.
    expect(def.itemBoxRows.length).toBeGreaterThanOrEqual(3);
    expect(def.boostPads.length).toBeGreaterThanOrEqual(3);
    for (const t of [...def.itemBoxRows, ...def.boostPads]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
    const L = lengthOf(def);
    for (const ts of [def.itemBoxRows, def.boostPads]) {
      const sorted = [...ts].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        // Two rows of the same thing inside 25 m read as one wide row and hand out double.
        expect((sorted[i] - sorted[i - 1]) * L).toBeGreaterThan(25);
      }
    }
  });
});
