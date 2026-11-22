/**
 * Keeps a race at a playable frame rate by turning the render resolution down when frames run
 * long, and carefully back up when there is room.
 *
 * A quality tier is a guess made before a single frame has been drawn. This is the correction:
 * it watches how long frames really take, a second at a time. Two slow seconds in a row and the
 * resolution drops a step; at the floor, the costliest effects go too (`lean`). Going back up is
 * tried only after a long calm spell, and given up for good if the step up brings the slowness
 * straight back, so a device on the edge settles instead of pumping.
 */

export interface GovernorLimits {
  /** Lowest resolution scale allowed (fraction of the tier's pixel ratio). */
  minScale: number;
}

export interface GovernorState {
  /** Multiplier on the pixel ratio, minScale..1. */
  scale: number;
  /** True once the resolution floor was not enough: drop multisampling and the sun effects too. */
  lean: boolean;
}

/** Below this many frames a second (averaged over a second) the picture is costing too much. */
const SLOW_FPS = 48;
/** Seconds of comfortable frames before a step back up is tried. */
const CALM_SECONDS = 25;
const STEP_DOWN = 0.86;
const STEP_UP = 1.08;

export class ResolutionGovernor {
  private readonly limits: GovernorLimits;
  private scale = 1;
  private lean = false;
  private sum = 0;
  private frames = 0;
  private slowWindows = 0;
  private calm = 0;
  private sinceUp = Infinity;
  private upBlocked = false;

  constructor(limits: GovernorLimits) {
    this.limits = limits;
  }

  get state(): GovernorState {
    return { scale: this.scale, lean: this.lean };
  }

  /**
   * Feed one frame's real duration in seconds. Returns the new state when it changed, else null.
   * Frames longer than a quarter second are not counted: that is a tab coming back, not a slow GPU.
   */
  sample(seconds: number): GovernorState | null {
    if (!(seconds > 0) || seconds > 0.25) return null;
    this.sum += seconds;
    this.frames++;
    this.sinceUp += seconds;
    if (this.sum < 1) return null;
    const fps = this.frames / this.sum;
    this.sum = 0;
    this.frames = 0;

    if (fps < SLOW_FPS) {
      this.calm = 0;
      this.slowWindows++;
      if (this.slowWindows < 2) return null;
      this.slowWindows = 0;
      // A step up that is followed at once by slowness was a step too far: do not try again.
      if (this.sinceUp < 6) this.upBlocked = true;
      if (this.scale > this.limits.minScale + 1e-3) {
        this.scale = Math.max(this.limits.minScale, this.scale * STEP_DOWN);
        return this.state;
      }
      if (!this.lean) {
        this.lean = true;
        return this.state;
      }
      return null;
    }

    this.slowWindows = 0;
    this.calm++;
    if (this.calm >= CALM_SECONDS && !this.upBlocked && this.scale < 1) {
      this.calm = 0;
      this.sinceUp = 0;
      this.scale = Math.min(1, this.scale * STEP_UP);
      return this.state;
    }
    return null;
  }
}
