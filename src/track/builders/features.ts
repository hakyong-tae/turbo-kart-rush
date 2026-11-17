/**
 * What the track gimmicks look like: ramp wedges, painted surface zones, and the moving obstacles.
 *
 * The numbers (where a ramp is, how high the ground is on it, where a boulder is at race time T)
 * come from `track/features.ts` and `Track`; this file only draws them. A gimmick a player cannot
 * read from a distance is a trap, so every one of these is loud: chevrons up the ramp, a colour
 * that is not road on the road, rails and a blinking lamp where something crosses.
 */
import * as THREE from 'three';
import type { BuildContext } from './context';
import { track, trackMesh } from './context';
import { crosserCountdown, rampProfile, ROLLER_FADE, type MoverSlot, type RampInfo, type ZoneInfo } from '../features';

const _v = new THREE.Vector3();

/** Yellow-on-dark chevrons pointing up the ramp (v runs along the travel direction). */
function makeChevronTexture(fg: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 22;
    ctx.lineJoin = 'miter';
    for (let k = -1; k < 3; k++) {
      const y = k * 64 + 20;
      ctx.beginPath();
      ctx.moveTo(-10, y + 44);
      ctx.lineTo(64, y);
      ctx.lineTo(138, y + 44);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Index of the LUT sample at arc length s. */
function lutIndex(ctx: BuildContext, s: number): number {
  const n = ctx.cl.n;
  return ((Math.round((s / ctx.cl.length) * n) % n) + n) % n;
}

/**
 * A ribbon lying on the road between arc lengths s0..s1 and lateral lo..hi, lifted by `lift(u)`
 * (u = 0..1 along it). Returns positions / uvs / indices for the top face only.
 */
function ribbon(
  ctx: BuildContext,
  s0: number,
  s1: number,
  lateral: (i: number) => [number, number],
  lift: (u: number) => number,
  vPerMetre: number,
): { pos: number[]; uv: number[]; idx: number[]; rows: number } {
  const { cl } = ctx;
  const step = cl.length / cl.n;
  const rows = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1);
    const s = s0 + (s1 - s0) * u;
    const i = lutIndex(ctx, s);
    const [lo, hi] = lateral(i);
    const y = cl.py[i] + lift(u);
    pos.push(cl.px[i] + cl.bx[i] * lo, y, cl.pz[i] + cl.bz[i] * lo, cl.px[i] + cl.bx[i] * hi, y, cl.pz[i] + cl.bz[i] * hi);
    const v = (s - s0) * vPerMetre;
    uv.push(0, v, 1, v);
    if (r > 0) {
      const a = (r - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return { pos, uv, idx, rows };
}

function meshFrom(pos: number[], uv: number[] | null, idx: number[], mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

// ------------------------------------------------------------------------------------ ramps

function buildRamp(ctx: BuildContext, r: RampInfo, group: THREE.Group, topMat: THREE.Material, sideMat: THREE.Material): void {
  const { cl } = ctx;
  const lat = (i: number): [number, number] => {
    const half = Math.min(r.halfWidth, cl.whw[i] - 0.25);
    return [r.lateral - half, r.lateral + half];
  };
  const top = ribbon(ctx, r.s0, r.s1, lat, (u) => r.height * rampProfile(u) + 0.02, 1 / 4);
  const topMesh = meshFrom(top.pos, top.uv, top.idx, topMat);
  topMesh.receiveShadow = true;
  topMesh.castShadow = true;
  trackMesh(ctx, topMesh);
  group.add(topMesh);

  // Skirts: both sides down to the road, and the face under the lip.
  const pos: number[] = [];
  const idx: number[] = [];
  const base = ribbon(ctx, r.s0, r.s1, lat, () => 0, 1);
  for (let side = 0; side < 2; side++) {
    const start = pos.length / 3;
    for (let row = 0; row < top.rows; row++) {
      const o = (row * 2 + side) * 3;
      pos.push(top.pos[o], top.pos[o + 1], top.pos[o + 2], base.pos[o], base.pos[o + 1], base.pos[o + 2]);
      if (row > 0) {
        const a = start + (row - 1) * 2;
        if (side === 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const last = (top.rows - 1) * 6;
  const b = pos.length / 3;
  pos.push(
    top.pos[last], top.pos[last + 1], top.pos[last + 2],
    top.pos[last + 3], top.pos[last + 4], top.pos[last + 5],
    base.pos[last], base.pos[last + 1], base.pos[last + 2],
    base.pos[last + 3], base.pos[last + 4], base.pos[last + 5],
  );
  idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  const skirt = meshFrom(pos, null, idx, sideMat);
  skirt.castShadow = true;
  ctx.disposables.push(skirt.geometry);
  group.add(skirt);
}

// ------------------------------------------------------------------------------------ zones

const ZONE_LOOK: Record<string, { color: number; roughness: number; metalness: number; opacity: number; emissive?: number }> = {
  ice: { color: 0xc8eeff, roughness: 0.06, metalness: 0.25, opacity: 0.9 },
  mud: { color: 0x5b4127, roughness: 0.95, metalness: 0, opacity: 1 },
  water: { color: 0x3aa6de, roughness: 0.08, metalness: 0.1, opacity: 0.72 },
  sand: { color: 0xdcc48f, roughness: 1, metalness: 0, opacity: 1 },
  ash: { color: 0x4d484a, roughness: 1, metalness: 0, opacity: 1 },
  boost: { color: 0xff8a1e, roughness: 0.5, metalness: 0, opacity: 1, emissive: 0xff7a10 },
};

function buildZone(ctx: BuildContext, z: ZoneInfo, group: THREE.Group, boostTex: () => THREE.Texture): void {
  const { cl } = ctx;
  const look = ZONE_LOOK[z.look] ?? ZONE_LOOK[z.kind];
  const lat = (i: number): [number, number] => {
    const hw = cl.hw[i] - 0.15;
    return [Math.max(-hw, z.latMin), Math.min(hw, z.latMax)];
  };
  const strip = ribbon(ctx, z.s0, z.s1, lat, () => 0.03, 1 / 5);
  const mat = new THREE.MeshStandardMaterial({
    color: look.color,
    roughness: look.roughness,
    metalness: look.metalness,
    transparent: look.opacity < 1,
    opacity: look.opacity,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (z.kind === 'boost') {
    const tex = boostTex();
    mat.map = tex;
    mat.emissive = new THREE.Color(look.emissive ?? 0xffffff);
    mat.emissiveMap = tex;
    mat.emissiveIntensity = 0.9;
  }
  const mesh = meshFrom(strip.pos, strip.uv, strip.idx, mat);
  mesh.receiveShadow = true;
  trackMesh(ctx, mesh);
  group.add(mesh);
}

// ------------------------------------------------------------------------------------ movers

const ROLLER_LOOK: Record<string, { color: number; roughness: number; emissive?: number; flat: boolean; detail: number }> = {
  boulder: { color: 0x8c7b66, roughness: 0.95, flat: true, detail: 1 },
  snowball: { color: 0xf3f8ff, roughness: 0.7, flat: false, detail: 2 },
  lava: { color: 0x2c1a14, roughness: 0.9, emissive: 0xff5a14, flat: true, detail: 1 },
};

function buildMovers(ctx: BuildContext, group: THREE.Group): void {
  const slots = ctx.movers;
  if (slots.length === 0) return;
  const { cl, def } = ctx;
  const meshes: { slot: MoverSlot; node: THREE.Object3D; spin: number; lastS: number }[] = [];

  for (const slot of slots) {
    let node: THREE.Object3D;
    if (slot.def.kind === 'roller') {
      const look = ROLLER_LOOK[slot.def.look ?? 'boulder'];
      const geo = new THREE.IcosahedronGeometry(slot.radius, look.detail);
      const mat = new THREE.MeshStandardMaterial({
        color: look.color,
        roughness: look.roughness,
        flatShading: look.flat,
        emissive: new THREE.Color(look.emissive ?? 0x000000),
        emissiveIntensity: look.emissive ? 0.55 : 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      trackMesh(ctx, mesh);
      node = mesh;
    } else {
      // A tram car (or a mine cart): body, a lit window band, a roof.
      const r = slot.radius;
      const car = new THREE.Group();
      const tram = (slot.def.look ?? 'tram') === 'tram';
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(r * 2.05, tram ? 2.1 : 1.3, r * 1.7),
        new THREE.MeshStandardMaterial({ color: tram ? def.palette.curb : 0x6b4a2e, roughness: 0.6, metalness: tram ? 0.2 : 0 }),
      );
      body.position.y = tram ? 1.35 : 0.95;
      body.castShadow = true;
      trackMesh(ctx, body);
      car.add(body);
      if (tram) {
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(r * 2.08, 0.6, r * 1.74),
          new THREE.MeshStandardMaterial({ color: 0x1a1e2a, emissive: new THREE.Color(0xffe9a8), emissiveIntensity: 0.9, roughness: 0.3 }),
        );
        win.position.y = 1.7;
        trackMesh(ctx, win);
        car.add(win);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(r * 2.1, 0.14, r * 1.8),
          new THREE.MeshStandardMaterial({ color: def.palette.wall, roughness: 0.7 }),
        );
        roof.position.y = 2.47;
        trackMesh(ctx, roof);
        car.add(roof);
      }
      const bogie = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.6, 0.3, r * 1.3),
        new THREE.MeshStandardMaterial({ color: 0x18191d, roughness: 0.8 }),
      );
      bogie.position.y = 0.2;
      trackMesh(ctx, bogie);
      car.add(bogie);
      node = car;
    }
    node.visible = false;
    group.add(node);
    meshes.push({ slot, node, spin: 0, lastS: 0 });
  }

  // Crossings: two rails across the road and a lamp post each side that blinks before a tram.
  const lamps: { mat: THREE.MeshStandardMaterial; slot: MoverSlot }[] = [];
  const seen = new Set<unknown>();
  for (const slot of slots) {
    if (slot.def.kind !== 'crosser' || seen.has(slot.def)) continue;
    seen.add(slot.def);
    const i = lutIndex(ctx, slot.sFrom);
    const heading = Math.atan2(cl.bx[i], cl.bz[i]);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.5, metalness: 0.6 });
    track(ctx, railMat);
    for (const off of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, slot.reach * 2), railMat);
      rail.position.set(cl.px[i] + cl.tx[i] * off, cl.py[i] + 0.035, cl.pz[i] + cl.tz[i] * off);
      rail.rotation.y = heading;
      ctx.disposables.push(rail.geometry);
      group.add(rail);
    }
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a0d0a, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 0 });
    track(ctx, lampMat);
    lamps.push({ mat: lampMat, slot });
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });
    track(ctx, postMat);
    for (const side of [-1, 1]) {
      const edge = cl.hw[i] + 0.9;
      // Posts stand before the crossing on both sides, facing the oncoming traffic.
      const x = cl.px[i] + cl.bx[i] * edge * side - cl.tx[i] * 4;
      const z = cl.pz[i] + cl.bz[i] * edge * side - cl.tz[i] * 4;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 8), postMat);
      post.position.set(x, cl.py[i] + 1.5, z);
      ctx.disposables.push(post.geometry);
      group.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), lampMat);
      lamp.position.set(x, cl.py[i] + 3.1, z);
      ctx.disposables.push(lamp.geometry);
      group.add(lamp);
    }
  }

  ctx.updaters.push((_dt, elapsed) => {
    for (let k = 0; k < meshes.length; k++) {
      const m = meshes[k];
      const pose = m.slot.pose;
      const o = m.slot.obstacle;
      if (m.slot.def.kind === 'roller') {
        // Shown through the fade zones too (shrinking), so it never pops in at full size.
        const span = Math.abs(m.slot.sTo - m.slot.sFrom);
        let travelled = Math.abs(pose.s - m.slot.sFrom);
        if (travelled > cl.length / 2) travelled = cl.length - travelled;
        const fade = Math.min(1, travelled / ROLLER_FADE, (span - travelled) / ROLLER_FADE);
        const i = lutIndex(ctx, pose.s);
        const scale = Math.max(0.001, fade);
        m.node.visible = scale > 0.02;
        m.node.position.set(cl.px[i] + cl.bx[i] * pose.lateral, cl.py[i] + m.slot.radius * scale, cl.pz[i] + cl.bz[i] * pose.lateral);
        m.node.scale.setScalar(scale);
        // Roll: turn about the axis across the direction of travel by distance / radius.
        let ds = pose.s - m.lastS;
        if (ds > cl.length / 2) ds -= cl.length;
        else if (ds < -cl.length / 2) ds += cl.length;
        m.lastS = pose.s;
        if (Math.abs(ds) < 5) m.spin += ds / m.slot.radius;
        _v.set(cl.bx[i], 0, cl.bz[i]);
        m.node.quaternion.setFromAxisAngle(_v, m.spin);
      } else {
        m.node.visible = pose.active;
        if (!pose.active) continue;
        const i = lutIndex(ctx, pose.s);
        m.node.position.set(o.position.x, cl.py[i], o.position.z);
        m.node.rotation.y = Math.atan2(cl.bx[i], cl.bz[i]) + Math.PI / 2;
      }
    }
    for (let k = 0; k < lamps.length; k++) {
      const l = lamps[k];
      if (l.slot.def.kind !== 'crosser') continue;
      const due = l.slot.pose.active || crosserCountdown(l.slot.def, l.slot.raceTime, l.slot.reach) < 2.5;
      l.mat.emissiveIntensity = due && Math.floor(elapsed * 4) % 2 === 0 ? 2.4 : 0;
    }
  });
}

/** Everything the gimmicks draw, or null for a track that has none. */
export function buildFeatures(ctx: BuildContext): THREE.Group | null {
  const f = ctx.features;
  if (f.empty) return null;
  const group = new THREE.Group();
  group.name = 'features';

  if (f.ramps.length > 0) {
    const tex = track(ctx, makeChevronTexture('#ffd400', '#22242a'));
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.05 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.85, side: THREE.DoubleSide });
    track(ctx, sideMat);
    for (const r of f.ramps) buildRamp(ctx, r, group, topMat, sideMat);
  }

  let boostTex: THREE.CanvasTexture | null = null;
  for (const z of f.zones) {
    buildZone(ctx, z, group, () => {
      if (!boostTex) {
        boostTex = track(ctx, makeChevronTexture('#fff3c4', '#ff7a10'));
        const scrolling = boostTex;
        ctx.updaters.push((_dt, elapsed) => {
          scrolling.offset.y = -elapsed * 1.6;
        });
      }
      return boostTex;
    });
  }

  buildMovers(ctx, group);
  return group;
}
