/**
 * Minimal ITrack for node tests: a flat circular loop (radius R, road half width 8) so the
 * real Kart physics can run without WebGL / CanvasTexture. Not used by the game build.
 */
import * as THREE from 'three';
import { CHECKPOINT_COUNT, KART_COUNT } from '../core/constants';
import type { Checkpoint, ITrack, MinimapData, StartSlot, SurfaceQuery, TrackDefinition, TrackSample } from '../core/types';
import { sunnyCircuit } from '../track/tracks/sunnyCircuit';

const TAU = Math.PI * 2;

export class FakeTrack implements ITrack {
  readonly def: TrackDefinition = sunnyCircuit;
  readonly object = new THREE.Group();
  readonly length: number;
  readonly checkpoints: Checkpoint[] = [];
  readonly startGrid: StartSlot[] = [];
  readonly itemBoxPositions: THREE.Vector3[] = [];
  readonly boostPads: { position: THREE.Vector3; forward: THREE.Vector3; halfWidth: number }[] = [];
  readonly minimap: MinimapData;

  constructor(
    private readonly radius = 80,
    private readonly halfWidth = 8,
  ) {
    this.length = TAU * radius;
    for (let i = 0; i < CHECKPOINT_COUNT; i++) {
      const t = i / CHECKPOINT_COUNT;
      const s = this.sample(t);
      this.checkpoints.push({
        index: i,
        t,
        position: s.position.clone(),
        forward: s.tangent.clone(),
        halfWidth: this.halfWidth,
        isFinishLine: i === 0,
      });
    }
    // Grid: pairs staggered behind the line (t slightly negative → wraps to just below 1).
    for (let i = 0; i < KART_COUNT; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const t = ((-(6 + row * 4) / this.length) % 1 + 1) % 1;
      const s = this.sample(t);
      const pos = s.position.clone().addScaledVector(s.binormal, side * 2.2);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-s.tangent.x, -s.tangent.z), 0));
      this.startGrid.push({ position: pos, quaternion: q, t });
    }
    // One row of five item boxes at t = 0.25 (mirrors computeItemBoxPositions' row layout).
    const row = this.sample(0.25);
    for (let i = 0; i < 5; i++) {
      const lat = (i - 2) * (this.halfWidth * 0.8) / 2;
      this.itemBoxPositions.push(row.position.clone().addScaledVector(row.binormal, lat));
    }
    this.minimap = {
      points: [],
      leftEdge: [],
      rightEdge: [],
      worldToMap: (x, z) => ({ x: 0.5 + x / (4 * radius), y: 0.5 + z / (4 * radius) }),
    };
  }

  sample(t: number, out?: TrackSample): TrackSample {
    const a = ((t % 1) + 1) % 1 * TAU;
    // Drive counter-clockwise viewed from above: position on circle, tangent = derivative.
    const px = this.radius * Math.sin(a);
    const pz = -this.radius * Math.cos(a);
    const tx = Math.cos(a);
    const tz = Math.sin(a);
    const s: TrackSample = out ?? {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      binormal: new THREE.Vector3(),
      halfWidth: this.halfWidth,
      wallHalfWidth: this.halfWidth * 1.5,
      t,
    };
    s.position.set(px, 0, pz);
    s.tangent.set(tx, 0, tz).normalize();
    s.normal.set(0, 1, 0);
    s.binormal.crossVectors(s.tangent, s.normal).normalize();
    s.halfWidth = this.halfWidth;
    s.wallHalfWidth = this.halfWidth * 1.5;
    s.t = ((t % 1) + 1) % 1;
    return s;
  }

  closestT(position: THREE.Vector3): number {
    const a = Math.atan2(position.x, -position.z);
    return ((a / TAU) % 1 + 1) % 1;
  }

  query(position: THREE.Vector3, _hintT?: number, out?: SurfaceQuery): SurfaceQuery {
    const t = this.closestT(position);
    const s = this.sample(t);
    const r = Math.hypot(position.x, position.z);
    const lateral = r - this.radius; // + = outside = right of travel? binormal = tangent × up
    const signed = s.binormal.x * (position.x - s.position.x) + s.binormal.z * (position.z - s.position.z);
    const abs = Math.abs(signed);
    const q: SurfaceQuery = out ?? {
      t,
      surface: 'road',
      groundY: 0,
      groundNormal: new THREE.Vector3(0, 1, 0),
      lateral: signed,
      halfWidth: this.halfWidth,
      wallHalfWidth: this.halfWidth * 1.5,
      tangent: new THREE.Vector3(),
      binormal: new THREE.Vector3(),
      center: new THREE.Vector3(),
    };
    q.t = t;
    q.surface = abs <= this.halfWidth ? 'road' : abs <= this.halfWidth * 1.5 ? 'offroad' : 'wall';
    q.groundY = 0;
    q.groundNormal.set(0, 1, 0);
    q.lateral = signed;
    q.halfWidth = this.halfWidth;
    q.wallHalfWidth = this.halfWidth * 1.5;
    q.tangent.copy(s.tangent);
    q.binormal.copy(s.binormal);
    q.center.copy(s.position);
    void lateral;
    return q;
  }

  heightAt(): number {
    return 0;
  }

  update(): void {
    /* static */
  }

  dispose(): void {
    /* nothing allocated on the GPU */
  }
}
