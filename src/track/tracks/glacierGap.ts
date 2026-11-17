import type { TrackDefinition } from '../../core/types';

/**
 * Glacier Gap - under the aurora.
 * Start straight -> left, climbing, into a right hairpin -> the bridge over the crevasse: boost pad,
 * ramp, seven metres of nothing, and the road again lower down -> right, right, left onto sheet ice, left again ->
 * hairpin -> the back straight, snowballs rolling down it toward you -> right onto the line.
 * ~1220 m.
 */
export const glacierGap: TrackDefinition = {
  id: 'glacier_gap',
  name: 'Glacier Gap',
  theme: 'snow',
  laps: 3,
  description: 'A bridge with a piece missing over the crevasse, a corner of sheet ice, and snowballs coming the other way.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, start straight
    { x: 0, y: 0.5, z: -50 },
    { x: 0, y: 1.5, z: -100 },
    { x: 0, y: 2, z: -150 },
    { x: -11.7, y: 2.7, z: -178.3 }, // left, climbing
    { x: -40, y: 4.2, z: -190 },
    { x: -80, y: 6.5, z: -190 },
    { x: -101.2, y: 7.5, z: -198.8 }, // hairpin onto the bridge
    { x: -110, y: 8, z: -220 },
    { x: -101.2, y: 8.1, z: -241.2 },
    { x: -80, y: 8.6, z: -250 },
    { x: -20, y: 8.6, z: -250 }, // the bridge: gap jump
    { x: 40, y: 6.4, z: -250 },
    { x: 100, y: 5, z: -250 },
    { x: 131.8, y: 4.7, z: -236.8 },
    { x: 145, y: 4, z: -205 },
    { x: 145, y: 3, z: -145 },
    { x: 136.2, y: 3, z: -123.8 },
    { x: 115, y: 2.9, z: -115 },
    { x: 95, y: 2.8, z: -115 },
    { x: 73.8, y: 2.6, z: -106.2 }, // sheet ice
    { x: 65, y: 2.3, z: -85 },
    { x: 65, y: 1.5, z: -25 },
    { x: 73.8, y: 1.3, z: -3.8 },
    { x: 95, y: 1.1, z: 5 },
    { x: 135, y: 1, z: 5 },
    { x: 159.7, y: 1, z: 15.3 }, // hairpin
    { x: 170, y: 0.9, z: 40 },
    { x: 159.7, y: 0.8, z: 64.7 },
    { x: 135, y: 0.7, z: 75 },
    { x: 87.5, y: 0.5, z: 70 }, // back straight: snowballs
    { x: 40, y: 0.2, z: 75 },
    { x: 11.7, y: 0.1, z: 63.3 },
    { x: 0, y: 0, z: 35 },
  ],
  halfWidth: 8,
  wallHalfWidthFactor: 1.5,
  itemBoxRows: [0.055, 0.191, 0.405, 0.514, 0.723],
  boostPads: [0.086, 0.314, 0.673],
  voidRanges: [[0.294, 0.421]],
  ramps: [
    // The crevasse. The far side is lower, so a kart at any racing speed makes it.
    { t: 0.346, length: 10, height: 2, gap: 7 },
  ],
  zones: [
    // Sheet ice from the middle of one left-hander to the middle of the next.
    { from: 0.613, to: 0.7, kind: 'ice' },
  ],
  movers: [
    // Down the back straight toward you, both on the left, half a run apart. The racing line for the corner at the end is on the right, clear of them.
    { kind: 'roller', from: 0.911, to: 0.848, speed: 9, lateral: -2.8, sway: 1.4, radius: 1.6, look: 'snowball' },
    { kind: 'roller', from: 0.911, to: 0.848, speed: 9, lateral: -2.8, sway: 1.4, radius: 1.6, look: 'snowball', phase: 0.5 },
  ],
  environment: {
    skyTop: 0x0b1440,
    skyHorizon: 0x3fa7a0,
    skyBottom: 0xa7d8e8,
    fogColor: 0x7fa7c8,
    fogDensity: 0.0026,
    sunColor: 0xcfe0ff,
    sunIntensity: 1.5,
    sunDirection: { x: 0.3, y: 0.6, z: -0.74 },
    ambientSky: 0x7fb0e8,
    ambientGround: 0x7f98b8,
    ambientIntensity: 0.95,
  },
  palette: {
    road: 0x4a5564,
    roadStripe: 0xdff4ff,
    curb: 0x35c2b0,
    curbAlt: 0xffffff,
    offroad: 0xdde9f5,
    wall: 0x7fd6e8,
    ground: 0xd6e4f2,
  },
};
