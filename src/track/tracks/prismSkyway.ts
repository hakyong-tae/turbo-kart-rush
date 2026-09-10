import type { TrackDefinition } from '../../core/types';

/**
 * Prism Skyway - a ribbon in the night sky.
 *
 * No barriers anywhere except the pit lane around the grid: the whole lap is a `voidRange`, so
 * the terrain is cut away and there is nothing either side of the road but the drop. Long fast
 * curves rather than hairpins, because a track that punishes with a fall should not also demand
 * precision braking — the danger is the width, not the corners.
 *
 * The road rises and falls through the lap so the horizon keeps moving, but gently — a big
 * elevation swing on a track with no edges turns every crest into a blind guess.
 */
export const prismSkyway: TrackDefinition = {
  id: 'prism_skyway',
  name: 'Prism Skyway',
  theme: 'neon',
  laps: 3,
  description: 'A ribbon of light with no edges. Fast sweepers, a long dive, and a very long way down.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line — the one guarded stretch
    { x: 0, y: 1.5, z: -62 },
    { x: 2, y: 4, z: -124 }, // climbing away from the grid
    { x: 22, y: 7, z: -180 },
    { x: 74, y: 9, z: -214 }, // long right, out over nothing
    { x: 140, y: 10, z: -218 },
    { x: 196, y: 9, z: -196 },
    { x: 236, y: 7, z: -150 }, // sweeping onto the far side
    { x: 250, y: 5, z: -96 },
    { x: 232, y: 4, z: -48 }, // S-bend: the road changes its mind once, at speed
    { x: 250, y: 4, z: -4 },
    { x: 238, y: 3, z: 46 },
    { x: 196, y: 2, z: 80 }, // wide left along the bottom
    { x: 138, y: 1.5, z: 92 },
    { x: 82, y: 2, z: 84 },
    { x: 44, y: 3, z: 66 }, // the dive back to the grid
    { x: 14, y: 1.8, z: 46 },
    { x: 0, y: 0.6, z: 22 }, // straightens out before the line: no jink onto the grid
  ],
  halfWidth: 9,
  halfWidths: [
    10, 9.5, 9, 9, 10, 10, 9.5, 9, 8.5, 8.5, 8.5, 9, 9.5, 10, 9.5, 9, 9.5, 10,
  ],
  wallHalfWidthFactor: 1.25,
  itemBoxRows: [0.05, 0.24, 0.55, 0.82],
  boostPads: [0.18, 0.47, 0.78],
  // Everything but the grid. The gap at the seam keeps the start line and the first braking zone
  // fenced, so a standing start with eight karts elbowing each other is not a lottery.
  voidRanges: [[0.055, 0.965]],
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
