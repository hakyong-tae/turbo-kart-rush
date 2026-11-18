import type { TrackDefinition } from '../../core/types';

/**
 * Windmill Way - morning on the farm. The beginner circuit of the second wave.
 *
 * The plan is a real one: the seaside circuit in the Dutch dunes, scaled to kart size (1 : 3.8)
 * and eased until every corner clears a kart-width road — which is why it is no longer the
 * rounded rectangle Sunny Circuit already is. What survives the scaling is the outline: the long
 * start straight into the banked right at the top, the climb east over the dune, the fast right
 * at the far end with a ramp on the way down, the right-left through the puddles (the fences
 * stand well back: cut it with a boost), the run home and the long last right onto the straight.
 * Control points come from `tools/track-from-plan.py` (real centreline -> relax -> spline fit; the
 * exact arguments are in its header). This file is the source of truth.
 * ~1120 m.
 */
export const windmillWay: TrackDefinition = {
  id: 'windmill_way',
  name: 'Windmill Way',
  theme: 'grassland',
  laps: 3,
  description: 'A seaside-dunes layout past the mill: a banked first corner, a climb to the jump, a muddy right-left and a way across the field if you have a boost to spare.',
  difficulty: 1,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0  t=0.000  finish line
    { x: 0.8, y: 0.2, z: -43.1 }, // 1  t=0.038
    { x: -1.1, y: 0.4, z: -81.9 }, // 2  t=0.073
    { x: 1.3, y: 1.2, z: -120.6 }, // 3  t=0.108
    { x: 3.4, y: 1.5, z: -133.4 }, // 4  t=0.119
    { x: 6.4, y: 1.6, z: -141.4 }, // 5  t=0.127
    { x: 20.1, y: 1.6, z: -151 }, // 6  t=0.142
    { x: 39.5, y: 1.4, z: -143.9 }, // 7  t=0.161
    { x: 55.7, y: 1.1, z: -118.7 }, // 8  t=0.188
    { x: 84.2, y: 1, z: -112.6 }, // 9  t=0.214
    { x: 116.7, y: 1.7, z: -123.9 }, // 10  t=0.245
    { x: 132.5, y: 2.3, z: -131 }, // 11  t=0.261
    { x: 155.4, y: 3, z: -142.9 }, // 12  t=0.284
    { x: 184.7, y: 3.4, z: -161.1 }, // 13  t=0.314
    { x: 226.1, y: 5.1, z: -184.2 }, // 14  t=0.357
    { x: 263.7, y: 4.6, z: -192.6 }, // 15  t=0.391
    { x: 284.6, y: 3.8, z: -187.8 }, // 16  t=0.411
    { x: 297.6, y: 3.1, z: -176.7 }, // 17  t=0.426
    { x: 305.7, y: 2.6, z: -152.5 }, // 18  t=0.449
    { x: 303, y: 2.4, z: -122.5 }, // 19  t=0.476
    { x: 296.6, y: 2.1, z: -97.5 }, // 20  t=0.499
    { x: 286.1, y: 2, z: -78.8 }, // 21  t=0.518
    { x: 268, y: 2.1, z: -67.7 }, // 22  t=0.537
    { x: 247.5, y: 2.4, z: -71.7 }, // 23  t=0.556
    { x: 239.3, y: 2.7, z: -86.5 }, // 24  t=0.572
    { x: 240, y: 3, z: -108 }, // 25  t=0.591
    { x: 236.2, y: 3, z: -124.5 }, // 26  t=0.606
    { x: 221.9, y: 2.9, z: -133.4 }, // 27  t=0.622
    { x: 200.9, y: 2.6, z: -129.8 }, // 28  t=0.641
    { x: 174.4, y: 2, z: -115.5 }, // 29  t=0.668
    { x: 129.7, y: 1.4, z: -89.4 }, // 30  t=0.714
    { x: 94.8, y: 1.3, z: -64.1 }, // 31  t=0.752
    { x: 82.6, y: 1.2, z: -51.9 }, // 32  t=0.768
    { x: 75, y: 1, z: -36.6 }, // 33  t=0.783
    { x: 74.8, y: 0.9, z: -19.5 }, // 34  t=0.799
    { x: 81.9, y: 0.7, z: 0.8 }, // 35  t=0.818
    { x: 88.8, y: 0.6, z: 16.6 }, // 36  t=0.833
    { x: 93.2, y: 0.5, z: 41.9 }, // 37  t=0.856
    { x: 84.1, y: 0.5, z: 61.1 }, // 38  t=0.875
    { x: 73.7, y: 0.4, z: 68.6 }, // 39  t=0.887
    { x: 57.2, y: 0.3, z: 73.4 }, // 40  t=0.902
    { x: 31.8, y: 0.2, z: 69.9 }, // 41  t=0.925
    { x: 14.6, y: 0.1, z: 57.2 }, // 42  t=0.944
    { x: 2, y: 0.1, z: 42.5 }, // 43  t=0.962
  ],
  halfWidth: 8.5,
  wallHalfWidthFactor: 1.6,
  // The wall steps back along the zigzag: straight-lining it across the off-road is shorter,
  // and only worth it with a boost.
  wallHalfWidthFactors: [1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6],
  itemBoxRows: [0.06, 0.265, 0.49, 0.7],
  boostPads: [0.215, 0.325, 0.645],
  ramps: [
    // Past the crest, so the landing is downhill.
    { t: 0.445, length: 10, height: 1.6 },
  ],
  zones: [
    // Puddles on the left half of the right-left.
    { from: 0.53, to: 0.59, kind: 'mud', lateral: [-8.5, 0] },
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
