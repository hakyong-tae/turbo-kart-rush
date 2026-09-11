/**
 * FROZEN CONTRACT - shared types and interfaces for Turbo Kart Rush.
 *
 * Every subsystem (game, kart, track, items, ai, audio, fx, ui) implements or
 * consumes the interfaces in this file. Do NOT change existing members here.
 * Adding new *optional* members is allowed if your subsystem needs them, but
 * prefer keeping subsystem-private data inside your own folder.
 */
import type { KartCosmetics } from './cosmetics';
import type * as THREE from 'three';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputState {
  /** 0..1 accelerator. */
  throttle: number;
  /** 0..1 brake / reverse. */
  brake: number;
  /** -1 (left) .. +1 (right). */
  steer: number;
  /** Hop / drift button HELD. */
  drift: boolean;
  /** Item button pressed THIS FRAME (edge-triggered, true for exactly one update). */
  useItem: boolean;
  /** Item button HELD (for aiming shells backwards while held with brake). */
  useItemHeld: boolean;
  /** Look-back camera held. */
  lookBack: boolean;
  /** Pause pressed this frame (edge). */
  pause: boolean;
  /** Confirm / start pressed this frame (edge). Menus only. */
  confirm: boolean;
  /** Back / cancel pressed this frame (edge). Menus only. */
  back: boolean;
  /** Menu navigation edges. */
  menuUp: boolean;
  menuDown: boolean;
  menuLeft: boolean;
  menuRight: boolean;
}

/**
 * Contract addition (touch controls). A DOM-side virtual controller exposes its held
 * state here; `InputManager` merges it with keyboard/gamepad and derives edges.
 */
export interface TouchInputSource {
  readonly steer: number; // -1..1
  readonly throttle: number; // 0..1
  readonly brake: number; // 0..1
  readonly drift: boolean; // held
  readonly item: boolean; // held (InputManager turns this into the useItem edge)
  readonly pause: boolean; // held (InputManager turns this into the pause edge)
}

export function createEmptyInput(): InputState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    useItem: false,
    useItemHeld: false,
    lookBack: false,
    pause: false,
    confirm: false,
    back: false,
    menuUp: false,
    menuDown: false,
    menuLeft: false,
    menuRight: false,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemType =
  | 'none'
  | 'banana'
  | 'triple_banana'
  | 'green_shell'
  | 'triple_green_shell'
  | 'red_shell'
  | 'triple_red_shell'
  | 'blue_shell'
  | 'nitro'
  | 'triple_nitro'
  | 'overdrive'
  | 'star'
  | 'lightning'
  | 'bob_omb'
  /** Contract addition (gameplay-2): Kart Rider style magnet — latches onto the kart ahead. */
  | 'magnet';

export const ALL_ITEM_TYPES: readonly ItemType[] = [
  'banana',
  'triple_banana',
  'green_shell',
  'triple_green_shell',
  'red_shell',
  'triple_red_shell',
  'blue_shell',
  'nitro',
  'triple_nitro',
  'overdrive',
  'star',
  'lightning',
  'bob_omb',
  'magnet',
];

/** Hazard on the track that AI drivers should try to avoid. */
export interface HazardInfo {
  id: number;
  type: ItemType;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  /** Kart id that owns / threw it (-1 if none). */
  ownerId: number;
}

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

export type SurfaceType = 'road' | 'offroad' | 'boost' | 'wall' | 'void';

export type TrackTheme = 'grassland' | 'desert' | 'snow' | 'beach' | 'volcano' | 'neon';

export interface EnvironmentDef {
  /** Sky gradient colours (hex). */
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  /** Fog colour + density (exponential fog). 0 disables. */
  fogColor: number;
  fogDensity: number;
  /** Sun (directional light) colour, intensity and direction (normalised). */
  sunColor: number;
  sunIntensity: number;
  sunDirection: { x: number; y: number; z: number };
  /** Hemisphere/ambient light. */
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  theme: TrackTheme;
  /** Laps for this track. */
  laps: number;
  /** Short flavour text for track select. */
  description: string;
  /** Difficulty 1..3 stars. */
  difficulty: 1 | 2 | 3;
  /** Closed loop of control points for a CatmullRom centerline (y = ground height). */
  controlPoints: { x: number; y: number; z: number }[];
  /** Road half width in metres (default). */
  halfWidth: number;
  /** Optional per-control-point half width overrides (same length as controlPoints). */
  halfWidths?: number[];
  /** Distance from centerline to the barrier/wall, as a multiplier of halfWidth (>= 1). */
  wallHalfWidthFactor: number;
  /** Track parameter positions t (0..1) where a row of item boxes is placed. */
  itemBoxRows: number[];
  /** Track parameter positions t (0..1) where boost pads are placed across the road. */
  boostPads: number[];
  /** Optional t ranges (start, end) that are 'void' beyond the road edge instead of walls. */
  voidRanges?: [number, number][];
  /**
   * Contract addition (gameplay-3): fixed obstacles standing on the road.
   *
   * `t` is the centerline parameter, `lateral` the signed offset from the centre in metres
   * (+ = right of travel), `radius` the footprint a kart bounces off. They are part of the
   * circuit, not the item game: same place every lap, same place on every client.
   */
  obstacles?: { t: number; lateral: number; radius?: number }[];
  environment: EnvironmentDef;
  /** Colours used by the track builder. */
  palette: {
    road: number;
    roadStripe: number;
    curb: number;
    curbAlt: number;
    offroad: number;
    wall: number;
    ground: number;
  };
}

export interface TrackSample {
  position: THREE.Vector3;
  /** Unit forward direction along the track. */
  tangent: THREE.Vector3;
  /** Unit up. */
  normal: THREE.Vector3;
  /** Unit right (= tangent x normal). */
  binormal: THREE.Vector3;
  halfWidth: number;
  wallHalfWidth: number;
  t: number;
}

export interface SurfaceQuery {
  /** Closest track parameter 0..1. */
  t: number;
  surface: SurfaceType;
  /** Ground height at the queried XZ. */
  groundY: number;
  groundNormal: THREE.Vector3;
  /** Signed lateral offset from centerline (+ = right of travel direction). */
  lateral: number;
  halfWidth: number;
  wallHalfWidth: number;
  /** Track forward at t. */
  tangent: THREE.Vector3;
  /** Track right at t. */
  binormal: THREE.Vector3;
  /** Centerline point at t. */
  center: THREE.Vector3;
}

export interface Checkpoint {
  index: number;
  t: number;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  halfWidth: number;
  isFinishLine: boolean;
}

export interface StartSlot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Track param of the slot. */
  t: number;
}

export interface MinimapData {
  /** Centerline polyline in normalised [0..1] space (x right, y down), closed. */
  points: { x: number; y: number }[];
  /** Left and right edges in the same normalised space. */
  leftEdge: { x: number; y: number }[];
  rightEdge: { x: number; y: number }[];
  /** Converts a world XZ position into normalised minimap space. */
  worldToMap(x: number, z: number): { x: number; y: number };
}

/** Contract addition (gameplay-3): one fixed obstacle, resolved to world space by the track. */
export interface TrackObstacle {
  position: THREE.Vector3;
  radius: number;
  /** Height of the standing part, for the mesh and for judging whether a jump clears it. */
  height: number;
}

export interface ITrack {
  readonly def: TrackDefinition;
  /** Root object containing road, terrain, sky, decor. Added to the scene by Game. */
  readonly object: THREE.Group;
  /** Total centerline length in metres. */
  readonly length: number;
  /** CHECKPOINT_COUNT checkpoints; index 0 is the finish line at t = 0. */
  readonly checkpoints: readonly Checkpoint[];
  /** At least KART_COUNT start slots, index 0 = pole position. */
  readonly startGrid: readonly StartSlot[];
  /** World positions of every item box. */
  readonly itemBoxPositions: readonly THREE.Vector3[];
  /** Boost pad centre positions + their forward directions. */
  readonly boostPads: readonly { position: THREE.Vector3; forward: THREE.Vector3; halfWidth: number }[];
  /** Contract addition (gameplay-3): fixed obstacles on the road, in world space. */
  readonly obstacles?: readonly TrackObstacle[];
  readonly minimap: MinimapData;
  /** Sample the centerline frame at t (wraps). */
  sample(t: number, out?: TrackSample): TrackSample;
  /** Closest t to a world position. hintT speeds up the search and avoids jumps. */
  closestT(position: THREE.Vector3, hintT?: number): number;
  /** Full surface query at a world position. */
  query(position: THREE.Vector3, hintT?: number, out?: SurfaceQuery): SurfaceQuery;
  /** Ground height at world XZ (terrain outside the road). */
  heightAt(x: number, z: number): number;
  /** Advance animated environment (water, flags, clouds). */
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Characters & karts
// ---------------------------------------------------------------------------

export type WeightClass = 'light' | 'medium' | 'heavy';

export interface CharacterStats {
  /** 0..1 each. */
  speed: number;
  acceleration: number;
  handling: number;
  weight: number;
  miniTurbo: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** Contract addition (local-mods): locked behind a rewarded ad (3 races) or the remove-ads purchase. */
  premium?: true;
  /** Primary body colour. */
  color: number;
  /** Accent / trim colour. */
  accent: number;
  /** Skin / helmet visor colour for the driver. */
  driverColor: number;
  weightClass: WeightClass;
  stats: CharacterStats;
  /** Short flavour text for character select. */
  tagline: string;
}

export type BoostSource = 'drift' | 'nitro' | 'overdrive' | 'pad' | 'start' | 'trick' | 'star' | 'slipstream' | 'magnet';

export interface KartState {
  id: number;
  isPlayer: boolean;
  character: CharacterDef;
  /**
   * Contract addition (nicknames): who is driving, as shown on the standings board — the local
   * player's saved nickname, a remote player's, or a bot's. Absent falls back to the kart name.
   */
  racerName?: string;

  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  /** Signed forward speed (m/s). */
  speed: number;
  /** Yaw in radians. */
  heading: number;
  /** Current steering input after smoothing (-1..1). */
  steerVisual: number;

  isDrifting: boolean;
  /** -1 left, +1 right, 0 none. */
  driftDirection: -1 | 0 | 1;
  /** 0..1 charge toward next drift stage. */
  driftCharge: number;
  /** 0 none, 1 blue sparks, 2 orange sparks, 3 purple sparks. */
  driftStage: 0 | 1 | 2 | 3;

  isBoosting: boolean;
  boostTimer: number;
  boostStrength: number;

  isAirborne: boolean;
  airTime: number;
  isHopping: boolean;

  isSpinning: boolean;
  spinTimer: number;
  isSquished: boolean;
  squishTimer: number;
  isInvincible: boolean;
  starTimer: number;
  isShrunk: boolean;
  shrinkTimer: number;
  /** True while frozen on the grid before GO. */
  isFrozen: boolean;
  /** Contract addition (gameplay-2): slipstream — charge 0..1 built up while tucked behind another kart. */
  draftCharge: number;
  /** True once the slipstream charge is full (top speed bonus applies). */
  isDrafting: boolean;
  /** Magnet item: kart id being followed, -1 when detached. */
  magnetTargetId: number;
  magnetTimer: number;
  /** Seconds the throttle has been held while frozen on the grid (rocket-start charge; HUD gauge). */
  startCharge: number;
  /** Overdrive item: seconds of unlimited nitro left (0 when not active). Written by the ItemManager. */
  overdriveTimer: number;

  lap: number;
  /** Next checkpoint index the kart must cross. */
  checkpointIndex: number;
  /** Closest track parameter 0..1 (written by the kart each physics step). */
  trackT: number;
  /** lap + fractional progress, monotonic within a race. Used for ordering. */
  raceProgress: number;
  /** 1..KART_COUNT. */
  place: number;
  finished: boolean;
  finishTime: number;
  /** True if travelling against track direction. */
  wrongWay: boolean;

  item: ItemType;
  /** Remaining uses for triple items / golden mushroom. */
  itemCount: number;
  /** True while the roulette is spinning (item not yet usable). */
  itemRouletteActive: boolean;

  surface: SurfaceType;
  /** Wheel spin angle for animation. */
  wheelSpin: number;
}

export interface ExhaustAnchor {
  position: THREE.Vector3;
  /** Unit vector the pipe points along (world space). */
  direction: THREE.Vector3;
}

/** Opaque handle for a kart's saved simulation state (see `KartSave` in src/kart/Kart.ts). */
export type KartSaveOpaque = object;

export interface IKart {
  readonly state: KartState;
  /** Root object (kart body + driver + wheels). Added to the scene by Game. */
  readonly object: THREE.Group;
  /** Latest input applied to this kart. */
  readonly input: InputState;
  /** Contract addition (garage): the look this kart wears. Empty = the character's own colours. */
  readonly cosmetics?: KartCosmetics;
  /**
   * Contract addition (rollback): a complete save of the simulation, so an online client can put
   * the kart back at an earlier tick and replay from there. `KartSave` is opaque to callers —
   * make one with `createKartSave()` from src/kart/Kart.ts and hand the same object back.
   */
  save?(out: KartSaveOpaque): void;
  restore?(src: KartSaveOpaque): void;
  /**
   * Contract addition (rollback): hands the model a position jump to absorb, so a correction the
   * simulation applies at once is drawn as a slide over a few frames.
   */
  absorbCorrection?(dx: number, dy: number, dz: number): void;

  setInput(input: InputState): void;
  /** Advance physics by dt (fixed step). Handles ground, walls, drift, boost, hop, kart-kart bumps. */
  update(dt: number, track: ITrack, others: readonly IKart[]): void;
  /** Update visual-only animation (wheel spin, body tilt, driver lean). Called once per render frame. */
  updateVisuals(dt: number): void;

  applyBoost(strength: number, duration: number, source: BoostSource): void;
  /** Spin-out / tumble. Ignored while invincible. Returns true if the hit landed. */
  applyHit(cause: ItemType | 'collision' | 'explosion', sourceKartId: number): boolean;
  applySquish(duration: number): void;
  applyStar(duration: number): void;
  /** Contract addition (gameplay-2): latch onto `targetId` for `duration` seconds (magnet item). */
  applyMagnet(targetId: number, duration: number): void;
  /** Contract addition (gameplay-3): world-space exhaust tips (updated in updateVisuals) so FX can attach flames to the real pipes. */
  getExhaustAnchors?(): readonly ExhaustAnchor[];
  /** Contract addition (garage): repaint / re-livery in place. */
  applyCosmetics?(cos: import('./cosmetics').KartCosmetics): void;
  applyShrink(duration: number): void;
  applyImpulse(impulse: THREE.Vector3): void;
  setFrozen(frozen: boolean): void;
  /** Teleport to a pose and zero velocity (respawn / grid placement). */
  resetTo(position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  /**
   * Contract addition (online multiplayer): adopt a network pose (position, heading, speed,
   * status flags, race bookkeeping) without touching the physics integrator's internals.
   */
  applyNetState?(pose: NetKartPose): void;
  forwardDir(out?: THREE.Vector3): THREE.Vector3;
  /** Convenience: scaled top speed for this character (m/s). */
  topSpeed(): number;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Items manager
// ---------------------------------------------------------------------------

export interface IItemManager {
  /** Root object for boxes, projectiles, dropped items. Added to the scene by Game. */
  readonly object: THREE.Group;
  init(track: ITrack, karts: readonly IKart[]): void;
  update(dt: number): void;
  /** Request the kart to use its currently held item (called on useItem edge). aimBack throws backwards. */
  requestUse(kart: IKart, aimBack: boolean): void;
  /** Current hazards on the track (bananas, shells, bombs) for AI avoidance. */
  getHazards(): readonly HazardInfo[];
  /** Live positions of item boxes that are currently collectable (for AI). */
  getActiveBoxPositions(): readonly THREE.Vector3[];
  reset(): void;
  dispose(): void;
  /** Contract additions (item sync). 'mirror' = render network state only. */
  setNetMode?(mode: 'authority' | 'mirror'): void;
  getNetItems?(): NetItems;
  applyNetItems?(items: NetItems): void;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface IAIDriver {
  readonly kart: IKart;
  setDifficulty(d: Difficulty): void;
  /** Compute and return the input for this kart this step (also applied via kart.setInput). */
  update(dt: number, track: ITrack, karts: readonly IKart[], items: IItemManager, playerKart: IKart | null): InputState;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type MusicTrack = 'menu' | 'race' | 'finalLap' | 'results' | 'none';

export interface IAudioEngine {
  /** Must be called from a user gesture; resumes the AudioContext. Safe to call repeatedly. */
  init(): Promise<void>;
  readonly ready: boolean;
  /** Per-frame update: engine pitch per kart, listener position, positional sounds. */
  update(dt: number, karts: readonly IKart[], playerKartId: number, camera: THREE.Camera): void;
  playMusic(track: MusicTrack): void;
  stopMusic(): void;
  setMasterVolume(v: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  /** Contract addition (settings mixer): independent 0..1 levels for music and for all SFX buses. */
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  readonly musicVolumeLevel: number;
  readonly sfxVolumeLevel: number;
  /**
   * Contract addition (pause): silences every engine voice. The voices are free-running
   * oscillators, so a paused simulation does not stop them on its own.
   */
  setEnginesMuted(muted: boolean): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------

export type ParticlePreset =
  | 'explosion'
  | 'hitSparks'
  | 'itemBoxBurst'
  | 'confetti'
  | 'dust'
  | 'boostRing'
  | 'starSparkle'
  | 'lightningStrike'
  | 'shellBreak'
  | 'bananaSplat'
  | 'waterSplash'
  | 'lapFlash'
  | 'landPuff';

export interface IParticleSystem {
  /** Root object; added to the scene by Game. */
  readonly object: THREE.Object3D;
  /** Per-frame: emits continuous effects (drift sparks, boost flames, tyre smoke, offroad dust, star glow) from kart states. */
  update(dt: number, karts: readonly IKart[], camera: THREE.Camera): void;
  emit(preset: ParticlePreset, position: THREE.Vector3, options?: { color?: number; scale?: number; direction?: THREE.Vector3 }): void;
  reset(): void;
  dispose(): void;
}

export interface IPostFX {
  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
  setCamera(camera: THREE.Camera): void;
  render(dt: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** 0..1 speed feel: speed lines / subtle radial blur / vignette. */
  setSpeedEffect(intensity: number): void;
  /** 0..1 boost feel: chromatic aberration + stronger speed lines. */
  setBoostEffect(intensity: number): void;
  /** 0..1 hit feel: desaturate + shake handled by camera, red vignette here. */
  setHitEffect(intensity: number): void;
  /** Full-screen flash (lightning / finish). */
  flash(color: number, duration: number): void;
  /** Enable/disable the whole pipeline (fallback to plain render). */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type GameState =
  | 'boot'
  | 'title'
  | 'characterSelect'
  | 'trackSelect'
  | 'loading'
  | 'countdown'
  | 'racing'
  | 'paused'
  | 'finished'
  | 'results';

/** Contract addition (gameplay-4): solo race, or a 4 v 4 team race scored by points / by 1st place. */
export type RaceMode = 'solo' | 'teamPoints' | 'teamFirst';
export type Team = 'red' | 'blue';

export interface RaceSettings {
  characterId: string;
  trackId: string;
  difficulty: Difficulty;
  laps: number;
  /** Contract addition (gameplay-4). Absent = 'solo'. */
  mode?: RaceMode;
  /** Contract addition (online multiplayer). Absent = offline race against AI. */
  online?: OnlineRaceConfig;
}

/** Contract addition (online multiplayer). Kart slots come from the roster; the rest are AI. */
export interface OnlineRaceConfig {
  role: 'host' | 'client';
  roster: readonly { account: string; nick: string; characterId: string; kartId: number; cos?: string }[];
  localKartId: number;
  /** Items on (host simulates, clients mirror). */
  items: boolean;
}

/** Contract addition (online multiplayer): one kart's state as carried by a snapshot. */
export interface NetKartPose {
  /**
   * Contract addition (rollback): the last input sequence the host had applied to this kart when
   * this pose was taken, so a client knows which of its predicted ticks the pose accounts for.
   * 0 when the host has heard nothing from that kart yet.
   */
  ack?: number;
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  isDrifting: boolean;
  isBoosting: boolean;
  isAirborne: boolean;
  isSpinning: boolean;
  isFrozen: boolean;
  finished: boolean;
  wrongWay: boolean;
  driftStage: 0 | 1 | 2 | 3;
  lap: number;
  place: number;
  checkpointIndex: number;
  finishTime: number;
  // phase 2: status + item slot
  isInvincible: boolean;
  isShrunk: boolean;
  isSquished: boolean;
  isHopping: boolean;
  item: ItemType;
  itemCount: number;
  rouletteActive: boolean;
}

/** Contract addition (item sync): one hazard as carried by a snapshot. */
export interface NetHazard {
  id: number;
  kind: 'banana' | 'green_shell' | 'red_shell' | 'blue_shell' | 'bob_omb';
  ownerId: number; // -1 = none
  x: number;
  y: number;
  z: number;
  hidden: boolean;
  airborne: boolean;
  resting: boolean;
}

/** Contract addition (item sync): item boxes + hazards in a snapshot. */
export interface NetItems {
  boxes: boolean[];
  hazards: NetHazard[];
}

export interface RaceStanding {
  kartId: number;
  name: string;
  color: number;
  place: number;
  /** Seconds; -1 = did not finish (retired 10 s after the winner). */
  finishTime: number;
  isPlayer: boolean;
  /** Contract addition (gameplay-4): team colour in team modes (derived from kart id when absent). */
  team?: Team;
  /** Contract addition (garage): who drove, and the packed look they drove in. */
  characterId?: string;
  cos?: string;
}
