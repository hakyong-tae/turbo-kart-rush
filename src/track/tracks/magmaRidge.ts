import type { TrackDefinition } from '../../core/types';

/**
 * Magma Ridge - volcanic caldera rim.
 * Valley start straight -> long climbing right sweeper -> ridge crest jump (14 m up) ->
 * plunging descent into a left hairpin -> lava causeway with NO barriers (void!) ->
 * 180 degree sweep -> long straight over a second lava bridge (void) -> flowing S-bend ->
 * hairpin descent back to the valley -> final straight. ~1400 m.
 */
export const magmaRidge: TrackDefinition = {
  id: 'magma_ridge',
  name: 'Magma Ridge',
  theme: 'volcano',
  laps: 3,
  description: 'Climb the caldera, jump the ridge, then thread two lava bridges with nothing to stop you falling in.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, valley straight
    { x: 0, y: 0, z: -90 },
    { x: 0, y: 1, z: -170 },
    { x: 20, y: 3, z: -214 }, // climbing right sweeper
    { x: 64, y: 6, z: -236 },
    { x: 116, y: 9, z: -236 },
    { x: 150, y: 12, z: -206 }, // ridge crest (jump)
    { x: 158, y: 14, z: -160 },
    { x: 150, y: 10, z: -118 }, // plunging descent
    { x: 168, y: 7, z: -96 }, // hairpin (left)
    { x: 194, y: 7, z: -96 },
    { x: 206, y: 6, z: -120 },
    { x: 214, y: 4, z: -190 }, // lava causeway 1 (void)
    { x: 250, y: 3, z: -230 },
    { x: 296, y: 3, z: -196 }, // 180 degree sweep
    { x: 296, y: 3, z: -120 },
    { x: 296, y: 3, z: -30 }, // long straight, lava bridge 2 (void)
    { x: 296, y: 2, z: 60 },
    { x: 272, y: 1.5, z: 98 }, // S-bend
    { x: 224, y: 1.5, z: 98 },
    { x: 176, y: 1, z: 66 },
    { x: 128, y: 0.5, z: 66 },
    { x: 96, y: 0, z: 96 }, // hairpin descent to the valley
    { x: 60, y: 0, z: 96 },
    { x: 30, y: 0, z: 70 },
    { x: 0, y: 0, z: 40 }, // onto the final straight
  ],
  halfWidth: 8,
  halfWidths: [8.5, 8.5, 8.5, 8, 8, 8, 8, 8.5, 8, 8.5, 8.5, 8, 7, 7, 8, 8, 7, 7.5, 8, 8, 8, 8, 8.5, 8.5, 8.5, 8.5],
  wallHalfWidthFactor: 1.35,
  itemBoxRows: [0.09, 0.28, 0.54, 0.8],
  boostPads: [0.24, 0.52, 0.86],
  voidRanges: [
    [0.4, 0.47],
    [0.6, 0.68],
  ],
  environment: {
    skyTop: 0x1a0b12,
    skyHorizon: 0xff6a2a,
    skyBottom: 0xffb27a,
    fogColor: 0xc4471f,
    fogDensity: 0.0028,
    sunColor: 0xffa060,
    sunIntensity: 1.9,
    sunDirection: { x: 0.62, y: 0.3, z: -0.72 },
    ambientSky: 0xff8a50,
    ambientGround: 0x3a1a12,
    ambientIntensity: 0.8,
  },
  palette: {
    road: 0x3a3236,
    roadStripe: 0xffd27a,
    curb: 0xff4a1f,
    curbAlt: 0x2a2224,
    offroad: 0x4a2c24,
    wall: 0x5a3a30,
    ground: 0x2c1a16,
  },
};
