/**
 * Tiling noise, made once on the CPU and shared by every shader that wants some.
 *
 * Doing fbm in a fragment shader costs a hash and four mixes per octave per pixel; reading it
 * from a texture costs one fetch. The sky, the water and the ground detail all read these.
 */
import * as THREE from 'three';
import { hash2 } from '../core/math';
import { quality } from './quality';

function wrap(i: number, period: number): number {
  return ((i % period) + period) % period;
}

/** Value noise whose lattice repeats every `period` cells, so the result tiles. */
export function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const sx = seed * 57;
  const sy = seed * 131;
  const x0 = wrap(xi, period) + sx;
  const x1 = wrap(xi + 1, period) + sx;
  const y0 = wrap(yi, period) + sy;
  const y1 = wrap(yi + 1, period) + sy;
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tiling fbm over the unit square: `period` lattice cells across at the first octave. */
export function periodicFbm(u: number, v: number, period: number, octaves: number, seed: number, gain = 0.5): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(u * p, v * p, p, seed + o * 7) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

/** Tiling cellular noise (distance to the nearest feature point), 0 at a point, ~1 between them. */
export function periodicWorley(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = wrap(xi + i, period);
      const cy = wrap(yi + j, period);
      const px = xi + i + hash2(cx + seed * 17, cy + seed * 29);
      const py = yi + j + hash2(cx + seed * 43 + 5, cy + seed * 11 + 9);
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.min(1, Math.sqrt(best));
}

let shared: THREE.DataTexture | null = null;

/**
 * The shared noise texture (256², or 128² on the low tier; repeating, mipmapped).
 *   R: soft fbm, large shapes          G: fbm, a second independent field
 *   B: billowy cellular fbm (puffs)    A: fine fbm
 * Never disposed: it is 256 KB and every race uses it.
 */
export function noiseTexture(): THREE.DataTexture {
  if (shared) return shared;
  // The low tier reads the two coarse channels at a few scales and nothing else: a tile half
  // the size each way is a quarter of the work and looks the same there.
  const S = quality().tier === 'low' ? 128 : 256;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const r = periodicFbm(u, v, 4, 6, 1);
      const g = periodicFbm(u, v, 6, 5, 23, 0.55);
      const w1 = 1 - periodicWorley(u, v, 5, 3);
      const w2 = 1 - periodicWorley(u, v, 10, 7);
      const w3 = 1 - periodicWorley(u, v, 20, 11);
      const b = w1 * 0.6 + w2 * 0.28 + w3 * 0.12;
      const a = periodicFbm(u, v, 32, 3, 61);
      const i = (y * S + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, (r - 0.5) * 1.7 + 0.5)) * 255);
      data[i + 1] = Math.round(Math.min(1, Math.max(0, (g - 0.5) * 1.7 + 0.5)) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, (a - 0.5) * 1.8 + 0.5)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = 'gfx-noise';
  shared = tex;
  return tex;
}

export type DetailKind = 'asphalt' | 'grass' | 'sand' | 'snow' | 'ice' | 'rock' | 'water';

const detailCache = new Map<DetailKind, THREE.DataTexture>();

/** Height of one detail surface at (u, v) in 0..1, tiling. */
function detailHeight(kind: DetailKind, u: number, v: number): number {
  switch (kind) {
    case 'asphalt': {
      // Aggregate: fine pits and stones, with a little broad unevenness under them.
      const stones = 1 - periodicWorley(u, v, 48, 5);
      const grit = periodicFbm(u, v, 64, 2, 9);
      const broad = periodicFbm(u, v, 6, 3, 2);
      return stones * 0.6 + grit * 0.34 + broad * 0.06;
    }
    case 'grass': {
      const clumps = periodicFbm(u, v, 10, 4, 4);
      const blades = periodicFbm(u, v, 70, 2, 12);
      return clumps * 0.9 + blades * 0.5;
    }
    case 'sand': {
      // Wind ripples: a sine across a warped coordinate, softened by dunes.
      const warp = periodicFbm(u, v, 5, 3, 6);
      const ripple = 0.5 + 0.5 * Math.sin((u * 18 + warp * 2.2) * Math.PI * 2);
      const grain = periodicFbm(u, v, 80, 2, 31);
      return ripple * 0.75 + grain * 0.22 + warp * 0.6;
    }
    case 'snow': {
      const drifts = periodicFbm(u, v, 5, 4, 8);
      const sparkle = periodicFbm(u, v, 90, 1, 14);
      return drifts * 1.1 + sparkle * 0.12;
    }
    case 'ice': {
      const broad = periodicFbm(u, v, 4, 3, 15);
      const cracks = Math.pow(periodicWorley(u, v, 7, 19), 0.35);
      return broad * 0.5 + cracks * 0.6;
    }
    case 'water': {
      // Chop: ridged noise at two scales, so crests are sharp and troughs round.
      const a = 1 - Math.abs(periodicFbm(u, v, 5, 3, 33) - 0.5) * 2;
      const b = 1 - Math.abs(periodicFbm(u, v, 13, 3, 37) - 0.5) * 2;
      return a * a * 0.9 + b * 0.45;
    }
    case 'rock': {
      const strata = periodicFbm(u, v * 3, 6, 5, 21, 0.6);
      const chips = 1 - periodicWorley(u, v, 14, 23);
      return strata * 0.9 + chips * 0.45;
    }
  }
}

const DETAIL_STRENGTH: Readonly<Record<DetailKind, number>> = {
  asphalt: 1.5,
  grass: 3.2,
  sand: 3.0,
  snow: 2.4,
  ice: 1.6,
  rock: 4.2,
  water: 3.4,
};

/**
 * Tiling tangent-space normal map for a kind of surface (256², mipmapped), with the height the
 * normal was taken from in the alpha channel. Cached for the life of the page.
 */
export function detailNormalTexture(kind: DetailKind): THREE.DataTexture {
  const hit = detailCache.get(kind);
  if (hit) return hit;
  const S = 256;
  const h = new Float32Array(S * S);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const val = detailHeight(kind, x / S, y / S);
      h[y * S + x] = val;
      if (val < lo) lo = val;
      if (val > hi) hi = val;
    }
  }
  const span = hi - lo || 1;
  const strength = DETAIL_STRENGTH[kind];
  const data = new Uint8Array(S * S * 4);
  const at = (x: number, y: number): number => (h[wrap(y, S) * S + wrap(x, S)] - lo) / span;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = Math.round(at(x, y) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.name = `gfx-detail-${kind}`;
  detailCache.set(kind, tex);
  return tex;
}
