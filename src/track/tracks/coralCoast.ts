import type { TrackDefinition } from '../../core/types';

/**
 * Coral Coast - sunny seaside boulevard.
 * Shoreline start straight -> right sweep off the beach -> sandy S-bend -> back right toward
 * the pier -> long pier straight -> stadium U-turn -> small dune hump -> twisty inland return ->
 * final left back onto the shoreline. Wide sand run-offs tempt you to cut, but sand is slow.
 * ~1150 m.
 */
export const coralCoast: TrackDefinition = {
  id: 'coral_coast',
  name: 'Coral Coast',
  theme: 'beach',
  laps: 3,
  description: 'Seaside sweepers, a flat-out pier straight and soft sand that swallows anyone who cuts the corner.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, shoreline straight
    { x: 0, y: 0, z: -75 },
    { x: 0, y: 0.5, z: -150 },
    { x: 14, y: 1, z: -188 }, // right sweep off the beach
    { x: 50, y: 1.5, z: -212 },
    { x: 96, y: 1.5, z: -212 }, // beach S-bend
    { x: 132, y: 1, z: -186 },
    { x: 150, y: 0.5, z: -148 },
    { x: 178, y: 0.5, z: -116 }, // S: back right toward the pier
    { x: 214, y: 0.5, z: -92 },
    { x: 232, y: 0.5, z: -52 },
    { x: 232, y: 0.5, z: 30 }, // pier straight
    { x: 232, y: 0.5, z: 96 },
    { x: 210, y: 0.5, z: 132 }, // stadium U-turn
    { x: 168, y: 0.5, z: 132 },
    { x: 146, y: 1, z: 96 },
    { x: 146, y: 2.5, z: 44 }, // dune hump
    { x: 128, y: 1, z: 10 }, // twisty inland return
    { x: 92, y: 0.5, z: 0 },
    { x: 62, y: 0.5, z: 30 },
    { x: 50, y: 0, z: 72 },
    { x: 28, y: 0, z: 104 }, // final left onto the shoreline
    { x: -2, y: 0, z: 84 },
  ],
  halfWidth: 8.5,
  halfWidths: [9, 9, 9, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 9, 9, 9, 9, 9, 8.5, 8, 8, 8, 8, 8.5, 9, 9],
  wallHalfWidthFactor: 1.7,
  itemBoxRows: [0.1, 0.36, 0.56, 0.8],
  boostPads: [0.27, 0.5, 0.9],
  environment: {
    skyTop: 0x1f7fd6,
    skyHorizon: 0xa8e4ff,
    skyBottom: 0xf2fbff,
    fogColor: 0xd6f1ff,
    fogDensity: 0.0014,
    sunColor: 0xfff6dc,
    sunIntensity: 2.8,
    sunDirection: { x: -0.35, y: 0.82, z: 0.45 },
    ambientSky: 0xa9dcff,
    ambientGround: 0xc9b58a,
    ambientIntensity: 0.95,
  },
  palette: {
    road: 0x5b5a5e,
    roadStripe: 0xfaf6e6,
    curb: 0xff6f61,
    curbAlt: 0xfffdf5,
    offroad: 0xe8d3a0,
    wall: 0x3a3a40,
    ground: 0xdcc48f,
  },
};
