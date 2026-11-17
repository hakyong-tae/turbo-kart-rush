import type { TrackDefinition } from '../../core/types';

/**
 * Windmill Way - morning on the farm. The beginner circuit of the second wave.
 * Start straight -> two wide right-handers over the hill -> downhill straight with a gentle ramp ->
 * right-left chicane through the puddles (the fences stand well back: cut it with a boost) ->
 * open hairpin back to the line.
 * ~900 m.
 */
export const windmillWay: TrackDefinition = {
  id: 'windmill_way',
  name: 'Windmill Way',
  theme: 'grassland',
  laps: 3,
  description: 'A lazy loop past the mill: one hill, one jump, a muddy chicane and a way across the field if you have a boost to spare.',
  difficulty: 1,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, start straight
    { x: 0, y: 0.2, z: -56 },
    { x: 0, y: 0.5, z: -112 },
    { x: 0, y: 1.1, z: -168 },
    { x: 14.1, y: 2.3, z: -201.9 }, // right over the hill
    { x: 48, y: 3.3, z: -216 },
    { x: 96, y: 3.6, z: -216 },
    { x: 144, y: 4.5, z: -216 },
    { x: 177.9, y: 5, z: -201.9 },
    { x: 192, y: 4.6, z: -168 },
    { x: 192, y: 2.8, z: -120 }, // downhill straight: the ramp
    { x: 192, y: 2, z: -72 },
    { x: 179.7, y: 1.6, z: -42.3 }, // chicane, right
    { x: 150, y: 1, z: -30 },
    { x: 108, y: 0.5, z: -30 },
    { x: 78.3, y: 0.5, z: -17.7 }, // chicane, left
    { x: 66, y: 0.4, z: 12 },
    { x: 66, y: 0.3, z: 60 },
    { x: 56.3, y: 0.3, z: 83.3 }, // open hairpin
    { x: 33, y: 0.2, z: 93 },
    { x: 9.7, y: 0.1, z: 83.3 },
    { x: 0, y: 0.1, z: 60 },
  ],
  halfWidth: 8.5,
  wallHalfWidthFactor: 1.6,
  // The wall steps back along the zigzag: straight-lining it across the off-road is shorter,
  // and only worth it with a boost.
  wallHalfWidthFactors: [1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 2.5, 2.5, 2.5, 2.5, 2.5, 1.6, 1.6, 1.6, 1.6, 1.6],
  itemBoxRows: [0.112, 0.325, 0.561, 0.809],
  boostPads: [0.277, 0.468, 0.78],
  ramps: [
    // Past the crest, so the landing is downhill.
    { t: 0.497, length: 10, height: 1.6 },
  ],
  zones: [
    // Puddles on the left half of the chicane.
    { from: 0.625, to: 0.709, kind: 'mud', lateral: [-8.5, 0] },
  ],
  environment: {
    skyTop: 0x4a86e0,
    skyHorizon: 0xffe3b8,
    skyBottom: 0xfff3df,
    fogColor: 0xfbe6c9,
    fogDensity: 0.0018,
    sunColor: 0xffe2b0,
    sunIntensity: 2.4,
    sunDirection: { x: 0.6, y: 0.5, z: 0.62 },
    ambientSky: 0xbcd4ff,
    ambientGround: 0x7f9a55,
    ambientIntensity: 0.9,
  },
  palette: {
    road: 0x55524e,
    roadStripe: 0xfff7e0,
    curb: 0xf2b632,
    curbAlt: 0xffffff,
    offroad: 0x6aa544,
    wall: 0x6b4a2e,
    ground: 0x5c9a3c,
  },
};
