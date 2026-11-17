import type { TrackDefinition } from '../../core/types';

/**
 * Canyon Rally - high noon in the canyon.
 * Start straight, boulders rolling down it toward you -> wide right, climbing -> zigzag
 * (right-left-right) with the canyon walls set back: cut straight across the sand if you carry a boost ->
 * long descent over two dune ramps -> right, left, right through the wash -> right onto the line.
 * ~1150 m.
 */
export const canyonRally: TrackDefinition = {
  id: 'canyon_rally',
  name: 'Canyon Rally',
  theme: 'desert',
  laps: 3,
  description: 'Boulders roll down the start straight, the zigzag can be cut across the sand, and two dunes launch you down the far side.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line: boulders come down this straight
    { x: 0, y: 0.3, z: -60 },
    { x: 0, y: 0.8, z: -120 },
    { x: 0, y: 1, z: -180 },
    { x: 16.1, y: 2, z: -218.9 },
    { x: 55, y: 3.8, z: -235 },
    { x: 90, y: 5.2, z: -230 },
    { x: 125, y: 6, z: -235 },
    { x: 153.3, y: 6.2, z: -223.3 }, // the zigzag (walls set back)
    { x: 165, y: 7, z: -195 },
    { x: 165, y: 8, z: -165 },
    { x: 173.8, y: 8.6, z: -143.8 },
    { x: 195, y: 9, z: -135 },
    { x: 225, y: 8.9, z: -135 },
    { x: 246.2, y: 8.6, z: -126.2 },
    { x: 255, y: 8.5, z: -105 },
    { x: 255, y: 7.5, z: -61.7 }, // descent: two dune ramps
    { x: 255, y: 5.1, z: -18.3 },
    { x: 255, y: 3, z: 25 },
    { x: 243.3, y: 2.5, z: 53.3 }, // the wash
    { x: 215, y: 2.4, z: 65 },
    { x: 165, y: 2, z: 65 },
    { x: 143.8, y: 1.7, z: 73.8 },
    { x: 135, y: 1.5, z: 95 },
    { x: 135, y: 1.3, z: 115 },
    { x: 124.7, y: 1.1, z: 139.7 },
    { x: 100, y: 1, z: 150 },
    { x: 70, y: 1, z: 154 },
    { x: 40, y: 0.9, z: 150 },
    { x: 11.7, y: 0.7, z: 138.3 }, // last right
    { x: 0, y: 0.5, z: 110 },
    { x: 0, y: 0.1, z: 55 },
  ],
  halfWidth: 8.5,
  wallHalfWidthFactor: 1.35,
  // The wall steps back along the zigzag: straight-lining it across the off-road is shorter,
  // and only worth it with a boost.
  wallHalfWidthFactors: [1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 2.6, 2.6, 2.6, 2.6, 2.2, 2.2, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35],
  itemBoxRows: [0.194, 0.427, 0.67, 0.933],
  boostPads: [0.262, 0.485, 0.824],
  ramps: [
    { t: 0.503, length: 10, height: 2.2 },
    { t: 0.548, length: 9, height: 2 },
  ],
  movers: [
    // Keeps to the left; the right-hand side is the way through.
    { kind: 'roller', from: 0.144, to: 0.041, speed: 8, lateral: -3, sway: 1.2, radius: 1.5, look: 'boulder' },
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
