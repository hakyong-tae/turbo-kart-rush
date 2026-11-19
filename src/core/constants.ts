/**
 * Global tuning constants shared by all subsystems. FROZEN CONTRACT - do not
 * change values without updating CONTRACT.md. Subsystems may define their own
 * private constants in their own folders.
 */

import { PLATFORM } from './platform';

/** The wordmark. It differs by build target (core/platform.ts); read it, never spell it out. */
export const GAME_TITLE = PLATFORM.title;

/** Total karts on the grid (player + AI). */
export const KART_COUNT = 8;
/**
 * Ship switch for online races: false hides the lobby button (single race + records still work).
 *
 * Off for launch. The netcode is sound on a simulated link — the client keeps its own driving, and
 * watched karts are interpolated in the host's tick space rather than on arrival times — but the
 * relay's real behaviour on phones was never brought under control, and QA still found it
 * unplayable on a live session. A mode that cannot be relied on is worse than one that is not
 * offered, so it stays behind this flag until a real multi-device session says otherwise.
 *
 * Nothing else was removed: `src/net/` and the lobby all still build and are covered by tests, so
 * turning this back on is a one-line change.
 */
export const ONLINE_ENABLED = false && PLATFORM.online;

/** Default number of laps per race (tracks may override via TrackDefinition.laps). */
export const DEFAULT_LAPS = 3;

/** Fixed physics timestep (seconds). Game loop uses an accumulator. */
export const FIXED_DT = 1 / 120;

/** Max frame delta we will simulate in one render frame (avoids spiral of death). */
export const MAX_FRAME_DT = 1 / 20;

/** World gravity (m/s^2). Karts are ~1.6m long; world units are metres. */
export const GRAVITY = 26;

/** Kart bounding dimensions (metres). Used by physics, items, AI, and camera. */
export const KART_LENGTH = 1.7;
export const KART_WIDTH = 1.25;
export const KART_HEIGHT = 0.9;
/** Radius used for kart-vs-kart and kart-vs-item sphere collisions. */
export const KART_RADIUS = 0.85;

/** Baseline top speed of a medium kart in m/s (~ 80 km/h). Stats scale around this. */
/**
 * Reference top speed in m/s, before the character's speed stat.
 *
 * Raised from 22 with `accelApproach` cut at the same time. At 22 with a fast approach a kart was
 * within 1% of its ceiling after 37 m, so every straight longer than that was a procession and
 * slipstream had nothing left to give. The ceiling is now high enough, and approached slowly
 * enough, that the last few m/s are still coming in at 100 m.
 */
export const BASE_TOP_SPEED = 26;

/** Number of sequential checkpoints spread evenly along the track (t = i / N). */
export const CHECKPOINT_COUNT = 12;

/** Seconds between the item box being collected and it respawning. */
export const ITEM_BOX_RESPAWN_SECONDS = 3;

/** Item roulette duration (seconds) before the item is committed to the kart. */
export const ITEM_ROULETTE_SECONDS = 1.6;

/** Countdown before race start (seconds shown per number). */
export const COUNTDOWN_STEP_SECONDS = 1;

/** Number of item boxes per row when the track defines a box "line". */
export const ITEM_BOX_ROW_SIZE = 5;

/** Kart is respawned if it falls below this world Y (void). */
export const VOID_Y = -30;

/** Pixel size of the minimap canvas. */
export const MINIMAP_SIZE = 220;

/** Render layer indices. */
export const LAYER_DEFAULT = 0;
export const LAYER_BLOOM = 1;
export const LAYER_UI3D = 2;
