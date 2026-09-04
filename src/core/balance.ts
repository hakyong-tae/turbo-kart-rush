/**
 * Contract addition: every "feel" tuning constant in one place. Values are the ORIGINAL
 * tuning copied verbatim from Kart.ts / ItemManager.ts / AIDriver.ts / RaceManager.ts.
 *
 * Runtime override: `?b.kart.accelBase=11&b.ai.profiles.easy.noise=0.2` (numbers only) via
 * `applyBalanceOverrides`, or edit `window.__balance` in the console. Modules read these
 * properties every frame, so most edits apply immediately. Exceptions (captured once):
 *   - ai.profiles.*  -> captured in the AIDriver constructor: applies from the next race.
 *   - itemTable      -> read per roulette: immediate.
 */
import type { Difficulty, ItemType } from './types';

export interface DifficultyProfile {
  /** Steering noise amplitude (rad). */
  noise: number;
  /** Reaction delay range (s) before responding to hazards / items. */
  reactionMin: number;
  reactionMax: number;
  /** Corner curvature (|turn| rad over the lookahead) above which the AI drifts. */
  driftThreshold: number;
  /** Mini-turbo stage at which the AI releases a drift. */
  releaseStage: 1 | 2 | 3;
  /** Lateral acceleration (m/s^2) the AI is willing to carry before braking. */
  brakeLatAccel: number;
  /** Throttle used while easing through tight corners. */
  easeThrottle: number;
  usesMushrooms: boolean;
  /** Seconds before GO the AI floors it (rocket-start timing). */
  startThrottleBeforeGo: number;
  /** Rubber-band: topSpeed factor = clamp(base + amp * tanh(gapMetres / scale), min, max). */
  rubber: { base: number; amp: number; scale: number; min: number; max: number };
}

export type ItemWeightRow = Partial<Record<ItemType, number>>;

export interface Balance {
  kart: {
    /** m/s^2 at (0.5 + acceleration stat) = 1. Medium kart 0 -> 95% top in ~2.5 s. */
    accelBase: number;
    /** Proportional approach toward target speed (1/s). */
    accelApproach: number;
    /** Acceleration cap / approach while boosting (~95% of boosted top in ~0.3 s). */
    boostAccel: number;
    boostApproach: number;
    /** Deceleration when above top speed (m/s^2) and its approach rate. */
    overSpeedDecelMax: number;
    overSpeedApproach: number;
    brakeDecel: number;
    coastDecel: number;
    /** Reverse top speed as a fraction of forward top speed; reverse acceleration. */
    reverseFraction: number;
    reverseAccel: number;
    /** Full-lock yaw rate (rad/s) before handling/speed scaling. */
    steerRate: number;
    driftSteerRate: number;
    hopVelocity: number;
    lateralGripRoad: number;
    lateralGripOffroad: number;
    wallRestitution: number;
  };
  drift: {
    /** Seconds after a hop before a held drift engages. */
    hopDriftDelay: number;
    /** Min speed (fraction of top) to start / keep a drift. */
    minSpeed: number;
    keepSpeed: number;
    /** Max angle (rad) the velocity lags the heading while drifting. */
    slipMax: number;
    /** Top-speed multiplier while drifting. */
    speedFactor: number;
    /** Drift seconds needed to reach stage 1/2/3. */
    stageThresholds: number[];
    /** Boost seconds released per stage [none, 1, 2, 3]. */
    boostDurations: number[];
    boostStrength: number;
  };
  status: {
    spinDuration: number;
    /** Top-speed multipliers. */
    offroadFactor: number;
    shrunkFactor: number;
    starFactor: number;
    squishFactor: number;
  };
  items: {
    /** Projectile speeds (m/s) and lifetimes (s). */
    greenSpeed: number;
    redSpeed: number;
    blueSpeed: number;
    greenLife: number;
    redLife: number;
    bananaLife: number;
    bombFuse: number;
    explosionRadius: number;
    /** Seconds before another lightning can be rolled. */
    lightningCooldown: number;
    /** Min seconds between golden mushroom bursts. */
    goldenMinSpacing: number;
    /** Seconds a freshly thrown hazard ignores its owner. */
    ownerGrace: number;
  };
  /** Place-weighted roulette table, index = place - 1. */
  itemTable: ItemWeightRow[];
  ai: {
    profiles: Record<Difficulty, DifficultyProfile>;
    /** PD steering gains. */
    kP: number;
    kD: number;
    /** Racing-line lookahead (m), clamped from speed * 0.9. */
    lookaheadMin: number;
    lookaheadMax: number;
    hazardLookahead: number;
    boxSeekDistance: number;
  };
  race: {
    /** Rocket start: throttle within this many seconds after GO = strong boost, weak window = small boost. */
    startBoostWindow: number;
    startBoostWeakWindow: number;
    /** Holding throttle this long before GO = spin out. */
    startSpinoutHold: number;
    wrongWaySeconds: number;
    stuckSeconds: number;
    /** After the player finishes, keep simulating AI for at most this long. */
    finishGraceSeconds: number;
  };
}

export function createDefaultBalance(): Balance {
  return {
    kart: {
      accelBase: 9.0,
      accelApproach: 2.2,
      boostAccel: 45,
      boostApproach: 7,
      overSpeedDecelMax: 10,
      overSpeedApproach: 2.0,
      brakeDecel: 16,
      coastDecel: 4.5,
      reverseFraction: 0.35,
      reverseAccel: 5,
      steerRate: 1.9,
      driftSteerRate: 1.9,
      hopVelocity: 4.5,
      lateralGripRoad: 8,
      lateralGripOffroad: 4,
      wallRestitution: 0.3,
    },
    drift: {
      hopDriftDelay: 0.15,
      minSpeed: 0.45,
      keepSpeed: 0.3,
      slipMax: 0.49,
      speedFactor: 0.965,
      stageThresholds: [1.0, 2.0, 3.2],
      boostDurations: [0, 0.7, 1.2, 1.8],
      boostStrength: 0.4,
    },
    status: {
      spinDuration: 1.1,
      offroadFactor: 0.55,
      shrunkFactor: 0.65,
      starFactor: 1.2,
      squishFactor: 0.5,
    },
    items: {
      greenSpeed: 34,
      redSpeed: 30,
      blueSpeed: 45,
      greenLife: 9,
      redLife: 8,
      bananaLife: 40,
      bombFuse: 2.5,
      explosionRadius: 4,
      lightningCooldown: 20,
      goldenMinSpacing: 0.25,
      ownerGrace: 0.35,
    },
    itemTable: [
      // 1st
      { banana: 35, green_shell: 35, triple_banana: 10, bob_omb: 5, red_shell: 15 },
      // 2nd
      { banana: 22, green_shell: 26, red_shell: 22, triple_green_shell: 12, mushroom: 10, bob_omb: 8 },
      // 3rd
      { banana: 16, green_shell: 22, red_shell: 26, triple_green_shell: 14, mushroom: 14, bob_omb: 8 },
      // 4th
      { red_shell: 26, triple_red_shell: 14, mushroom: 26, triple_mushroom: 14, bob_omb: 12, star: 8 },
      // 5th
      { red_shell: 22, triple_red_shell: 16, mushroom: 22, triple_mushroom: 18, bob_omb: 12, star: 10 },
      // 6th
      { triple_mushroom: 28, star: 20, red_shell: 15, lightning: 10, golden_mushroom: 22, triple_red_shell: 5 },
      // 7th
      { star: 22, lightning: 13, golden_mushroom: 24, blue_shell: 12, triple_mushroom: 19, triple_red_shell: 10 },
      // 8th
      { star: 22, lightning: 17, golden_mushroom: 22, blue_shell: 16, triple_mushroom: 15, triple_red_shell: 8 },
    ],
    ai: {
      profiles: {
        easy: {
          noise: 0.09,
          reactionMin: 1.0,
          reactionMax: 1.5,
          driftThreshold: 0.45,
          releaseStage: 1,
          brakeLatAccel: 34,
          easeThrottle: 0.6,
          usesMushrooms: false,
          startThrottleBeforeGo: 0.55,
          rubber: { base: 0.86, amp: 0.06, scale: 120, min: 0.82, max: 0.96 },
        },
        normal: {
          noise: 0.045,
          reactionMin: 0.6,
          reactionMax: 1.0,
          driftThreshold: 0.35,
          releaseStage: 2,
          brakeLatAccel: 46,
          easeThrottle: 0.65,
          usesMushrooms: true,
          startThrottleBeforeGo: 0.45,
          rubber: { base: 0.94, amp: 0.05, scale: 100, min: 0.9, max: 1.0 },
        },
        hard: {
          noise: 0.015,
          reactionMin: 0.4,
          reactionMax: 0.6,
          driftThreshold: 0.3,
          releaseStage: 3,
          brakeLatAccel: 62,
          easeThrottle: 0.75,
          usesMushrooms: true,
          startThrottleBeforeGo: 0.3,
          rubber: { base: 0.985, amp: 0.02, scale: 150, min: 0.97, max: 1.0 },
        },
      },
      kP: 2.2,
      kD: 0.15,
      lookaheadMin: 8,
      lookaheadMax: 30,
      hazardLookahead: 25,
      boxSeekDistance: 60,
    },
    race: {
      startBoostWindow: 0.6,
      startBoostWeakWindow: 1.2,
      startSpinoutHold: 2.6,
      wrongWaySeconds: 1.2,
      stuckSeconds: 6,
      finishGraceSeconds: 12,
    },
  };
}

/** The live tuning object every subsystem reads from. */
export const BALANCE: Balance = createDefaultBalance();

/**
 * Apply `b.<dot.path>=<number>` query params onto `target`. Only existing numeric leaves are
 * changed. Returns human-readable warnings for anything skipped.
 */
export function applyBalanceOverrides(target: Balance, params: URLSearchParams): string[] {
  const warnings: string[] = [];
  params.forEach((raw, key) => {
    if (!key.startsWith('b.')) return;
    const path = key.slice(2).split('.');
    let node: unknown = target;
    for (let i = 0; i < path.length - 1; i++) {
      if (node === null || typeof node !== 'object' || !(path[i] in (node as object))) {
        warnings.push(`${key}: unknown path`);
        return;
      }
      node = (node as Record<string, unknown>)[path[i]];
    }
    const leaf = path[path.length - 1];
    if (node === null || typeof node !== 'object' || typeof (node as Record<string, unknown>)[leaf] !== 'number') {
      warnings.push(`${key}: not a numeric balance value`);
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      warnings.push(`${key}: '${raw}' is not a number`);
      return;
    }
    (node as Record<string, number>)[leaf] = value;
  });
  return warnings;
}
