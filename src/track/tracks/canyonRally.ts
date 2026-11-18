import type { TrackDefinition } from '../../core/types';

/**
 * Canyon Rally - high noon in the canyon.
 *
 * The plan is a real one: the desert grand-prix circuit, scaled to kart size (1 : 4.2) and eased
 * until every corner clears a kart-width road, so it reads nothing like Dune Drift's loop. What
 * survives the scaling is the outline: the long start straight (boulders roll down it toward you)
 * into the first right, the top straight out to the far hairpin, back through the kink (the
 * canyon walls stand well back there: cut straight across the sand if you carry a boost) to the
 * inner hairpin, down the infield, round the hook, and the long diagonal descent over two dune
 * ramps to the last right onto the line.
 * Control points come from `tools/track-from-plan.py` (real centreline -> relax -> spline fit; the
 * exact arguments are in its header). This file is the source of truth.
 * ~1295 m.
 */
export const canyonRally: TrackDefinition = {
  id: 'canyon_rally',
  name: 'Canyon Rally',
  theme: 'desert',
  laps: 3,
  description: 'A desert grand-prix layout: boulders roll down the start straight, the kink can be cut across the sand, and two dunes launch you down the long diagonal.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0  t=0.000  finish line: boulders come down this straight
    { x: 0.4, y: 0.2, z: -39.9 }, // 1  t=0.031
    { x: 0.9, y: 0.6, z: -79.8 }, // 2  t=0.062
    { x: 0.7, y: 0.8, z: -94.7 }, // 3  t=0.073
    { x: -0.2, y: 1, z: -139.6 }, // 4  t=0.108
    { x: -1.2, y: 1.9, z: -184.4 }, // 5  t=0.143
    { x: 6.7, y: 2.4, z: -232.6 }, // 6  t=0.181
    { x: 48.3, y: 3.5, z: -245.9 }, // 7  t=0.215
    { x: 88.1, y: 4.8, z: -245.6 }, // 8  t=0.246
    { x: 112.8, y: 5.5, z: -242.6 }, // 9  t=0.266
    { x: 137.5, y: 5.9, z: -239.2 }, // 10  t=0.285
    { x: 162.2, y: 6, z: -235.7 }, // 11  t=0.304
    { x: 196.3, y: 6.1, z: -228.6 }, // 12  t=0.331
    { x: 208.9, y: 6.2, z: -220.8 }, // 13  t=0.343
    { x: 215, y: 6.4, z: -202.5 }, // 14  t=0.358
    { x: 200.8, y: 6.5, z: -176.5 }, // 15  t=0.381
    { x: 188.2, y: 6.6, z: -161.1 }, // 16  t=0.396
    { x: 178.2, y: 6.6, z: -150 }, // 17  t=0.408
    { x: 174.5, y: 6.7, z: -146.6 }, // 18  t=0.412
    { x: 157.9, y: 6.9, z: -135.6 }, // 19  t=0.427
    { x: 131.4, y: 7.6, z: -121.8 }, // 20  t=0.450
    { x: 107.9, y: 8.2, z: -114.6 }, // 21  t=0.470
    { x: 76.8, y: 8.6, z: -137.4 }, // 22  t=0.500
    { x: 62.6, y: 8.6, z: -134.2 }, // 23  t=0.512
    { x: 55.3, y: 8.4, z: -121.5 }, // 24  t=0.523
    { x: 54.5, y: 8, z: -91.6 }, // 25  t=0.546
    { x: 56.4, y: 7.7, z: -71.8 }, // 26  t=0.562
    { x: 58.1, y: 7.4, z: -56.9 }, // 27  t=0.573
    { x: 60, y: 7.1, z: -37.1 }, // 28  t=0.589
    { x: 72, y: 6.8, z: 0.2 }, // 29  t=0.619
    { x: 99.7, y: 6.9, z: 3.1 }, // 30  t=0.642
    { x: 133.6, y: 7.5, z: -33 }, // 31  t=0.680
    { x: 155.1, y: 7.6, z: -45 }, // 32  t=0.700
    { x: 174.9, y: 7.7, z: -44.8 }, // 33  t=0.715
    { x: 195.8, y: 7.8, z: -32.1 }, // 34  t=0.734
    { x: 200.6, y: 7.8, z: -13.3 }, // 35  t=0.750
    { x: 187.6, y: 7.4, z: 7.4 }, // 36  t=0.769
    { x: 171.7, y: 6.9, z: 19.3 }, // 37  t=0.784
    { x: 129.5, y: 4.7, z: 45.9 }, // 38  t=0.823
    { x: 91.5, y: 2.7, z: 69.7 }, // 39  t=0.857
    { x: 53.1, y: 1.6, z: 92.9 }, // 40  t=0.892
    { x: 39.3, y: 1.6, z: 98.6 }, // 41  t=0.904
    { x: 24.5, y: 1.4, z: 99.6 }, // 42  t=0.915
    { x: 11.6, y: 1.1, z: 92.4 }, // 43  t=0.927
    { x: 2.3, y: 0.6, z: 69.7 }, // 44  t=0.946
    { x: 0.5, y: 0.5, z: 49.8 }, // 45  t=0.961
  ],
  halfWidth: 8.5,
  wallHalfWidthFactor: 1.35,
  // The wall steps back along the zigzag: straight-lining it across the off-road is shorter,
  // and only worth it with a boost.
  wallHalfWidthFactors: [1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35],
  itemBoxRows: [0.185, 0.385, 0.57, 0.705],
  boostPads: [0.165, 0.335, 0.675],
  ramps: [
    { t: 0.785, length: 10, height: 2.2 },
    { t: 0.84, length: 9, height: 2 },
  ],
  movers: [
    // Keeps to the left; the right-hand side is the way through.
    { kind: 'roller', from: 0.118, to: 0.035, speed: 8, lateral: -3, sway: 1.2, radius: 1.5, look: 'boulder' },
  ],
  environment: {
    skyTop: 0x2c7fe0,
    skyHorizon: 0xbfe3ff,
    skyBottom: 0xfff0d0,
    fogColor: 0xf0dcb8,
    fogDensity: 0.0016,
    sunColor: 0xfff1d0,
    sunIntensity: 3.0,
    sunDirection: { x: 0.2, y: 0.9, z: 0.39 },
    ambientSky: 0xcfe3ff,
    ambientGround: 0xb8834a,
    ambientIntensity: 0.9,
  },
  palette: {
    road: 0x6a5a4c,
    roadStripe: 0xfff4c0,
    curb: 0xb5402a,
    curbAlt: 0xf6e9cc,
    offroad: 0xe0aa64,
    wall: 0xb9773f,
    ground: 0xd9a055,
  },
};
