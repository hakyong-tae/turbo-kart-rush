import type { TrackDefinition } from '../../core/types';

/**
 * Prism Skyway - seven hairpins in the sky, and nothing either side of any of them.
 *
 * The circuit is a switchback ladder hung over the void. Eight legs about 95 m long, joined by
 * seven full hairpins that alternate top and bottom, and then one long sweep around the outside
 * to get home. Every one of those hairpins is unguarded: the whole lap is a `voidRange` except
 * the pit lane around the grid, so the terrain is cut away and the penalty for arriving too fast
 * is not a wall, it is the drop and a wait for the rescue drone.
 *
 * There is no fast line here and there is nothing to lean on. The legs are short enough that the
 * next hairpin is already in view as the last one is finished, the road is narrowest (7.5 m) down
 * the middle of each leg where the speed is highest, and four pylons stand on the legs so even the
 * straights ask for a decision. The road climbs 13 m across the ladder and gives it all back on
 * the last three legs, which means the downhill hairpins arrive with the kart already light.
 *
 * The one long sweep on the way home is deliberate: a lap made entirely of hairpins is exhausting
 * rather than hard, and the run round the outside is where a race is actually settled.
 *
 * Laid out at 32 m leg spacing — 4.3 half widths, comfortably past the validator's 3.5 minimum —
 * so the hairpin arcs hold a ~14 m radius rather than folding into a kink.
 */
export const prismSkyway: TrackDefinition = {
  id: 'prism_skyway',
  name: 'Prism Skyway',
  theme: 'neon',
  laps: 3,
  description: 'Seven hairpins hung over nothing. Miss one and there is no wall to stop you.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line — the only guarded metres on the whole lap
    { x: 0, y: 0.9, z: -52 },
    { x: 0.5, y: 2, z: -104 }, // hairpin 1 (right, over nothing)
    { x: 11.8, y: 3.1, z: -114.2 },
    { x: 20.2, y: 4.2, z: -114.2 },
    { x: 31.5, y: 5.3, z: -104 },
    { x: 32, y: 6.3, z: -59 },
    { x: 32.5, y: 7.4, z: -14 }, // hairpin 2 (left, at the bottom)
    { x: 43.8, y: 8.3, z: -3.8 },
    { x: 52.2, y: 9.2, z: -3.8 },
    { x: 63.5, y: 10, z: -14 },
    { x: 64, y: 10.8, z: -59 },
    { x: 64.5, y: 11.4, z: -104 }, // hairpin 3
    { x: 75.8, y: 12, z: -114.2 },
    { x: 84.2, y: 12.4, z: -114.2 },
    { x: 95.5, y: 12.7, z: -104 },
    { x: 96, y: 12.9, z: -59 },
    { x: 96.5, y: 13, z: -14 }, // hairpin 4 — the high point, and the narrowest road on the track
    { x: 107.8, y: 13, z: -3.8 },
    { x: 116.2, y: 12.8, z: -3.8 },
    { x: 127.5, y: 12.5, z: -14 },
    { x: 128, y: 12.2, z: -59 },
    { x: 128.5, y: 11.7, z: -104 }, // hairpin 5
    { x: 139.8, y: 11.1, z: -114.2 },
    { x: 148.2, y: 10.4, z: -114.2 },
    { x: 159.5, y: 9.6, z: -104 },
    { x: 160, y: 8.7, z: -59 },
    { x: 160.5, y: 7.8, z: -14 }, // hairpin 6
    { x: 171.8, y: 6.8, z: -3.8 },
    { x: 180.2, y: 5.7, z: -3.8 },
    { x: 191.5, y: 4.7, z: -14 },
    { x: 192, y: 3.6, z: -59 },
    { x: 192.5, y: 2.5, z: -104 }, // hairpin 7, the last one, taken downhill
    { x: 203.8, y: 1.4, z: -114.2 },
    { x: 212.2, y: 0.4, z: -114.2 },
    { x: 223.5, y: 0.1, z: -104 },
    { x: 224, y: 0.1, z: -59 },
    { x: 238, y: 0.1, z: 34.5 }, // out of the ladder at last
    { x: 188, y: 0.1, z: 71.3 }, // the long return sweep: the only place to breathe
    { x: 123.2, y: 0.1, z: 82.8 },
    { x: 62.7, y: 0.1, z: 78.2 },
    { x: 2, y: 0.1, z: 55.2 }, // straight onto the grid
    { x: 0, y: 0.1, z: 24 },
  ],
  halfWidth: 7.5,
  halfWidths: [
    8.5, 7.5, 8, 8, 8, 8, 7.5, 8, 8, 8, 8, 7.5, 8, 8, 8, 8, 7.5, 8, 8, 8, 8, 7.5, 8, 8, 8, 8, 7.5, 8, 8, 8, 8, 7.5, 8, 8, 8, 8, 7.5, 9, 9, 9, 9, 9, 9,
  ],
  wallHalfWidthFactor: 1.12,
  itemBoxRows: [0.09, 0.33, 0.56, 0.88],
  boostPads: [0.2, 0.45, 0.7],
  // Only on the legs. A pylon inside a hairpin that has no run-off is not a challenge, it is a
  // coin toss, and this track already asks enough of the driver.
  obstacles: [
    { t: 0.155, lateral: -3 },
    { t: 0.39, lateral: 3.2 },
    { t: 0.61, lateral: -3.2 },
    { t: 0.755, lateral: 3 },
  ],
  // Everything but the grid. The gap at the seam keeps the start line and the run to the first
  // hairpin fenced, so a standing start with eight karts elbowing each other is not a lottery.
  voidRanges: [[0.05, 0.965]],
  environment: {
    skyTop: 0x150b2e,
    skyHorizon: 0x5a2a8c,
    skyBottom: 0x1b1140,
    fogColor: 0x2a1552,
    fogDensity: 0.0022,
    sunColor: 0xc9b6ff,
    sunIntensity: 1.5,
    sunDirection: { x: 0.3, y: 0.72, z: 0.42 },
    ambientSky: 0x7b5ce0,
    ambientGround: 0x2a1a4a,
    ambientIntensity: 1.15,
  },
  palette: {
    road: 0x241a44,
    roadStripe: 0x8ef4ff,
    curb: 0xff3ab8,
    curbAlt: 0x37e8ff,
    offroad: 0x3a2a66,
    wall: 0xff5ad0,
    ground: 0x120a26,
  },
};
