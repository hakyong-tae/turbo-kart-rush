import type { TrackDefinition } from '../../core/types';

/**
 * Tram Town - a street circuit at dusk, all right angles.
 * Start avenue -> right -> top street (first tram line) -> right, a block south, left ->
 * right onto the long east avenue (second tram line, then a boost strip) -> right, bottom street
 * with a ramp -> right, up a block, left-left round the square -> tight hairpin onto the line.
 * ~1160 m.
 */
export const tramTown: TrackDefinition = {
  id: 'tram_town',
  name: 'Tram Town',
  theme: 'neon',
  laps: 3,
  description: 'City blocks at dusk. Two tram lines cross the circuit: watch the lamps, and never race a tram to the crossing.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, start avenue
    { x: 0, y: 0.1, z: -56.7 },
    { x: 0, y: 0.3, z: -113.3 },
    { x: 0, y: 0.6, z: -170 },
    { x: 8.2, y: 0.7, z: -189.8 },
    { x: 28, y: 0.8, z: -198 },
    { x: 73, y: 1, z: -198 }, // top street: first tram line
    { x: 118, y: 1, z: -198 },
    { x: 137.8, y: 1, z: -189.8 },
    { x: 146, y: 1.1, z: -170 },
    { x: 146, y: 1.3, z: -120 },
    { x: 154.2, y: 1.4, z: -100.2 },
    { x: 174, y: 1.5, z: -92 },
    { x: 234, y: 1.8, z: -92 },
    { x: 253.8, y: 1.9, z: -83.8 },
    { x: 262, y: 2, z: -64 },
    { x: 262, y: 2, z: -9 }, // east avenue: second tram line, boost strip
    { x: 262, y: 1.8, z: 46 },
    { x: 253.8, y: 1.7, z: 65.8 },
    { x: 234, y: 1.6, z: 74 },
    { x: 199, y: 1.4, z: 74 }, // bottom street: ramp
    { x: 164, y: 1.3, z: 74 },
    { x: 144.2, y: 1.2, z: 65.8 },
    { x: 136, y: 1.1, z: 46 },
    { x: 136, y: 1, z: 6 },
    { x: 127.8, y: 1, z: -13.8 }, // round the square
    { x: 108, y: 1, z: -22 },
    { x: 78, y: 0.9, z: -22 },
    { x: 58.2, y: 0.8, z: -13.8 },
    { x: 50, y: 0.7, z: 6 },
    { x: 50, y: 0.4, z: 56 },
    { x: 42.7, y: 0.3, z: 73.7 }, // last hairpin
    { x: 25, y: 0.2, z: 81 },
    { x: 7.3, y: 0.2, z: 73.7 },
    { x: 0, y: 0.1, z: 56 },
  ],
  halfWidth: 7.5,
  wallHalfWidthFactor: 1.4,
  itemBoxRows: [0.062, 0.323, 0.489, 0.721, 0.862],
  boostPads: [0.091, 0.408, 0.849],
  ramps: [
    { t: 0.623, length: 10, height: 2 },
  ],
  zones: [
    // After the second crossing.
    { from: 0.529, to: 0.562, kind: 'boost' },
  ],
  movers: [
    { kind: 'crosser', t: 0.224, period: 10, speed: 9, cars: 3, look: 'tram' },
    { kind: 'crosser', t: 0.512, period: 8, speed: 10, cars: 3, look: 'tram', phase: 0.4 },
  ],
  environment: {
    skyTop: 0x0d1033,
    skyHorizon: 0xff5f8a,
    skyBottom: 0xffb07a,
    fogColor: 0x2a1638,
    fogDensity: 0.001,
    sunColor: 0xffc6a0,
    sunIntensity: 1.1,
    sunDirection: { x: -0.6, y: 0.45, z: -0.66 },
    ambientSky: 0x5a3a86,
    ambientGround: 0x1a2a3a,
    ambientIntensity: 0.8,
  },
  palette: {
    road: 0x1b1a24,
    roadStripe: 0xffd400,
    curb: 0xff8a1e,
    curbAlt: 0x2b2940,
    offroad: 0x24222f,
    wall: 0xff8a1e,
    ground: 0x100f18,
  },
};
