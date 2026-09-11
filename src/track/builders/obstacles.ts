/**
 * Fixed obstacles standing on the road.
 *
 * Unlike a banana or a bomb these belong to the circuit: the same pylon is in the same place on
 * every lap and on every client, so they need no networking and the racing line has to be learned
 * around them. They exist so a track can be made hard by its layout rather than by narrowing the
 * road until nobody can pass.
 *
 * A pylon is a tapered prism with a lit band, tall enough to read from a long way back — an
 * obstacle a player only sees at the last moment is a trap, not a corner.
 */
import * as THREE from 'three';
import type { TrackObstacle } from '../../core/types';
import type { BuildContext } from './context';
import { track, trackMesh } from './context';

/** Default footprint: wide enough to matter beside a 1.6 m kart, narrow enough to squeeze past. */
const DEFAULT_RADIUS = 1.5;
const HEIGHT = 3.2;

/** Resolves each definition entry to world space. Called before the geometry so physics can use it. */
export function computeObstacles(ctx: BuildContext): TrackObstacle[] {
  const out: TrackObstacle[] = [];
  for (const o of ctx.def.obstacles ?? []) {
    const i = Math.min(ctx.cl.px.length - 1, Math.max(0, Math.round(((o.t % 1) + 1) % 1 * ctx.cl.px.length)));
    const x = ctx.cl.px[i] + ctx.cl.bx[i] * o.lateral;
    const z = ctx.cl.pz[i] + ctx.cl.bz[i] * o.lateral;
    out.push({
      position: new THREE.Vector3(x, ctx.cl.py[i], z),
      radius: o.radius ?? DEFAULT_RADIUS,
      height: HEIGHT,
    });
  }
  return out;
}

/** One merged mesh for the pylon bodies plus one instanced mesh for their lit bands. */
export function buildObstacles(ctx: BuildContext, obstacles: readonly TrackObstacle[]): THREE.Group | null {
  if (obstacles.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'obstacles';
  const isNight = ctx.def.theme === 'neon';
  const accent = new THREE.Color(ctx.def.palette.curb);

  const geos: THREE.BufferGeometry[] = [];
  for (const o of obstacles) {
    // Tapered so it reads as something placed on the road rather than grown out of it.
    const body = new THREE.CylinderGeometry(o.radius * 0.42, o.radius * 0.92, o.height, 6);
    body.translate(o.position.x, o.position.y + o.height / 2, o.position.z);
    geos.push(body);
    const foot = new THREE.CylinderGeometry(o.radius * 1.12, o.radius * 1.12, 0.12, 12);
    foot.translate(o.position.x, o.position.y + 0.06, o.position.z);
    geos.push(foot);
  }
  const merged = mergeAll(geos);
  const mat = new THREE.MeshStandardMaterial({
    color: ctx.def.palette.wall,
    roughness: 0.55,
    metalness: 0.1,
  });
  ctx.disposables.push(mat);
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'obstaclePylons';
  trackMesh(ctx, mesh);
  group.add(mesh);

  // Lit band near the top: the part that catches the eye at racing speed.
  {
    const bandGeo = new THREE.CylinderGeometry(1, 1, 0.42, 6);
    const bandMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: isNight ? 1.9 : 0.75,
      roughness: 0.4,
    });
    ctx.disposables.push(bandGeo, bandMat);
    const bands = new THREE.InstancedMesh(bandGeo, bandMat, obstacles.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const r = o.radius * 0.72;
      p.set(o.position.x, o.position.y + o.height * 0.78, o.position.z);
      sc.set(r, 1, r);
      m.compose(p, q, sc);
      bands.setMatrixAt(i, m);
    }
    bands.instanceMatrix.needsUpdate = true;
    bands.name = 'obstacleBands';
    trackMesh(ctx, bands);
    group.add(bands);
  }
  void track;
  return group;
}

/** Local merge so this builder does not depend on the road builder's private helper. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  let indexTotal = 0;
  for (const g of geos) {
    total += g.attributes.position.count;
    indexTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const idx = new Uint32Array(indexTotal);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const gp = g.attributes.position.array as ArrayLike<number>;
    const gn = g.attributes.normal.array as ArrayLike<number>;
    const n = g.attributes.position.count;
    for (let i = 0; i < n * 3; i++) {
      pos[vo * 3 + i] = gp[i];
      nor[vo * 3 + i] = gn[i];
    }
    if (g.index) {
      const gi = g.index.array as ArrayLike<number>;
      for (let i = 0; i < g.index.count; i++) idx[io + i] = gi[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = i + vo;
      io += n;
    }
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
