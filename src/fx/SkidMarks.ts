/**
 * Skid marks: the two dark lines a drifting kart leaves on the road.
 *
 * One mesh for all karts: a ring buffer of quads, each written once when a wheel has travelled a
 * little further and never touched again. A mark fades by its age, worked out in the vertex
 * shader from the time it was laid, so a frame costs one uniform however many marks there are.
 */
import * as THREE from 'three';
import type { IKart } from '../core/types';

/** Quads in the buffer. At a quad every 0.3 m this is about a kilometre of rubber. */
const CAPACITY = 3600;
/** Seconds a mark stays, the last third of it fading. */
const LIFE = 9;
const WIDTH = 0.15;
const SEGMENT = 0.3;
/** Rear wheel positions in the kart's own frame (x right, z back). */
const WHEEL_X = 0.52;
const WHEEL_Z = 0.5;

const VERTEX = /* glsl */ `
uniform float uTime;
attribute vec2 aMark; // time laid, strength
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aMark.x;
  float keep = age < 0.0 ? 0.0 : 1.0 - smoothstep(${(LIFE * 0.65).toFixed(2)}, ${LIFE.toFixed(2)}, age);
  vAlpha = aMark.y * keep;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  if (vAlpha <= 0.004) discard;
  gl_FragColor = vec4(uColor, vAlpha);
  #include <fog_fragment>
}
`;

interface WheelTrack {
  active: boolean;
  /** The last edge laid: left and right corners. */
  lx: number; ly: number; lz: number;
  rx: number; ry: number; rz: number;
  /** Where the wheel was when that edge was laid. */
  cx: number; cz: number;
}

const _q = new THREE.Quaternion();
const _w = new THREE.Vector3();
const _side = new THREE.Vector3();

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions = new Float32Array(CAPACITY * 6 * 3);
  private readonly marks = new Float32Array(CAPACITY * 6 * 2);
  private readonly posAttr: THREE.BufferAttribute;
  private readonly markAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly wheels = new Map<number, [WheelTrack, WheelTrack]>();
  private head = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.markAttr = new THREE.BufferAttribute(this.marks, 2);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.markAttr.setUsage(THREE.DynamicDrawUsage);
    // Every mark starts out long expired.
    for (let i = 0; i < CAPACITY * 6; i++) this.marks[i * 2] = -1e6;
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aMark', this.markAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x060607) } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'SkidMarks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0.5;
    this.mesh.matrixAutoUpdate = false;
  }

  update(karts: readonly IKart[], now: number): void {
    this.material.uniforms.uTime.value = now;
    for (let i = 0; i < karts.length; i++) {
      const st = karts[i].state;
      let pair = this.wheels.get(st.id);
      if (!pair) {
        pair = [newWheel(), newWheel()];
        this.wheels.set(st.id, pair);
      }
      // Rubber is laid by a sliding tyre on something hard: a drift, or a spin, on the road.
      const sliding = (st.isDrifting || st.isSpinning) && !st.isAirborne && Math.abs(st.speed) > 4;
      const hard = st.surface === 'road' || st.surface === 'boost';
      if (!sliding || !hard) {
        pair[0].active = false;
        pair[1].active = false;
        continue;
      }
      _q.copy(st.quaternion);
      const strength = st.isSpinning ? 0.5 : 0.34 + 0.12 * Math.min(3, st.driftStage);
      for (let w = 0; w < 2; w++) {
        const sx = w === 0 ? -WHEEL_X : WHEEL_X;
        _w.set(sx, 0.02, WHEEL_Z).applyQuaternion(_q).add(st.position);
        const tr = pair[w];
        if (!tr.active) {
          this.startEdge(tr, _w, st);
          continue;
        }
        const dx = _w.x - tr.cx;
        const dz = _w.z - tr.cz;
        const d = Math.hypot(dx, dz);
        if (d < SEGMENT) continue;
        if (d > 3) {
          // A teleport (respawn, a network correction): do not draw a line across the map.
          this.startEdge(tr, _w, st);
          continue;
        }
        // The new edge lies across the wheel's direction of travel.
        _side.set(-dz / d, 0, dx / d).multiplyScalar(WIDTH * 0.5);
        const nlx = _w.x - _side.x, nlz = _w.z - _side.z;
        const nrx = _w.x + _side.x, nrz = _w.z + _side.z;
        this.pushQuad(tr.lx, tr.ly, tr.lz, tr.rx, tr.ry, tr.rz, nlx, _w.y, nlz, nrx, _w.y, nrz, now, strength);
        tr.lx = nlx; tr.ly = _w.y; tr.lz = nlz;
        tr.rx = nrx; tr.ry = _w.y; tr.rz = nrz;
        tr.cx = _w.x; tr.cz = _w.z;
      }
    }
    this.flush();
  }

  private startEdge(tr: WheelTrack, at: THREE.Vector3, st: IKart['state']): void {
    // Across the kart's heading until the wheel has moved far enough to give a direction.
    const h = st.heading;
    const sx = Math.cos(h) * WIDTH * 0.5;
    const sz = -Math.sin(h) * WIDTH * 0.5;
    tr.active = true;
    tr.lx = at.x - sx; tr.ly = at.y; tr.lz = at.z - sz;
    tr.rx = at.x + sx; tr.ry = at.y; tr.rz = at.z + sz;
    tr.cx = at.x; tr.cz = at.z;
  }

  private pushQuad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    now: number, strength: number,
  ): void {
    const q = this.head;
    const p = this.positions;
    const o = q * 18;
    // a, b = old left/right; c, d = new left/right. Two triangles: a b d, a d c.
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = dx; p[o + 7] = dy; p[o + 8] = dz;
    p[o + 9] = ax; p[o + 10] = ay; p[o + 11] = az;
    p[o + 12] = dx; p[o + 13] = dy; p[o + 14] = dz;
    p[o + 15] = cx; p[o + 16] = cy; p[o + 17] = cz;
    const m = this.marks;
    const mo = q * 12;
    for (let v = 0; v < 6; v++) {
      m[mo + v * 2] = now;
      m[mo + v * 2 + 1] = strength;
    }
    if (this.dirtyFrom < 0) this.dirtyFrom = q;
    this.dirtyTo = q;
    this.head = q + 1;
    if (this.head >= CAPACITY) {
      this.head = 0;
      this.wrapped = true;
    }
  }

  /** Sends what was written this frame to the GPU: one range, or everything if the ring wrapped. */
  private flush(): void {
    if (this.dirtyFrom < 0) return;
    if (this.wrapped || this.dirtyTo < this.dirtyFrom) {
      this.posAttr.clearUpdateRanges();
      this.markAttr.clearUpdateRanges();
    } else {
      const count = this.dirtyTo - this.dirtyFrom + 1;
      this.posAttr.clearUpdateRanges();
      this.markAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(this.dirtyFrom * 18, count * 18);
      this.markAttr.addUpdateRange(this.dirtyFrom * 12, count * 12);
    }
    this.posAttr.needsUpdate = true;
    this.markAttr.needsUpdate = true;
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  /** Forget every mark (a new race). */
  clear(): void {
    for (let i = 0; i < CAPACITY * 6; i++) this.marks[i * 2] = -1e6;
    this.markAttr.clearUpdateRanges();
    this.markAttr.needsUpdate = true;
    this.wheels.clear();
    this.head = 0;
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
    this.wrapped = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
    this.wheels.clear();
  }
}

function newWheel(): WheelTrack {
  return { active: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, cx: 0, cz: 0 };
}
