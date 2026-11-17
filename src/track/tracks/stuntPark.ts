import type { TrackDefinition } from '../../core/types';

/**
 * Stunt Park - the show circuit: built for air time.
 * Start straight with a long boost strip into the big ramp -> right -> top straight, second ramp ->
 * right, down the side -> infield hairpin (right, left 180, right) -> bottom straight, third ramp ->
 * right onto the line.
 * ~1150 m.
 */
export const stuntPark: TrackDefinition = {
  id: 'stunt_park',
  name: 'Stunt Park',
  theme: 'grassland',
  laps: 3,
  description: 'Three big ramps and a boost strip to hit the first one flat out. Tap drift in the air and land it for more.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line: boost strip, then the big ramp
    { x: 0, y: 0.1, z: -50 },
    { x: 0, y: 0.2, z: -100 },
    { x: 0, y: 0.4, z: -150 },
    { x: 0, y: 0.5, z: -200 },
    { x: 13.2, y: 0.5, z: -231.8 },
    { x: 45, y: 0.8, z: -245 },
    { x: 100, y: 1.7, z: -245 }, // top straight: second ramp
    { x: 155, y: 2.4, z: -245 },
    { x: 186.8, y: 2.5, z: -231.8 },
    { x: 200, y: 2.3, z: -200 },
    { x: 200, y: 1.8, z: -140 },
    { x: 191.2, y: 1.6, z: -118.8 }, // into the infield
    { x: 170, y: 1.5, z: -110 },
    { x: 110, y: 1.4, z: -110 },
    { x: 88.8, y: 1.3, z: -101.2 }, // infield hairpin
    { x: 80, y: 1.2, z: -80 },
    { x: 88.8, y: 1, z: -58.8 },
    { x: 110, y: 0.9, z: -50 },
    { x: 170, y: 0.6, z: -50 },
    { x: 191.2, y: 0.5, z: -41.2 },
    { x: 200, y: 0.5, z: -20 },
    { x: 200, y: 0.8, z: 30 },
    { x: 186.8, y: 1.1, z: 61.8 },
    { x: 155, y: 1.4, z: 75 },
    { x: 100, y: 1.5, z: 75 }, // bottom straight: third ramp
    { x: 45, y: 0.9, z: 75 },
    { x: 13.2, y: 0.5, z: 61.8 },
    { x: 0, y: 0.1, z: 30 },
  ],
  halfWidth: 8.5,
  wallHalfWidthFactor: 1.5,
  itemBoxRows: [0.153, 0.418, 0.511, 0.734],
  boostPads: [0.245, 0.645, 0.825],
  ramps: [
    // The big one, straight off the boost strip.
    { t: 0.087, length: 12, height: 3.2 },
    { t: 0.275, length: 10, height: 2.4 },
    { t: 0.851, length: 10, height: 2.6 },
  ],
  zones: [
    // Run-up to the big ramp.
    { from: 0.035, to: 0.076, kind: 'boost' },
  ],
  environment: {
    skyTop: 0x1f7ae0,
    skyHorizon: 0xaee0ff,
    skyBottom: 0xeaf7ff,
    fogColor: 0xd5ecff,
    fogDensity: 0.0013,
    sunColor: 0xfff6e0,
    sunIntensity: 2.8,
    sunDirection: { x: 0.3, y: 0.85, z: 0.43 },
    ambientSky: 0xa9d2ff,
    ambientGround: 0x6f9a52,
    ambientIntensity: 0.95,
  },
  palette: {
    road: 0x3f4148,
    roadStripe: 0xffffff,
    curb: 0xffd400,
    curbAlt: 0x1d1e22,
    offroad: 0x58a03c,
    wall: 0x1d1e22,
    ground: 0x4c9634,
  },
};
