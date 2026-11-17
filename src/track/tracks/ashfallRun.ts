import type { TrackDefinition } from '../../core/types';

/**
 * Ashfall Run - under the ash cloud.
 * Start straight -> right onto the first lava bridge: pad, ramp, fissure -> hairpin -> the middle
 * straight, lava boulders rolling down it toward you -> hairpin -> second bridge, second fissure ->
 * wide hairpin -> ash drifts over the inside of the long run home -> left, right, right onto the line.
 * ~1250 m.
 */
export const ashfallRun: TrackDefinition = {
  id: 'ashfall_run',
  name: 'Ashfall Run',
  theme: 'volcano',
  laps: 3,
  description: 'Two bridges over the lava, each with a fissure through it, and a straight between them where the mountain throws rocks at you.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, start straight
    { x: 0, y: 0.9, z: -46.7 },
    { x: 0, y: 2.6, z: -93.3 },
    { x: 0, y: 3.4, z: -140 },
    { x: 8.8, y: 4.8, z: -161.2 },
    { x: 30, y: 5, z: -170 },
    { x: 80, y: 4.3, z: -170 }, // first bridge: fissure
    { x: 130, y: 3.3, z: -170 },
    { x: 180, y: 3.1, z: -170 },
    { x: 201.2, y: 3.5, z: -161.2 },
    { x: 210, y: 4.2, z: -140 },
    { x: 201.2, y: 4.9, z: -118.8 },
    { x: 180, y: 5.4, z: -110 },
    { x: 125, y: 6.1, z: -110 }, // middle straight: lava boulders
    { x: 70, y: 7.8, z: -110 },
    { x: 48.8, y: 8, z: -101.2 },
    { x: 40, y: 7.8, z: -80 },
    { x: 48.8, y: 7.2, z: -58.8 },
    { x: 70, y: 6.5, z: -50 },
    { x: 120, y: 5.2, z: -50 }, // second bridge: fissure
    { x: 170, y: 4.9, z: -50 },
    { x: 220, y: 4.1, z: -50 },
    { x: 244.7, y: 3.6, z: -39.7 },
    { x: 255, y: 3.2, z: -15 },
    { x: 244.7, y: 3, z: 9.7 },
    { x: 220, y: 2.9, z: 20 },
    { x: 175, y: 2.4, z: 16 }, // ash drifts
    { x: 130, y: 1.7, z: 20 },
    { x: 108.8, y: 1.4, z: 28.8 },
    { x: 100, y: 1.1, z: 50 },
    { x: 100, y: 1, z: 60 },
    { x: 88.3, y: 1, z: 88.3 }, // last two rights
    { x: 60, y: 0.9, z: 100 },
    { x: 40, y: 0.7, z: 100 },
    { x: 11.7, y: 0.5, z: 88.3 },
    { x: 0, y: 0.2, z: 60 },
  ],
  halfWidth: 8,
  wallHalfWidthFactor: 1.35,
  itemBoxRows: [0.081, 0.246, 0.605, 0.753],
  boostPads: [0.051, 0.172, 0.531, 0.894],
  voidRanges: [[0.158, 0.262], [0.518, 0.621]],
  ramps: [
    // First fissure.
    { t: 0.203, length: 10, height: 2, gap: 7 },
    // Second fissure, a little wider.
    { t: 0.562, length: 10, height: 2, gap: 8 },
  ],
  zones: [
    // Ash over the inside of the run home.
    { from: 0.728, to: 0.768, kind: 'mud', look: 'ash', lateral: [-8, 0] },
  ],
  movers: [
    // Both keep to the right of the straight, half a run apart: the left is the way through.
    { kind: 'roller', from: 0.428, to: 0.353, speed: 8, lateral: 2.6, sway: 1.4, radius: 1.5, look: 'lava' },
    { kind: 'roller', from: 0.428, to: 0.353, speed: 8, lateral: 2.6, sway: 1.4, radius: 1.5, look: 'lava', phase: 0.5 },
  ],
  environment: {
    skyTop: 0x2b232b,
    skyHorizon: 0xd9703a,
    skyBottom: 0xf2b070,
    fogColor: 0x8f6452,
    fogDensity: 0.0024,
    sunColor: 0xffb888,
    sunIntensity: 2.3,
    sunDirection: { x: -0.5, y: 0.45, z: -0.74 },
    ambientSky: 0xd8a088,
    ambientGround: 0x4a2c22,
    ambientIntensity: 1.0,
  },
  palette: {
    road: 0x4c464a,
    roadStripe: 0xffc66a,
    curb: 0xe8452b,
    curbAlt: 0x2a2224,
    offroad: 0x5a4038,
    wall: 0x6a4a3e,
    ground: 0x3a2620,
  },
};
