/**
 * Geometry helpers shared by the kart model builder and the per-character body specs.
 * Pure three.js geometry — no character or scene knowledge.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** Collects transformed geometry copies and merges them into one indexed geometry. */
export class Batch {
  private parts: THREE.BufferGeometry[] = [];

  /** Adds a transformed COPY of `geo` (the caller still owns / disposes `geo`). */
  add(
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ): this {
    let g = geo.clone();
    if (!g.index) {
      const indexed = mergeVertices(g);
      g.dispose();
      g = indexed;
    }
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    this.parts.push(g);
    return this;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return merged;
  }
}

export function makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = false;
  m.name = name;
  return m;
}

/** Capsule oriented from a to b (arms, legs, steering column, roll-cage tubes). */
export function limbGeometry(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  radius: number,
  radial = 8,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, len), 2, radial);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  return g;
}

export function addVertexColor(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Chassis from a side profile: `shape` is drawn in (u = forward, v = up) and extruded to
 * `width`; the result is then squeezed per z by `widthScale(z)` (kart space, forward = -z)
 * so a nose or tail can taper. Smooth-shaded, with a blank uv attribute for the material.
 */
export function profileChassis(shape: THREE.Shape, width: number, widthScale: (z: number) => number): THREE.BufferGeometry {
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 5,
  });
  // shape u -> -z (forward), extrusion z -> x (width)
  extruded.rotateY(Math.PI / 2);
  extruded.translate(-width / 2, 0, 0);

  extruded.deleteAttribute('normal');
  extruded.deleteAttribute('uv');
  const geo = mergeVertices(extruded, 1e-3);
  extruded.dispose();

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setX(i, pos.getX(i) * widthScale(z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  return geo;
}
