import type { TrackDefinition } from '../../core/types';

/**
 * Tidal Run - the shoreline at sunset.
 * Start straight -> long right sweeper with the tide over its inside -> two short blocks inland ->
 * wide hairpin onto the pier (open water both sides, a ramp in the middle) -> left off the pier,
 * through the second tide pool -> open hairpin back to the line.
 * ~1150 m.
 */
export const tidalRun: TrackDefinition = {
  id: 'tidal_run',
  name: 'Tidal Run',
  theme: 'beach',
  laps: 3,
  description: 'Sunset on the shore. The tide is in over two corners, and the pier has a ramp at the end of its boost.',
  difficulty: 1,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, start straight
    { x: 0, y: 0.1, z: -50 },
    { x: 0, y: 0.5, z: -100 },
    { x: 0, y: 0.9, z: -150 },
    { x: 20.5, y: 1.2, z: -199.5 }, // long sweeper (tide on the inside)
    { x: 70, y: 1.2, z: -220 },
    { x: 130, y: 1.3, z: -220 },
    { x: 161.8, y: 1.4, z: -206.8 },
    { x: 175, y: 1.4, z: -175 },
    { x: 175, y: 1.5, z: -125 },
    { x: 186.7, y: 1.5, z: -96.7 },
    { x: 215, y: 1.4, z: -85 },
    { x: 255, y: 1.1, z: -85 },
    { x: 290.4, y: 0.8, z: -70.4 }, // hairpin onto the pier
    { x: 305, y: 0.6, z: -35 },
    { x: 290.4, y: 0.6, z: 0.4 },
    { x: 255, y: 0.6, z: 15 },
    { x: 195, y: 0.6, z: 15 }, // the pier
    { x: 135, y: 0.6, z: 15 },
    { x: 106.7, y: 0.5, z: 26.7 }, // left off the pier (second tide pool)
    { x: 95, y: 0.5, z: 55 },
    { x: 95, y: 0.4, z: 85 },
    { x: 81.1, y: 0.3, z: 118.6 }, // open hairpin
    { x: 47.5, y: 0.3, z: 132.5 },
    { x: 13.9, y: 0.2, z: 118.6 },
    { x: 0, y: 0.1, z: 85 },
    { x: 0, y: 0, z: 42.5 },
  ],
  halfWidth: 8.5,
  wallHalfWidthFactor: 1.7,
  itemBoxRows: [0.072, 0.362, 0.692, 0.861],
  boostPads: [0.253, 0.456, 0.633],
  voidRanges: [[0.617, 0.709]],
  ramps: [
    // Mid-pier, a few lengths after the boost pad.
    { t: 0.654, length: 10, height: 2.2 },
  ],
  zones: [
    // The tide over the inside of the sweeper: the short way round is the slow one.
    { from: 0.145, to: 0.212, kind: 'mud', look: 'water', lateral: [0.5, 8.5] },
    { from: 0.731, to: 0.793, kind: 'mud', look: 'water', lateral: [-8.5, -0.5] },
  ],
  environment: {
    skyTop: 0x2a2f7a,
    skyHorizon: 0xff8e6e,
    skyBottom: 0xffd3a1,
    fogColor: 0xf5b48f,
    fogDensity: 0.0016,
    sunColor: 0xffb079,
    sunIntensity: 2.3,
    sunDirection: { x: -0.75, y: 0.3, z: 0.58 },
    ambientSky: 0xffb99a,
    ambientGround: 0xb58a66,
    ambientIntensity: 0.9,
  },
  palette: {
    road: 0x5f585c,
    roadStripe: 0xfff0d2,
    curb: 0x1fb8a6,
    curbAlt: 0xfff8ea,
    offroad: 0xe2c08a,
    wall: 0x3a3440,
    ground: 0xd4b27c,
  },
};
