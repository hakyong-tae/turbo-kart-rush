import * as THREE from 'three';
import type { TrackDefinition } from '../../core/types';

/**
 * Dev-only sanity check for track definitions: the centerline must be a simple closed
 * curve with adequate spacing between non-adjacent sections (so barriers of different
 * sections never overlap) and no kinks tighter than a kart can reasonably drive.
 *
 * Two points with arc separation `a` may legitimately be close when they sit on the two legs
 * of a hairpin. The tightest allowed hairpin has legs 3.5 * halfWidth apart (radius
 * r = 1.75 * halfWidth), so the minimum legitimate chord for arc separation `a` is
 * 2r * sin(min(a / 2r, PI/2)). Anything below ~95% of that is reported.
 */
export function validateTrackDefinition(def: TrackDefinition): string[] {
  const warnings: string[] = [];
  const n = def.controlPoints.length;
  // The upper bound is a smell test, not an engine limit: a circuit wanting more than this many
  // points is usually one somebody is drawing corner by corner rather than laying out. Raised to
  // 48 for Prism Skyway, whose seven hairpins need four points each to hold their arc.
  if (n < 14 || n > 48) warnings.push(`has ${n} control points (expected 14..48)`);
  if (def.halfWidths && def.halfWidths.length !== n) {
    warnings.push(`halfWidths length ${def.halfWidths.length} != controlPoints length ${n}`);
  }
  if (def.halfWidth < 7 || def.halfWidth > 9) warnings.push(`halfWidth ${def.halfWidth} outside 7..9`);
  if (def.wallHalfWidthFactor < 1) warnings.push('wallHalfWidthFactor must be >= 1');
  for (const t of [...def.itemBoxRows, ...def.boostPads]) {
    if (t < 0 || t >= 1) warnings.push(`t value ${t} outside [0,1)`);
  }

  const pts = def.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  curve.arcLengthDivisions = 1000;
  const length = curve.getLength();
  if (length < 850 || length > 1450) warnings.push(`length ${length.toFixed(0)} m outside 850..1450`);

  const N = 400;
  const samples: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) samples.push(curve.getPointAt(i / N));
  const ds = length / N;
  const hw = def.halfWidth;
  const r = 1.75 * hw;
  let worst = Infinity;
  let worstInfo = '';
  for (let i = 0; i < N; i++) {
    const a = samples[i];
    for (let j = i + 1; j < N; j++) {
      let k = j - i;
      if (k > N / 2) k = N - k;
      const arc = k * ds;
      if (arc < 2 * hw) continue;
      const b = samples[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const need = 2 * r * Math.sin(Math.min(arc / (2 * r), Math.PI / 2));
      const ratio = d / need;
      if (ratio < worst) {
        worst = ratio;
        worstInfo = `t=${(i / N).toFixed(3)} and t=${(j / N).toFixed(3)} are ${d.toFixed(1)} m apart (need ${need.toFixed(1)} m)`;
      }
    }
  }
  if (worst < 0.95) warnings.push(`sections approach each other: ${worstInfo}`);

  // Kink / minimum radius check using a 3-point circle over a ~9 m baseline.
  let minR = Infinity;
  let minRt = 0;
  const step = Math.max(1, Math.round(4.5 / ds));
  for (let i = 0; i < N; i++) {
    const a = samples[(i - step + N) % N];
    const b = samples[i];
    const c = samples[(i + step) % N];
    const D = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
    if (Math.abs(D) < 1e-6) continue;
    const a2 = a.x * a.x + a.z * a.z;
    const b2 = b.x * b.x + b.z * b.z;
    const c2 = c.x * c.x + c.z * c.z;
    const ux = (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / D;
    const uz = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / D;
    const R = Math.hypot(a.x - ux, a.z - uz);
    if (R < minR) {
      minR = R;
      minRt = i / N;
    }
  }
  if (minR < 10) warnings.push(`kink: radius ${minR.toFixed(1)} m at t=${minRt.toFixed(3)}`);

  let ymin = Infinity;
  let ymax = -Infinity;
  for (const s of samples) {
    ymin = Math.min(ymin, s.y);
    ymax = Math.max(ymax, s.y);
  }
  if (ymax - ymin > 18) warnings.push(`elevation range ${(ymax - ymin).toFixed(1)} m is very large`);

  // The starting grid is laid out from 6 to about 23 m behind the finish line, each kart squared
  // to the road under it. If the road is still turning there the eight karts fan out across it and
  // the rigid start-line stands sit on a bend — QA found both on Switchback Pass. Ask for a real
  // straight, a little longer than the grid, before the line.
  const t0 = curve.getTangentAt(0);
  const startHeading = Math.atan2(t0.x, t0.z);
  let worstFan = 0;
  let worstFanS = 0;
  for (let back = 0; back <= 26; back += 2) {
    const t = ((1 - back / length) % 1 + 1) % 1;
    const tan = curve.getTangentAt(t);
    let d = Math.atan2(tan.x, tan.z) - startHeading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > Math.abs(worstFan)) { worstFan = d; worstFanS = back; }
  }
  const fanDeg = Math.abs((worstFan * 180) / Math.PI);
  if (fanDeg > 8) warnings.push(`start straight bends ${fanDeg.toFixed(1)}° by ${worstFanS} m before the line`);

  warnings.push(...validateGimmicks(def, length));
  return warnings;
}

/** Is t inside any `voidRanges` entry (ranges may wrap the line)? */
function inVoidRange(def: TrackDefinition, t: number): boolean {
  for (const [a, b] of def.voidRanges ?? []) {
    if (a <= b ? t >= a && t <= b : t >= a || t <= b) return true;
  }
  return false;
}

/**
 * Rules for ramps, surface zones, moving obstacles and wall overrides. They are about fairness,
 * not taste: a gap nobody can clear from a respawn, a ramp under the starting grid or a boulder
 * that pops into existence on top of a kart are bugs, whatever the layout looks like.
 */
function validateGimmicks(def: TrackDefinition, length: number): string[] {
  const out: string[] = [];
  const in01 = (t: number): boolean => t >= 0 && t < 1;
  const n = def.controlPoints.length;

  if (def.wallHalfWidthFactors) {
    if (def.wallHalfWidthFactors.length !== n) out.push(`wallHalfWidthFactors length ${def.wallHalfWidthFactors.length} != controlPoints length ${n}`);
    if (def.wallHalfWidthFactors.some((f) => f < 1 || f > 4)) out.push('wallHalfWidthFactors must be within 1..4');
  }

  (def.ramps ?? []).forEach((r, i) => {
    const name = `ramp ${i}`;
    const len = r.length ?? 10;
    if (!in01(r.t)) out.push(`${name}: t ${r.t} outside [0,1)`);
    if (r.height < 0.5 || r.height > 4) out.push(`${name}: height ${r.height} outside 0.5..4 m`);
    if (len < 6 || len > 24) out.push(`${name}: length ${len} outside 6..24 m`);
    if (r.height / len > 0.36) out.push(`${name}: slope ${(r.height / len).toFixed(2)} is steeper than 0.36 (karts would be thrown, not launched)`);
    // Clear of the grid (the last ~45 m before the line) and of the first metres after it.
    const s0 = r.t * length;
    const s1 = s0 + len + (r.gap ?? 0);
    if (s1 > length - 50 || s0 < 12) out.push(`${name}: sits on the starting grid or right after the line`);
    if (r.gap !== undefined) {
      if (r.gap < 3 || r.gap > 14) out.push(`${name}: gap ${r.gap} outside 3..14 m`);
      // The terrain is only carved away under void ranges; anywhere else the "gap" has ground in it.
      for (const s of [s0 + len, s0 + len + r.gap]) {
        if (!inVoidRange(def, s / length)) out.push(`${name}: gap at t=${(s / length).toFixed(3)} is not inside a voidRanges section`);
      }
      // A boost pad in the run-up, so nobody arrives at a gap slowly by accident.
      const runup = def.boostPads.some((p) => {
        const d = s0 - p * length;
        return d > 8 && d < 70;
      });
      if (!runup) out.push(`${name}: a gap needs a boost pad 8..70 m before the ramp`);
    }
  });

  (def.zones ?? []).forEach((z, i) => {
    const name = `zone ${i}`;
    if (!in01(z.from) || !in01(z.to)) out.push(`${name}: from/to outside [0,1)`);
    let span = (z.to - z.from) * length;
    if (span <= 0) span += length;
    if (span < 6 || span > 260) out.push(`${name}: ${span.toFixed(0)} m long (expected 6..260)`);
    if (z.lateral && Math.abs(z.lateral[1] - z.lateral[0]) < 2) out.push(`${name}: narrower than 2 m`);
  });

  (def.movers ?? []).forEach((m, i) => {
    const name = `mover ${i}`;
    if (m.speed <= 0 || m.speed > 20) out.push(`${name}: speed ${m.speed} outside 0..20 m/s`);
    if (m.kind === 'roller') {
      if (!in01(m.from) || !in01(m.to)) out.push(`${name}: from/to outside [0,1)`);
      const run = Math.abs(m.to - m.from) * length;
      if (run < 40) out.push(`${name}: run of ${run.toFixed(0)} m is too short (needs 40 m; it fades in and out over the ends)`);
      const grid = [m.from, m.to].some((t) => t * length > length - 50 || t * length < 12);
      if (grid) out.push(`${name}: runs onto the starting grid`);
    } else {
      if (!in01(m.t)) out.push(`${name}: t ${m.t} outside [0,1)`);
      if (m.period < 4) out.push(`${name}: period ${m.period} s is too short to pass between crossings`);
      if (m.t * length > length - 60 || m.t * length < 20) out.push(`${name}: crosses the starting grid`);
    }
  });
  return out;
}

export function validateAllTracks(defs: readonly TrackDefinition[]): void {
  const ids = new Set<string>();
  for (const def of defs) {
    if (ids.has(def.id)) console.warn(`[track] duplicate track id '${def.id}'`);
    ids.add(def.id);
    const warnings = validateTrackDefinition(def);
    for (const w of warnings) console.warn(`[track] ${def.id}: ${w}`);
  }
}
