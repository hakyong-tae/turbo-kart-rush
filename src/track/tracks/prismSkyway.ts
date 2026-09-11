import type { TrackDefinition } from '../../core/types';

/**
 * Prism Skyway - a ribbon in the night sky, and the hardest circuit on the card.
 *
 * No barriers anywhere except the pit lane around the grid: the whole lap is a `voidRange`, so the
 * terrain is cut away and there is nothing either side of the road but the drop. Everything that
 * makes this track difficult follows from that. A mistake here does not cost a tenth against the
 * wall, it costs the lap.
 *
 * Three things are asked of the driver, in this order:
 *
 *  - **Corners, eight of them**, none of which open onto a run-off. The first sector is a climbing
 *    left-right that has to be taken on part throttle; the far side is a pair of tightening rights
 *    over the high point; the return is a long descending sequence where the road keeps changing
 *    its mind.
 *  - **Height.** The road climbs about 14 m from the grid to the crest and gives it all back on the
 *    way home. Crests unload the kart right where the road is narrowest, and the dive arrives at
 *    the fastest corner on the lap with the nose light.
 *  - **Pylons.** Fixed obstacles stand on the road itself — paired on the fast sweepers so the line
 *    threads between them, single on the inside of the tight corners so the apex has a price. They
 *    are in the same place every lap; learning them is the difference between a good time and a
 *    long fall.
 *
 * The road is also narrowed to 7.5 m at the crest and through the descending esses, and opened out
 * to 9.5 m on the start straight so eight karts can leave the grid without pushing each other off.
 */
export const prismSkyway: TrackDefinition = {
  id: 'prism_skyway',
  name: 'Prism Skyway',
  theme: 'neon',
  laps: 3,
  description: 'Eight corners, fourteen metres of climb, pylons on the road and no edges anywhere. The hardest lap on the card.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line — the one guarded stretch
    { x: 0, y: 1.5, z: -45.3 },
    { x: 36.4, y: 4.5, z: -81.2 }, // climbing left onto the skyway
    { x: 55.9, y: 7.5, z: -124.8 },
    { x: 98.8, y: 9.8, z: -144.5 }, // right, still going up
    { x: 144.7, y: 11.2, z: -143.4 },
    { x: 189.6, y: 12.4, z: -149.5 }, // the narrow run along the top
    { x: 233.7, y: 13.4, z: -135.5 },
    { x: 275.5, y: 14.2, z: -111.4 }, // tightening right over the crest
    { x: 308.8, y: 14, z: -73.8 },
    { x: 304.5, y: 12, z: -22.5 },
    { x: 303.9, y: 9, z: 22.4 }, // the dive down the far side
    { x: 307.8, y: 6, z: 73.3 },
    { x: 266.9, y: 3.6, z: 103.4 },
    { x: 223.6, y: 2.2, z: 118 }, // fastest corner on the lap, taken light
    { x: 189.5, y: 1.6, z: 148.8 },
    { x: 143.7, y: 1.4, z: 156.8 }, // descending esses along the bottom
    { x: 98.5, y: 1.6, z: 145.3 },
    { x: 55, y: 1.4, z: 126 },
    { x: 28.1, y: 0.9, z: 86.9 },
    // Dead straight onto the line: the grid sits 6-22 m back, and this is the only place on the
    // lap with anything beside the road to catch a kart that gets it wrong.
    { x: 0, y: 0.3, z: 46.4 },
  ],
  halfWidth: 8.5,
  halfWidths: [
    9.5, 9.5, 9, 8.5, 8.5, 8, 7.5, 7.5, 7.5, 8, 8.5, 8.5, 8, 8.5, 9, 8, 7.5, 7.5, 8, 9, 9.5,
  ],
  wallHalfWidthFactor: 1.25,
  itemBoxRows: [0.06, 0.27, 0.52, 0.79],
  boostPads: [0.2, 0.46, 0.74],
  // Pylons standing on the road. Pairs pinch the fast sections so the line has to thread them;
  // singles sit on the inside of the tight corners so cutting the apex costs something.
  obstacles: [
    { t: 0.135, lateral: -3.4 }, // climbing left: take the outside or lose the exit
    { t: 0.215, lateral: 3.6 },
    { t: 0.3, lateral: -4.2 }, // paired pinch along the narrow top
    { t: 0.3, lateral: 4.2 },
    { t: 0.4, lateral: 2.8 }, // inside of the crest right
    { t: 0.53, lateral: -3.2 }, // the dive
    { t: 0.6, lateral: 3.4 },
    { t: 0.665, lateral: -3.8 }, // paired again through the fast corner
    { t: 0.665, lateral: 3.8 },
    { t: 0.79, lateral: -2.9 }, // esses: the inside line is blocked twice
    { t: 0.845, lateral: 3, radius: 1.3 },
  ],
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
