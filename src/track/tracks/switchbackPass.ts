import type { TrackDefinition } from '../../core/types';

/**
 * Switchback Pass - alpine hairpin ladder.
 *
 * Four legs stacked 36 m apart, joined by three full hairpins, then a wide return sweep around
 * the outside that never crosses the ladder. Nothing here is fast: the track is brake, turn, get
 * back on the throttle, and the kart that leaves the corner first wins the next one. Mini-turbo
 * is the whole game.
 *
 * The legs are short — about 110 m — so the next hairpin is always in sight, and the road is
 * narrower than every other circuit (7.5 m half width) to make the apex a real choice. The leg
 * spacing is set by the validator's rule for hairpin legs: no closer than 3.5 half widths.
 */
export const switchbackPass: TrackDefinition = {
  id: 'switchback_pass',
  name: 'Switchback Pass',
  theme: 'snow',
  laps: 3,
  description: 'Three hairpins up a frozen pass and barely a straight between them. Leave the corner first or lose the place.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, first climbing leg
    { x: 0, y: 1.6, z: -56 },
    { x: 0, y: 3, z: -112 },
    { x: 0.6, y: 3.6, z: -144.7 }, // hairpin 1 (right, top of the pass) — a true 18 m arc
    { x: 13.3, y: 3.9, z: -157.4 },
    { x: 22.7, y: 3.9, z: -157.4 },
    { x: 35.4, y: 3.6, z: -144.7 },
    { x: 36, y: 3, z: -112 },
    { x: 36, y: 2, z: -50 }, // leg 2, back down
    { x: 36.6, y: 1.3, z: 10.7 }, // hairpin 2 (left, foot of the pass)
    { x: 49.3, y: 1.2, z: 23.4 },
    { x: 58.7, y: 1.2, z: 23.4 },
    { x: 71.4, y: 1.3, z: 10.7 },
    { x: 72, y: 2.4, z: -40 }, // leg 3, climbing again
    { x: 72, y: 4, z: -112 },
    { x: 72.6, y: 4.6, z: -150.7 }, // hairpin 3 (right, the high one)
    { x: 85.3, y: 4.9, z: -163.4 },
    { x: 94.7, y: 4.9, z: -163.4 },
    { x: 107.4, y: 4.6, z: -150.7 },
    { x: 108, y: 4.2, z: -100 },
    { x: 108, y: 3, z: -20 }, // leg 4, the long descent on the outside
    { x: 100, y: 1.6, z: 36 },
    { x: 58, y: 0.8, z: 66 }, // wide return sweep, the only place to breathe
    { x: 10, y: 0.6, z: 64 },
    { x: -20, y: 0.2, z: 28 }, // final left back onto the start straight
  ],
  halfWidth: 7.5,
  halfWidths: [
    8.5, 8, 7.5, 7, 7, 7, 7, 7.5, 8, 7, 7, 7, 7, 8, 7.5, 7, 7, 7, 7, 7.5, 8.5, 8.5, 9, 9, 8.5,
  ],
  wallHalfWidthFactor: 1.45,
  itemBoxRows: [0.07, 0.3, 0.52, 0.78],
  boostPads: [0.19, 0.44, 0.86],
  environment: {
    skyTop: 0x2a5590,
    skyHorizon: 0xb8d6f2,
    skyBottom: 0xeef6ff,
    fogColor: 0xcfe2f4,
    fogDensity: 0.0036,
    sunColor: 0xfff2e0,
    sunIntensity: 1.9,
    sunDirection: { x: -0.42, y: 0.62, z: -0.58 },
    ambientSky: 0xb4d2f0,
    ambientGround: 0x93a9c0,
    ambientIntensity: 1.05,
  },
  palette: {
    road: 0x4e5866,
    roadStripe: 0xf2f8ff,
    curb: 0xd23b4a,
    curbAlt: 0xffffff,
    offroad: 0xdfeaf6,
    wall: 0x9fd6f0,
    ground: 0xe9f2fa,
  },
};
