import * as THREE from 'three';
import type { BuildContext } from './context';
import { color, track, trackMesh } from './context';
import { makeGroundTexture } from '../textures';
import { TERRAIN_EXTENT, VOID_BASIN_DEPTH } from '../TerrainField';
import { fbm2, smoothstep, clamp01, lerp } from '../../core/math';
import { detailNormalTexture, type DetailKind } from '../../gfx/noise';
import { addGroundDetail } from '../../gfx/materials';
import { quality } from '../../gfx/quality';

const TERRAIN_SEGMENTS = 240;

/** Which relief the open ground of each theme carries. */
export const GROUND_DETAIL: Readonly<Record<string, DetailKind>> = {
  grassland: 'grass',
  beach: 'sand',
  desert: 'sand',
  volcano: 'rock',
  snow: 'snow',
  neon: 'asphalt',
};

/** Large displaced ground plane with theme vertex colours. */
export function buildTerrain(ctx: BuildContext): THREE.Mesh {
  const { def, field } = ctx;
  const theme = def.theme;
  const geo = new THREE.PlaneGeometry(TERRAIN_EXTENT, TERRAIN_EXTENT, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;

  const ground = color(def.palette.ground);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  const rock = theme === 'snow' ? color(0x6f7b8a) : theme === 'desert' ? color(0x8a4f2a) : theme === 'neon' ? color(0x15131d) : color(0x6b5a3e);
  const high = theme === 'snow' ? color(0xffffff) : theme === 'desert' ? color(0xe8b877) : theme === 'neon' ? color(0x1a1826) : color(0x9ab85a);
  const low = theme === 'snow' ? color(0xd6e6f5) : theme === 'desert' ? color(0xb9823f) : theme === 'neon' ? color(0x0a0912) : color(0x3f7a2a);
  const water = theme === 'snow' ? color(0x0a3049) : color(0x1d3a5a);
  const roadBand = theme === 'neon' ? color(0x1c1a28) : theme === 'snow' ? color(0xf2f7fc) : color(def.palette.offroad);

  const roadYMin = ctx.cl.minY;
  // Displace first, then derive slope from the recomputed normals (cheaper than extra height taps).
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i) + field.centerX;
    const z = pos.getZ(i) + field.centerZ;
    const h = field.heightAt(x, z);
    pos.setXYZ(i, x, h, z);
    uv.setXY(i, x / 6, z / 6);
  }
  geo.computeVertexNormals();
  // The mesh's own height between its vertices, for things that must sit exactly on it.
  // PlaneGeometry lays its vertices out row by row and cuts each cell along the same diagonal.
  const N = TERRAIN_SEGMENTS;
  const x0 = field.centerX - TERRAIN_EXTENT / 2;
  const z0 = field.centerZ - TERRAIN_EXTENT / 2;
  ctx.terrainHeight = (x, z) => {
    const gx = clamp01((x - x0) / TERRAIN_EXTENT) * N;
    const gz = clamp01((z - z0) / TERRAIN_EXTENT) * N;
    const i = Math.min(N - 1, Math.floor(gx));
    const j = Math.min(N - 1, Math.floor(gz));
    const u = gx - i;
    const v = gz - j;
    const ha = pos.getY(i + (N + 1) * j);
    const hb = pos.getY(i + (N + 1) * (j + 1));
    const hc = pos.getY(i + 1 + (N + 1) * (j + 1));
    const hd = pos.getY(i + 1 + (N + 1) * j);
    return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  };
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = pos.getY(i);
    const slope = clamp01((1 - nrm.getY(i)) * 2.2);
    const n = fbm2(x * 0.015 + 3.3, z * 0.015 + 8.8, 3);
    field.sampleField(x, z);
    const nearRoad = 1 - smoothstep(ctx.cl.maxWallHalfWidth + 2, ctx.cl.maxWallHalfWidth + 18, field.fDist);

    // height-based blend relative to the road elevation band
    const rel = clamp01((h - roadYMin + 6) / 40);
    c.copy(low).lerp(high, rel);
    c.lerp(ground, 0.35);
    tmp.copy(c).offsetHSL(0, 0, (n - 0.5) * 0.12);
    c.copy(tmp);
    c.lerp(rock, slope * (theme === 'desert' ? 0.7 : 0.85));
    c.lerp(roadBand, nearRoad * 0.55);
    if (theme === 'snow') {
      // deep basin = frozen water; snow stays bright on the flats
      const depthBelowRoad = roadYMin - h;
      const wet = smoothstep(VOID_BASIN_DEPTH * 0.4, VOID_BASIN_DEPTH * 0.75, depthBelowRoad);
      c.lerp(water, wet);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();

  const tex = makeGroundTexture(theme, 0xffffff);
  track(ctx, tex);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex,
    roughness: theme === 'snow' ? 0.72 : theme === 'neon' ? 0.55 : 0.95,
    metalness: 0,
  });
  if (quality().detailNormals && theme !== 'neon') {
    // Relief for the light to catch: shares the colour texture's uv, so one tile is 6 m.
    mat.normalMap = detailNormalTexture(GROUND_DETAIL[theme] ?? 'grass');
    mat.normalScale = new THREE.Vector2(0.9, 0.9);
  }
  addGroundDetail(mat, { macro: theme === 'neon' ? 0.12 : 0.3, second: theme === 'neon' ? 0 : 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  trackMesh(ctx, mesh);
  return mesh;
}

interface MountainLook {
  /** Colour at the foot, on the slopes, on bare rock, and on the caps. */
  foot: number;
  slope: number;
  rock: number;
  cap: number;
  /** Height fraction (0..1 of the ring's tallest peak) above which the cap colour takes over; > 1 = never. */
  capLine: number;
  /** 0 = sharp ridges, 1 = flat-topped mesas. */
  mesa: number;
  /** Glow added along the highest ridges (lava). */
  glow: number;
  /** How tall the range stands (multiplier on the default heights). */
  height: number;
}

const MOUNTAIN_LOOKS: Readonly<Record<string, MountainLook>> = {
  grassland: { foot: 0x4f8f45, slope: 0x4b7f63, rock: 0x7b8aa0, cap: 0xf4f8ff, capLine: 0.78, mesa: 0, glow: 0, height: 1 },
  beach: { foot: 0x4fa457, slope: 0x3f8f62, rock: 0x8d958c, cap: 0xc9d2c4, capLine: 1.3, mesa: 0.15, glow: 0, height: 0.8 },
  desert: { foot: 0xd9a26a, slope: 0xc47a45, rock: 0xa5552f, cap: 0xe2b98a, capLine: 1.3, mesa: 0.85, glow: 0, height: 0.9 },
  volcano: { foot: 0x4a2a22, slope: 0x3a211e, rock: 0x241517, cap: 0xff5a1a, capLine: 0.9, mesa: 0.2, glow: 1.6, height: 1.25 },
  snow: { foot: 0xd9e6f4, slope: 0xa9bfd8, rock: 0x7389a6, cap: 0xffffff, capLine: 0.38, mesa: 0, glow: 0, height: 1.2 },
};

const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _cv = new THREE.Vector3();

/**
 * The far range: three rings of low-poly mountains, each a little hazier than the one in front.
 *
 * They are too far to be lit by the scene's own lights or dimmed by its fog in any way worth the
 * cost, so both are worked out here, once, and written into the colours: every facet is shaded
 * against the circuit's sun, then washed toward the horizon colour by its distance and by how
 * low it sits. Facing the sun the range is a dark silhouette; with the sun behind you it is lit.
 */
export function buildMountains(ctx: BuildContext): THREE.Mesh {
  const { def, field } = ctx;
  if (def.theme === 'neon') return buildSkyline(ctx);
  const env = def.environment;
  const look = MOUNTAIN_LOOKS[def.theme] ?? MOUNTAIN_LOOKS.grassland;

  const sunDir = new THREE.Vector3(env.sunDirection.x, Math.abs(env.sunDirection.y), env.sunDirection.z).normalize();
  const sunCol = new THREE.Color(env.sunColor).multiplyScalar(Math.min(1.5, env.sunIntensity * 0.42));
  const skyCol = new THREE.Color(env.ambientSky).multiplyScalar(0.55 * Math.max(0.5, env.ambientIntensity));
  const haze = new THREE.Color(env.fogColor).lerp(new THREE.Color(env.skyHorizon), 0.5);
  const foot = color(look.foot);
  const slopeCol = color(look.slope);
  const rock = color(look.rock);
  const cap = color(look.cap);

  const rings = [
    { radius: 600, hMin: 26, hMax: 96, seg: 120, rows: 4, haze: 0.3, seed: 3.1 },
    { radius: 760, hMin: 60, hMax: 190, seg: 110, rows: 5, haze: 0.52, seed: 11.7 },
    { radius: 980, hMin: 90, hMax: 300, seg: 90, rows: 5, haze: 0.74, seed: 27.3 },
  ];
  const verts: number[] = [];
  const cols: number[] = [];
  const albedo = new THREE.Color();
  const lit = new THREE.Color();

  for (const ring of rings) {
    const { seg, rows } = ring;
    const hMax = ring.hMax * look.height;
    const hMin = ring.hMin * look.height;
    // Grid of points: [segment][row], row 0 at the foot (nearer the circuit), the last on the ridge.
    const px = new Float32Array((seg + 1) * (rows + 1));
    const py = new Float32Array((seg + 1) * (rows + 1));
    const pz = new Float32Array((seg + 1) * (rows + 1));
    for (let i = 0; i <= seg; i++) {
      const w = i % seg; // the ring closes on itself
      const a = (w / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Ridged noise: peaks where the fbm crosses its middle, valleys either side.
      const n1 = fbm2(ca * 2.6 + ring.seed, sa * 2.6 + ring.seed * 0.7, 4);
      const ridged = 1 - Math.abs(n1 - 0.5) * 2;
      const n2 = fbm2(ca * 9 + ring.seed * 2, sa * 9, 3);
      let peak = clamp01(ridged * ridged * 0.85 + (n2 - 0.5) * 0.5 + 0.1);
      if (look.mesa > 0) {
        // Mesas: cut the peaks off flat and steepen the walls below the cut.
        const flat = smoothstep(0.25, 0.5, peak) * 0.72 + Math.floor(peak * 3) * 0.06;
        peak = lerp(peak, flat, look.mesa);
      }
      const h = lerp(hMin, hMax, peak);
      for (let k = 0; k <= rows; k++) {
        const t = k / rows;
        // The foot spreads toward the circuit; relief pushes each row in and out so slopes face different ways.
        const relief = (fbm2(ca * 14 + t * 2.3 + ring.seed, sa * 14 - t * 1.7, 2) - 0.5) * 70 * (1 - t * 0.6);
        const spread = (1 - t) * (h * 0.9 + 40);
        const r = ring.radius - spread + relief;
        const profile = look.mesa > 0 ? lerp(Math.pow(t, 0.85), smoothstep(0, 0.75, t), look.mesa) : Math.pow(t, 0.9);
        const o = i * (rows + 1) + k;
        px[o] = field.centerX + ca * r;
        py[o] = lerp(-45, h, profile) + (k > 0 && k < rows ? (fbm2(ca * 20 + k, sa * 20, 2) - 0.5) * h * 0.14 : 0);
        pz[o] = field.centerZ + sa * r;
      }
    }

    const pushTri = (i0: number, i1: number, i2: number, hashSeed: number): void => {
      _a.set(px[i1] - px[i0], py[i1] - py[i0], pz[i1] - pz[i0]);
      _b.set(px[i2] - px[i0], py[i2] - py[i0], pz[i2] - pz[i0]);
      _n.crossVectors(_a, _b).normalize();
      // Facets are seen from inside the ring: turn the normal to face the circuit.
      _cv.set(field.centerX - px[i0], 0, field.centerZ - pz[i0]);
      if (_n.dot(_cv) < 0) _n.negate();
      const cy = (py[i0] + py[i1] + py[i2]) / 3;
      const rel = clamp01(cy / hMax);
      const steep = clamp01((1 - Math.abs(_n.y)) * 1.5);
      albedo.copy(foot).lerp(slopeCol, smoothstep(0.08, 0.4, rel));
      albedo.lerp(rock, smoothstep(0.35, 0.75, rel) * 0.55 + steep * 0.4);
      const capK = smoothstep(look.capLine - 0.1, look.capLine + 0.12, rel + (1 - steep) * 0.08);
      if (look.glow <= 0) albedo.lerp(cap, capK * (0.55 + 0.45 * (1 - steep)));
      // A little difference from facet to facet, so the low-poly cut reads.
      const jitter = 0.93 + 0.14 * (((hashSeed * 2654435761) >>> 0) / 4294967296);
      const ndl = Math.max(0, _n.dot(sunDir));
      lit.copy(albedo).multiplyScalar(jitter);
      lit.r *= sunCol.r * ndl + skyCol.r * (0.6 + 0.4 * _n.y);
      lit.g *= sunCol.g * ndl + skyCol.g * (0.6 + 0.4 * _n.y);
      lit.b *= sunCol.b * ndl + skyCol.b * (0.6 + 0.4 * _n.y);
      if (look.glow > 0) {
        // Lava: the highest ridges glow, brighter than anything the light could make them.
        lit.r += cap.r * capK * look.glow;
        lit.g += cap.g * capK * look.glow;
        lit.b += cap.b * capK * look.glow;
      }
      // Air: more of it in front of far rings and of low ground.
      const air = clamp01(ring.haze + (1 - rel) * 0.3) * (look.glow > 0 ? 1 - capK * 0.7 : 1);
      lit.lerp(haze, air);
      for (const i of [i0, i1, i2]) {
        verts.push(px[i], py[i], pz[i]);
        cols.push(lit.r, lit.g, lit.b);
      }
    };

    for (let i = 0; i < seg; i++) {
      for (let k = 0; k < rows; k++) {
        const a = i * (rows + 1) + k;
        const b = (i + 1) * (rows + 1) + k;
        // Alternate the diagonal so the facets do not all lean one way.
        if ((i + k) % 2 === 0) {
          pushTri(a, b, a + 1, a * 7 + 1);
          pushTri(b, b + 1, a + 1, a * 7 + 3);
        } else {
          pushTri(a, b, b + 1, a * 7 + 1);
          pushTri(a, b + 1, a + 1, a * 7 + 3);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mountains';
  // Behind everything but the sky: the range is past the far plane's worth of fog anyway.
  mesh.renderOrder = -900;
  trackMesh(ctx, mesh);
  return mesh;
}

/** Blocky silhouettes for the neon city: a far skyline with flat tops. */
function buildSkyline(ctx: BuildContext): THREE.Mesh {
  const { def, field } = ctx;
  const theme = def.theme;
  const rings = [
    { radius: 560, hMin: 30, hMax: 95, seg: 96, tint: 0.55 },
    { radius: 700, hMin: 60, hMax: 170, seg: 80, tint: 1 },
  ];
  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const base = color(def.environment.fogColor);
  const peak =
    theme === 'snow'
      ? color(0xffffff)
      : theme === 'desert'
        ? color(0xb06a3f)
        : theme === 'neon'
          ? color(0x1c1230)
          : color(0x5b7d9c);
  const mid = theme === 'snow' ? color(0x9fb8d2) : theme === 'desert' ? color(0xd08b58) : theme === 'neon' ? color(0x0e0818) : color(0x4f7a58);
  const c = new THREE.Color();
  let vbase = 0;
  for (const ring of rings) {
    const seg = ring.seg;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nz = fbm2(Math.cos(a) * 3 + ring.radius * 0.01, Math.sin(a) * 3, 3);
      let h = lerp(ring.hMin, ring.hMax, nz);
      if (theme === 'neon') {
        // skyline: flat-topped blocks
        h = Math.round(h / 12) * 12 + (i % 2 === 0 ? 10 : 0);
      } else {
        h *= 0.8 + 0.4 * fbm2(a * 6.3, ring.radius, 2);
      }
      const r = ring.radius * (0.96 + 0.08 * fbm2(a * 2, 5, 2));
      const x = field.centerX + Math.cos(a) * r;
      const z = field.centerZ + Math.sin(a) * r;
      // bottom
      verts.push(x, -40, z);
      c.copy(base).lerp(mid, 0.3 * ring.tint);
      cols.push(c.r, c.g, c.b);
      // top
      verts.push(x, h, z);
      const snowLine = theme === 'snow' ? 0.35 : theme === 'grassland' ? 0.8 : 1.1;
      const k = clamp01(h / ring.hMax);
      c.copy(mid).lerp(peak, smoothstep(snowLine - 0.3, snowLine + 0.2, k));
      c.lerp(base, 0.25 * (1.2 - ring.tint));
      cols.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < seg; i++) {
      const a = vbase + i * 2;
      const b = a + 1;
      const d = a + 2;
      const e = a + 3;
      // inward facing (camera is inside the ring)
      idx.push(a, d, b, b, d, e);
    }
    vbase += (seg + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mountains';
  trackMesh(ctx, mesh);
  return mesh;
}
