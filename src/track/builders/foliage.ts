/**
 * Plants, and the small things that make ground look like ground: faceted low-poly trees that
 * sway, tufts of grass along the road, pebbles, and the soft dark patch under anything that
 * stands on the terrain.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildContext } from './context';
import { indexAtS } from './context';
import { addChunkedInstances, type InstanceSpec } from './instancing';
import { isVoidT } from './barriers';
import { CURB_WIDTH } from './road';
import { hash2, lerp } from '../../core/math';
import { quality } from '../../gfx/quality';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ geometry

/** Strips a geometry to position only, unindexed: one vertex per corner, ready for flat shading. */
function corners(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  return g;
}

/**
 * A lump: an icosphere with every point pushed in or out a little, so no two facets catch the
 * light alike. `seed` keeps it the same lump every time.
 */
export function lump(radius: number, detail: number, jitter: number, seed: number, squash: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const g = corners(new THREE.IcosahedronGeometry(radius, detail));
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    // Shared corners must move together: the push is a function of where the point is.
    const k = 1 + (hash2(Math.round(_v.x * 97) + seed * 13.1, Math.round(_v.y * 89) * 7 + Math.round(_v.z * 83) * 131) - 0.5) * 2 * jitter;
    pos.setXYZ(i, _v.x * k * squash[0], _v.y * k * squash[1], _v.z * k * squash[2]);
  }
  return g;
}

/**
 * Gives every facet one colour, running from `bottom` to `top` over the geometry's height, with a
 * little difference from facet to facet. Returns the same geometry, flat-shaded.
 */
export function paintFacets(geo: THREE.BufferGeometry, bottom: number, top: number, variance = 0.08, seed = 1): THREE.BufferGeometry {
  const g = geo.index || geo.attributes.normal ? corners(geo) : geo;
  const pos = g.attributes.position as THREE.BufferAttribute;
  g.computeBoundingBox();
  const y0 = g.boundingBox?.min.y ?? 0;
  const y1 = g.boundingBox?.max.y ?? 1;
  const lo = new THREE.Color(bottom);
  const hi = new THREE.Color(top);
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const k = y1 > y0 ? (cy - y0) / (y1 - y0) : 0.5;
    const shade = 1 + (hash2(f * 0.37 + seed * 5.3, cy * 11.1 + seed) - 0.5) * 2 * variance;
    _c.copy(lo).lerp(hi, k).multiplyScalar(shade);
    for (let v = 0; v < 3; v++) {
      colors[(f + v) * 3] = _c.r;
      colors[(f + v) * 3 + 1] = _c.g;
      colors[(f + v) * 3 + 2] = _c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Merges painted parts into one geometry (position, normal, colour). */
export function joinParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('joinParts failed');
  merged.computeBoundingSphere();
  return merged;
}

/** A broadleaf tree, about 8 m tall: a tapered trunk under four lumps of canopy. */
export function broadleafTree(leafDark: number, leafLight: number, seed = 1): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.24, 0.5, 3.6, 6, 2);
  trunk.translate(0, 1.8, 0);
  const canopy: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [2.6, 0, 5.2, 0],
    [1.9, 1.5, 6.2, 0.7],
    [1.7, -1.4, 5.9, -0.9],
    [1.5, 0.2, 7.3, 0.2],
    [1.6, -0.3, 4.6, 1.5],
  ];
  blobs.forEach(([r, x, y, z], i) => {
    const g = lump(r, 1, 0.13, seed * 10 + i, [1, 0.9, 1]);
    g.translate(x, y, z);
    canopy.push(g);
  });
  const leaves = paintFacets(joinPositions(canopy), leafDark, leafLight, 0.09, seed);
  return joinParts([paintFacets(trunk, 0x4a3320, 0x7a573a, 0.06, seed), leaves]);
}

/** A conifer, about 9 m tall: three tiers of faceted cone. */
export function coniferTree(leafDark: number, leafLight: number, cap: number | null = null, seed = 1): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, 2.6, 6);
  trunk.translate(0, 1.3, 0);
  const tiers: THREE.BufferGeometry[] = [];
  const spec: [number, number, number][] = [
    [2.1, 3.6, 3.6],
    [1.6, 3.2, 5.6],
    [1.05, 2.8, 7.5],
  ];
  spec.forEach(([r, h, y], i) => {
    const cone = corners(new THREE.ConeGeometry(r, h, 8, 1));
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      _v.fromBufferAttribute(pos, v);
      if (_v.y < 0) {
        // The skirt of each tier dips and rises round the tree.
        const ang = Math.atan2(_v.z, _v.x);
        const k = 1 + 0.12 * Math.sin(ang * 4 + seed + i * 2);
        pos.setXYZ(v, _v.x * k, _v.y - 0.18 * Math.cos(ang * 4 + i), _v.z * k);
      }
    }
    cone.translate(0, y, 0);
    tiers.push(cone);
  });
  const parts = [paintFacets(trunk, 0x45301f, 0x6b4a30, 0.06, seed), paintFacets(joinPositions(tiers), leafDark, leafLight, 0.08, seed)];
  if (cap !== null) {
    const snow = corners(new THREE.ConeGeometry(0.62, 1.5, 8, 1));
    snow.translate(0, 8.3, 0);
    parts.push(paintFacets(snow, cap, cap, 0.03, seed));
  }
  return joinParts(parts);
}

/** A palm, about 9 m tall: a leaning ringed trunk and a crown of drooping fronds. */
export function palmTree(seed = 1): THREE.BufferGeometry {
  const trunkParts: THREE.BufferGeometry[] = [];
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const r0 = lerp(0.36, 0.2, t0);
    const seg = new THREE.CylinderGeometry(r0 * 0.86, r0, 7.2 / segs + 0.04, 7, 1);
    // A gentle S-lean, more toward the crown.
    seg.translate(Math.sin(t0 * 1.9) * 0.9, (i + 0.5) * (7.2 / segs), 0);
    trunkParts.push(corners(seg));
  }
  const trunk = paintFacets(joinPositions(trunkParts), 0x6a4a2c, 0x9a7448, 0.1, seed);
  const topX = Math.sin(1.9) * 0.9;
  const fronds: THREE.BufferGeometry[] = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (i % 2) * 0.2;
    const len = 3.6 + (i % 3) * 0.5;
    const frond = new THREE.PlaneGeometry(1.0, len, 2, 5);
    const pos = frond.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const k = (y + len / 2) / len;
      const x = pos.getX(v);
      // Arc out and down, narrow to a point, and fold along the midrib.
      pos.setXYZ(v, x * (1 - k * 0.85) , 0.9 * Math.sin(k * 2.2) - k * k * 2.1 - Math.abs(x) * 0.45, k * len);
    }
    frond.rotateY(a);
    frond.translate(topX, 7.25, 0);
    fronds.push(corners(frond));
  }
  const crown = paintFacets(joinPositions(fronds), 0x2f8f3a, 0x8fd04a, 0.1, seed);
  const nuts = lump(0.3, 0, 0.1, seed, [1, 0.9, 1]);
  nuts.translate(topX + 0.2, 6.95, 0.15);
  return joinParts([trunk, crown, paintFacets(nuts, 0x5a3a1e, 0x7a5230, 0.05, seed)]);
}

/** A bush: one squashed lump. */
export function bush(leafDark: number, leafLight: number, seed = 1): THREE.BufferGeometry {
  const main = lump(1, 1, 0.16, seed, [1.25, 0.8, 1.2]);
  main.translate(0, 0.45, 0);
  const side = lump(0.62, 1, 0.16, seed + 4, [1.1, 0.85, 1.1]);
  side.translate(0.85, 0.3, 0.3);
  return paintFacets(joinPositions([main, side]), leafDark, leafLight, 0.1, seed);
}

/** A rock: a low lump with a flat-ish foot. */
export function rock(dark: number, light: number, seed = 1): THREE.BufferGeometry {
  const g = lump(1, 1, 0.22, seed, [1.15, 0.72, 0.95]);
  g.translate(0, 0.28, 0);
  return paintFacets(g, dark, light, 0.12, seed);
}

function joinPositions(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('joinPositions failed');
  return merged;
}

// ------------------------------------------------------------------ materials

/**
 * Standard material for plants: vertex-coloured, and bending in the wind. The bend grows with
 * the square of a point's height, so trunks stand and crowns move; each instance is out of step
 * with its neighbours.
 */
export function plantMaterial(ctx: BuildContext, sway: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, ...extra });
  const time = ctx.timeUniform;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGfxTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGfxTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  float gfxPhase = dot( instanceMatrix[3].xz, vec2( 0.13, 0.17 ) );
#else
  float gfxPhase = 0.0;
#endif
  float gfxWind = sin( uGfxTime * 1.3 + gfxPhase ) + 0.5 * sin( uGfxTime * 2.9 + gfxPhase * 1.7 );
  float gfxLift = max( transformed.y, 0.0 );
  transformed.x += gfxWind * ${sway.toFixed(5)} * gfxLift * gfxLift;
  transformed.z += gfxWind * ${(sway * 0.6).toFixed(5)} * gfxLift * gfxLift;
`,
      );
  };
  mat.customProgramCacheKey = () => `gfx-plant-${sway}`;
  return mat;
}

// ------------------------------------------------------------------ ground cover

interface CoverKind {
  /** Tufts per square metre next to the road at full quality. */
  density: number;
  base: number;
  tip: number;
  /** Blade height range in metres and the number of blades in a tuft. */
  height: [number, number];
  blades: number;
  /** How far beyond the wall line the cover reaches. */
  reach: number;
  sway: number;
  /** Pebbles per square metre (0 = none) and their colours. */
  pebbles: number;
  pebbleDark: number;
  pebbleLight: number;
}

const COVER: Readonly<Partial<Record<string, CoverKind>>> = {
  grassland: { density: 2.6, base: 0x2f7a2c, tip: 0x93d646, height: [0.2, 0.42], blades: 9, reach: 13, sway: 0.5, pebbles: 0, pebbleDark: 0, pebbleLight: 0 },
  beach: { density: 0.45, base: 0x6f8a3a, tip: 0xd9d47a, height: [0.3, 0.62], blades: 8, reach: 11, sway: 0.6, pebbles: 0.12, pebbleDark: 0x9a8a72, pebbleLight: 0xe8dcc0 },
  desert: { density: 0.3, base: 0x8a7a3a, tip: 0xe0c877, height: [0.25, 0.5], blades: 7, reach: 11, sway: 0.45, pebbles: 0.2, pebbleDark: 0x8a5632, pebbleLight: 0xd69a66 },
  volcano: { density: 0.1, base: 0x4a3a2a, tip: 0x8a6a3a, height: [0.2, 0.4], blades: 6, reach: 10, sway: 0.4, pebbles: 0.3, pebbleDark: 0x1c1416, pebbleLight: 0x4a3530 },
  snow: { density: 0, base: 0, tip: 0, height: [0, 0], blades: 0, reach: 10, sway: 0, pebbles: 0.16, pebbleDark: 0xbcd4ea, pebbleLight: 0xffffff },
};

/** One tuft: thin blades fanning out from a point, one triangle each. Normals point straight up. */
function tuftGeometry(blades: number, seed: number): THREE.BufferGeometry {
  const verts: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < blades; i++) {
    const r1 = hash2(i * 3.7 + seed, seed * 1.3 + 0.5);
    const r2 = hash2(i * 9.1 + seed * 2.1, 4.4);
    const a = (i / blades) * Math.PI * 2 + r1 * 1.4;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const lean = 0.05 + r2 * 0.16;
    const h = 0.55 + r1 * 0.45;
    const w = 0.022 + r2 * 0.02;
    const ox = dx * 0.13 * r2 + (r1 - 0.5) * 0.1;
    const oz = dz * 0.13 * r2 + (r2 - 0.5) * 0.1;
    // Perpendicular to the lean, for the blade's width.
    const px = -dz * w;
    const pz = dx * w;
    verts.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + dx * lean, h, oz + dz * lean);
    // Colour runs 0.42 at the root to 1 at the tip; buildGroundCover scales it into the kind's own.
    cols.push(0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 1, 1, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const normals = new Float32Array(verts.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Lit like the ground it grows from (normals up on both faces), swaying, and shrinking away with distance. */
function tuftMaterial(ctx: BuildContext, sway: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const time = ctx.timeUniform;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGfxTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGfxTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 gfxRoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  // Past 50 m a blade is thinner than a pixel and only shimmers: let it sink into the ground.
  float gfxKeep = 1.0 - smoothstep( 46.0, 72.0, distance( gfxRoot, cameraPosition ) );
  transformed.y *= gfxKeep;
  float gfxPhase = dot( gfxRoot.xz, vec2( 0.35, 0.27 ) );
  float gfxWind = sin( uGfxTime * 2.1 + gfxPhase ) + 0.6 * sin( uGfxTime * 3.7 + gfxPhase * 1.9 );
  transformed.x += gfxWind * ${sway.toFixed(4)} * transformed.y * transformed.y;
  transformed.z += gfxWind * ${(sway * 0.5).toFixed(4)} * transformed.y * transformed.y;
#endif
`,
      );
    // Both faces shade as "up": a blade must not go dark when it turns its back.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;',
    );
  };
  mat.customProgramCacheKey = () => `gfx-tuft-${sway}`;
  return mat;
}

/**
 * Tufts of grass (and pebbles) in a band along both sides of the road: on the shoulder the karts
 * run wide onto, and out over the first metres of open ground beyond the barrier.
 */
export function buildGroundCover(ctx: BuildContext): THREE.Group | null {
  const kind = COVER[ctx.def.theme];
  const scale = quality().groundDetail;
  if (!kind || scale <= 0) return null;
  const { cl, def, field } = ctx;
  const group = new THREE.Group();
  group.name = 'groundCover';
  const rng = ctx.rng;
  const heightAt = ctx.terrainHeight ?? ((x: number, z: number) => field.heightAt(x, z));

  /** A random spot in the band beside the road at arc position s, or null if nothing can grow there. */
  const spot = (s: number, nearBias: number): { x: number; y: number; z: number } | null => {
    const i = indexAtS(cl, s);
    const t = s / cl.length;
    if (ctx.features.hasGap && ctx.features.inGap(s)) return null;
    const side = rng() < 0.5 ? -1 : 1;
    // Clear of the curb by more than a blade's reach: grass must not lie over the paint.
    const inner = cl.hw[i] + CURB_WIDTH + 0.6;
    const wall = cl.whw[i];
    const outer = wall + kind.reach;
    const lat = lerp(inner, outer, Math.pow(rng(), nearBias));
    // Not under the barrier itself.
    if (Math.abs(lat - (wall + 0.5)) < 0.75) return null;
    const beyondWall = lat > wall + 0.9;
    if (beyondWall && isVoidT(def, t)) return null;
    const x = cl.px[i] + cl.bx[i] * side * lat;
    const z = cl.pz[i] + cl.bz[i] * side * lat;
    // On the inside of a tight corner "lat metres out" can be the road again, on its way back.
    if (field.distanceToTrack(x, z) < lat - 0.6) return null;
    if (!ctx.features.empty && !beyondWall && ctx.features.rampHeight(s, side * lat) > 0) return null;
    const y = beyondWall ? heightAt(x, z) : cl.py[i] - 0.02;
    if (field.seaLevel !== null && y < field.seaLevel + 0.35) return null;
    return { x, y, z };
  };

  const bandWidth = (cl.maxWallHalfWidth - cl.hw[0]) * 0.5 + kind.reach;
  const area = cl.length * bandWidth * 2;

  if (kind.density > 0) {
    const want = Math.round(area * kind.density * scale * 0.5);
    const baseCol = new THREE.Color(kind.base);
    const tipCol = new THREE.Color(kind.tip);
    // Three shapes of tuft, so a field of them is not one tuft repeated.
    const shapes = [tuftGeometry(kind.blades, 1), tuftGeometry(kind.blades + 2, 2), tuftGeometry(Math.max(3, kind.blades - 2), 3)];
    for (const g of shapes) {
      // The geometry's colours run dark to white up the blade; scale them into the kind's own.
      const col = g.attributes.color as THREE.BufferAttribute;
      for (let v = 0; v < col.count; v++) {
        const k = (col.getX(v) - 0.42) / 0.58;
        _c.copy(baseCol).lerp(tipCol, k);
        col.setXYZ(v, _c.r, _c.g, _c.b);
      }
    }
    const mat = tuftMaterial(ctx, kind.sway);
    const perShape: InstanceSpec[][] = shapes.map(() => []);
    for (let n = 0; n < want; n++) {
      const s = rng() * cl.length;
      const p = spot(s, 1.6);
      if (!p) continue;
      const h = lerp(kind.height[0], kind.height[1], rng());
      const wide = 0.9 + rng() * 0.8;
      _e.set(0, rng() * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _p.set(p.x, p.y, p.z);
      _s.set(wide, h, wide);
      const tint = new THREE.Color().setHSL(0, 0, 0.86 + rng() * 0.28);
      // A few tufts in ten are drier.
      if (rng() < 0.18) tint.setRGB(1.12, 1.02, 0.72);
      perShape[n % shapes.length].push({ s, matrix: new THREE.Matrix4().compose(_p, _q, _s), color: tint });
    }
    perShape.forEach((specs, i) => {
      addChunkedInstances(ctx, group, shapes[i], mat, specs, `tufts${i}`, { castShadow: false, receiveShadow: true, sectionLength: 55 });
    });
  }

  if (kind.pebbles > 0) {
    const want = Math.round(area * kind.pebbles * Math.max(0.4, scale) * 0.5);
    const geo = rock(kind.pebbleDark, kind.pebbleLight, 5);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ctx.def.theme === 'snow' ? 0.5 : 0.92, metalness: 0 });
    const specs: InstanceSpec[] = [];
    for (let n = 0; n < want; n++) {
      const s = rng() * cl.length;
      const p = spot(s, 1.2);
      if (!p) continue;
      const size = 0.12 + Math.pow(rng(), 2.2) * 0.5;
      _e.set((rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5);
      _q.setFromEuler(_e);
      _p.set(p.x, p.y - size * 0.08, p.z);
      _s.set(size * (0.8 + rng() * 0.5), size * (0.6 + rng() * 0.5), size * (0.8 + rng() * 0.5));
      specs.push({ s, matrix: new THREE.Matrix4().compose(_p, _q, _s), color: new THREE.Color().setHSL(0, 0, 0.8 + rng() * 0.3) });
    }
    addChunkedInstances(ctx, group, geo, mat, specs, 'pebbles', { castShadow: false, receiveShadow: true, sectionLength: 55 });
  }
  return group.children.length > 0 ? group : null;
}

// ------------------------------------------------------------------ blob shadows

let blobTexture: THREE.CanvasTexture | null = null;

function blobAlpha(): THREE.CanvasTexture {
  if (blobTexture) return blobTexture;
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const c2d = canvas.getContext('2d');
  if (c2d) {
    const g = c2d.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#b0b0b0');
    g.addColorStop(1, '#000000');
    c2d.fillStyle = g;
    c2d.fillRect(0, 0, S, S);
  }
  blobTexture = new THREE.CanvasTexture(canvas);
  blobTexture.colorSpace = THREE.NoColorSpace;
  return blobTexture;
}

export interface BlobSpot {
  x: number;
  z: number;
  radius: number;
}

/**
 * A soft dark patch on the terrain under each given spot.
 *
 * The sun's shadow map reaches a few dozen metres from the player; a tree beyond that would
 * stand on the grass with nothing under it. This is the shade directly beneath a crown, which
 * is there whatever the hour, so it sits well with the real shadow where both are seen.
 */
export function addBlobShadows(ctx: BuildContext, group: THREE.Group, spots: readonly BlobSpot[], opacity = 0.42): void {
  if (spots.length === 0) return;
  const heightAt = ctx.terrainHeight ?? ((x: number, z: number) => ctx.field.heightAt(x, z));
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x04060c,
    alphaMap: blobAlpha(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  ctx.disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const y = heightAt(sp.x, sp.z);
    // Lie along the slope: the terrain's normal from the heights either side.
    const e = Math.max(1.5, sp.radius * 0.6);
    _a.set(2 * e, heightAt(sp.x + e, sp.z) - heightAt(sp.x - e, sp.z), 0);
    _b.set(0, heightAt(sp.x, sp.z + e) - heightAt(sp.x, sp.z - e), 2 * e);
    _v.crossVectors(_b, _a).normalize();
    _q.setFromUnitVectors(UP, _v);
    _p.set(sp.x, y + 0.07, sp.z);
    _s.set(sp.radius, 1, sp.radius);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  mesh.name = 'blobShadows';
  mesh.computeBoundingSphere();
  group.add(mesh);
}
