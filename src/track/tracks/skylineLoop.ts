import type { TrackDefinition } from '../../core/types';

/**
 * Skyline Loop - the rooftops at night. No walls past the start.
 * Climb off the line -> right onto the first rooftop run: pad, ramp, gap -> right, right ->
 * second run, second gap -> left, left -> third run, third gap -> hairpin -> the long boost strip
 * home -> right onto the line. Each rooftop is lower than the last.
 * ~1310 m.
 */
export const skylineLoop: TrackDefinition = {
  id: 'skyline_loop',
  name: 'Skyline Loop',
  theme: 'neon',
  laps: 3,
  description: 'Rooftop to rooftop across three gaps, no rails, and a boost strip down the last avenue. Do not look down.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line: the climb
    { x: 0, y: 3, z: -53.3 },
    { x: 0, y: 8.4, z: -106.7 },
    { x: 0, y: 10.4, z: -160 },
    { x: 7.3, y: 11.5, z: -177.7 },
    { x: 25, y: 12, z: -185 },
    { x: 75, y: 11.5, z: -185 }, // first rooftop run: gap
    { x: 125, y: 10.5, z: -185 },
    { x: 175, y: 9.7, z: -185 },
    { x: 225, y: 9.5, z: -185 },
    { x: 242.7, y: 9.4, z: -177.7 },
    { x: 250, y: 9.4, z: -160 },
    { x: 250, y: 9.1, z: -100 },
    { x: 242.7, y: 9, z: -82.3 },
    { x: 225, y: 9, z: -75 },
    { x: 165, y: 8.3, z: -75 }, // second run: gap
    { x: 105, y: 6.7, z: -75 },
    { x: 87.3, y: 6.5, z: -67.7 },
    { x: 80, y: 6.5, z: -50 },
    { x: 80, y: 6.2, z: 10 },
    { x: 87.3, y: 6.1, z: 27.7 },
    { x: 105, y: 6, z: 35 },
    { x: 165, y: 5.4, z: 35 }, // third run: gap
    { x: 225, y: 3.8, z: 35 },
    { x: 246.2, y: 3.5, z: 43.8 },
    { x: 255, y: 3.5, z: 65 },
    { x: 246.2, y: 3.4, z: 86.2 },
    { x: 225, y: 3.3, z: 95 },
    { x: 163.3, y: 3, z: 90.7 }, // boost strip home
    { x: 101.7, y: 2.3, z: 90.7 },
    { x: 40, y: 0.9, z: 95 },
    { x: 11.7, y: 0.4, z: 83.3 },
    { x: 0, y: 0.3, z: 55 },
  ],
  halfWidth: 7.5,
  wallHalfWidthFactor: 1.15,
  itemBoxRows: [0.073, 0.271, 0.357, 0.554, 0.857],
  boostPads: [0.182, 0.419, 0.615],
  voidRanges: [[0.061, 0.896]],
  ramps: [
    { t: 0.216, length: 10, height: 2, gap: 8 },
    { t: 0.448, length: 10, height: 2, gap: 7 },
    { t: 0.645, length: 10, height: 2, gap: 7 },
  ],
  zones: [
    { from: 0.789, to: 0.826, kind: 'boost' },
  ],
  environment: {
    skyTop: 0x01010a,
    skyHorizon: 0x1a3fb0,
    skyBottom: 0x0c5a6a,
    fogColor: 0x060a1f,
    fogDensity: 0.0007,
    sunColor: 0xa9c2ff,
    sunIntensity: 0.9,
    sunDirection: { x: 0.4, y: 0.8, z: 0.45 },
    ambientSky: 0x1f2f7a,
    ambientGround: 0x0a2530,
    ambientIntensity: 0.7,
  },
  palette: {
    road: 0x12131c,
    roadStripe: 0x38e8ff,
    curb: 0xffd400,
    curbAlt: 0x38e8ff,
    offroad: 0x1a1b28,
    wall: 0xffd400,
    ground: 0x090a12,
  },
};
