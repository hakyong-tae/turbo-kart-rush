/**
 * Track gimmicks, as numbers.
 *
 * Everything here is derived once from a `TrackDefinition` and a centerline, and is pure after
 * that: no scene objects, no clocks of its own. `Track` asks it three kinds of question —
 * what is the ground doing here (ramps, gaps, surface zones), where may a kart be respawned, and
 * where are the moving obstacles at race time T. The meshes live in `builders/features.ts`.
 */
import type { MoverDef, SurfaceType, TrackDefinition, TrackObstacle } from '../core/types';
import { BALANCE } from '../core/balance';
import { wrap01 } from '../core/math';

/** The slice of the centerline this module needs (so tests can pass a plain object). */
export interface CenterlineLike {
  readonly length: number;
  sOf(t: number): number;
}

export interface RampInfo {
  /** Arc length of the foot and of the lip. */
  s0: number;
  s1: number;
  height: number;
  lateral: number;
  /** Infinity = wall to wall. */
  halfWidth: number;
  /** Arc length where the road resumes after the lip (= s1 when there is no gap). */
  gapEnd: number;
}

export interface ZoneInfo {
  s0: number;
  s1: number;
  kind: 'ice' | 'mud' | 'boost';
  look: string;
  latMin: number;
  latMax: number;
}

/** Default ramp length in metres. */
export const RAMP_LENGTH = 10;
/** The first part of the wedge eases in, so the foot is not a kerb. */
const RAMP_EASE = 0.2;

/** Wedge profile: 0 at the foot, 1 at the lip, with a short quadratic lead-in. */
export function rampProfile(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const k = 1 - RAMP_EASE / 2;
  return u < RAMP_EASE ? (u * u) / (2 * RAMP_EASE) / k : (u - RAMP_EASE / 2) / k;
}

/** Is `s` inside [a, b) on a loop of length `len`? `b` may exceed `len` (range wraps the line). */
function inSpan(s: number, a: number, b: number, len: number): boolean {
  if (b <= len) return s >= a && s < b;
  return s >= a || s < b - len;
}

/** Signed distance from `a` forward to `s` on a loop (0..len). */
function ahead(s: number, a: number, len: number): number {
  const d = s - a;
  return d < 0 ? d + len : d;
}

export class TrackFeatures {
  readonly ramps: RampInfo[] = [];
  readonly zones: ZoneInfo[] = [];
  readonly movers: readonly MoverDef[];
  readonly length: number;
  /** True when the track has nothing from this module: lets the hot path skip all of it. */
  readonly empty: boolean;
  readonly hasGap: boolean;
  /** Slope (rise per metre) of the wedge at the last `rampHeight` hit. */
  lastRampSlope = 0;

  constructor(def: TrackDefinition, cl: CenterlineLike) {
    const len = cl.length;
    this.length = len;
    for (const r of def.ramps ?? []) {
      const s0 = cl.sOf(wrap01(r.t));
      const s1 = s0 + (r.length ?? RAMP_LENGTH);
      this.ramps.push({
        s0,
        s1,
        height: r.height,
        lateral: r.lateral ?? 0,
        halfWidth: r.halfWidth ?? Infinity,
        gapEnd: s1 + Math.max(0, r.gap ?? 0),
      });
    }
    for (const z of def.zones ?? []) {
      const s0 = cl.sOf(wrap01(z.from));
      let s1 = cl.sOf(wrap01(z.to));
      if (s1 <= s0) s1 += len;
      this.zones.push({
        s0,
        s1,
        kind: z.kind,
        look: z.look ?? z.kind,
        latMin: z.lateral ? Math.min(z.lateral[0], z.lateral[1]) : -Infinity,
        latMax: z.lateral ? Math.max(z.lateral[0], z.lateral[1]) : Infinity,
      });
    }
    this.movers = def.movers ?? [];
    this.hasGap = this.ramps.some((r) => r.gapEnd > r.s1);
    this.empty = this.ramps.length === 0 && this.zones.length === 0 && this.movers.length === 0;
  }

  /** Height of the ramp wedge above the road at (s, lateral); 0 off any ramp. */
  rampHeight(s: number, lateral: number): number {
    const ramps = this.ramps;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      if (!inSpan(s, r.s0, r.s1, this.length)) continue;
      if (Math.abs(lateral - r.lateral) > r.halfWidth) continue;
      this.lastRampSlope = r.height / (r.s1 - r.s0);
      return r.height * rampProfile(ahead(s, r.s0, this.length) / (r.s1 - r.s0));
    }
    return 0;
  }

  /** True where the road is missing after a ramp lip. */
  inGap(s: number): boolean {
    if (!this.hasGap) return false;
    const ramps = this.ramps;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      if (r.gapEnd > r.s1 && inSpan(s, r.s1, r.gapEnd, this.length)) return true;
    }
    return false;
  }

  /** Surface painted on the road at (s, lateral), or null for plain road. */
  zoneAt(s: number, lateral: number): SurfaceType | null {
    const zones = this.zones;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (lateral < z.latMin || lateral > z.latMax) continue;
      if (inSpan(s, z.s0, z.s1, this.length)) return z.kind;
    }
    return null;
  }

  /**
   * False inside the run-up to a gap, on the ramp, and over the gap itself: a kart put down
   * there has no speed and would drop straight back in.
   */
  isRespawnSafe(s: number): boolean {
    if (!this.hasGap) return true;
    const runup = BALANCE.track.respawnRunup;
    const ramps = this.ramps;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      if (r.gapEnd <= r.s1) continue;
      const a = r.s0 - runup;
      const from = a < 0 ? a + this.length : a;
      const span = r.gapEnd + 6 - a;
      if (ahead(s, from, this.length) < span) return false;
    }
    return true;
  }
}

// --- moving obstacles ----------------------------------------------------------------------

export interface MoverPose {
  /** Arc length along the centerline. */
  s: number;
  /** Signed lateral offset in metres. */
  lateral: number;
  /** Velocity along the road (m/s, + = with the traffic) and across it (m/s, + = to the right). */
  vAlong: number;
  vLateral: number;
  /** False while the mover is parked out of play (between crossings, or fading at a loop end). */
  active: boolean;
}

/** One car of one mover: the obstacle the physics sees, plus what is needed to move and draw it. */
export interface MoverSlot {
  def: MoverDef;
  car: number;
  radius: number;
  sFrom: number;
  sTo: number;
  reach: number;
  pose: MoverPose;
  obstacle: TrackObstacle;
  /** Race time of the last `setRaceTime`, for the warning lamps. */
  raceTime: number;
}

/** Metres at each end of a roller's run where it is fading in / out and cannot be hit. */
export const ROLLER_FADE = 5;
/** Spacing between the cars of a crosser, in radii. */
export const CAR_SPACING = 2.15;

/**
 * Where car `car` of mover `m` is at `time` seconds into the race. Pure: same arguments, same
 * answer, on every machine. `reach` is how far from the centerline a crosser starts and ends
 * (just beyond the walls); `len` the lap length.
 */
export function moverPose(m: MoverDef, car: number, time: number, len: number, sFrom: number, sTo: number, reach: number, out: MoverPose): MoverPose {
  const t = Math.max(0, time);
  if (m.kind === 'roller') {
    const span = sTo - sFrom; // signed: negative = toward the traffic
    const dist = Math.abs(span);
    const dir = span >= 0 ? 1 : -1;
    const travelled = (t * m.speed + (m.phase ?? 0) * dist) % dist;
    let s = sFrom + dir * travelled;
    if (s < 0) s += len;
    else if (s >= len) s -= len;
    out.s = s;
    const sway = m.sway ?? 0;
    const w = 0.9;
    const ph = (m.phase ?? 0) * 6.283;
    out.lateral = (m.lateral ?? 0) + sway * Math.sin(t * w + ph);
    out.vAlong = dir * m.speed;
    out.vLateral = sway * w * Math.cos(t * w + ph);
    out.active = travelled > ROLLER_FADE && travelled < dist - ROLLER_FADE;
    return out;
  }
  // crosser
  const radius = m.radius ?? 1.4;
  const cars = m.cars ?? 2;
  const trainLength = (cars - 1) * CAR_SPACING * radius;
  const travel = 2 * reach + trainLength;
  const crossing = travel / m.speed;
  const shifted = t + (m.phase ?? 0) * m.period;
  const cycle = Math.floor(shifted / m.period);
  const local = shifted - cycle * m.period;
  const dir = cycle % 2 === 0 ? 1 : -1;
  out.s = sFrom;
  out.vAlong = 0;
  if (local >= crossing) {
    out.active = false;
    out.lateral = dir * (reach + trainLength);
    out.vLateral = 0;
    return out;
  }
  // The lead car starts at -reach (travelling +) and the others trail behind it.
  const lead = -reach + m.speed * local;
  out.lateral = dir * (lead - car * CAR_SPACING * radius);
  out.vLateral = dir * m.speed;
  out.active = true;
  return out;
}

/** Seconds until a crosser next enters the road (0 while it is crossing). For warning lights. */
export function crosserCountdown(m: Extract<MoverDef, { kind: 'crosser' }>, time: number, reach: number): number {
  const radius = m.radius ?? 1.4;
  const travel = 2 * reach + ((m.cars ?? 2) - 1) * CAR_SPACING * radius;
  const crossing = travel / m.speed;
  const shifted = Math.max(0, time) + (m.phase ?? 0) * m.period;
  const local = shifted - Math.floor(shifted / m.period) * m.period;
  return local < crossing ? 0 : m.period - local;
}
