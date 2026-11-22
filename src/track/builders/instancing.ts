import * as THREE from 'three';
import type { BuildContext } from './context';

/** One instance to be placed: where along the lap it sits, its transform and (optionally) its tint. */
export interface InstanceSpec {
  /** Arc-length position in metres (any value; only used to group neighbours). */
  s: number;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

export interface ChunkOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Length of track one mesh covers. Shorter = finer culling, more draw calls. */
  sectionLength?: number;
}

/**
 * Places instances as several instanced meshes, one per stretch of track, instead of one for the
 * whole lap.
 *
 * three culls an instanced mesh as a whole. A barrier that runs all the way round the circuit is
 * therefore never culled: every tyre of every stack goes through the vertex shader every frame,
 * and again for the shadow map, though the camera sees a fifth of them. Cut into stretches, the
 * ones behind the camera and across the infield are skipped.
 */
export function addChunkedInstances(
  ctx: BuildContext,
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  specs: readonly InstanceSpec[],
  name: string,
  options: ChunkOptions = {},
): THREE.InstancedMesh[] {
  const sectionLength = options.sectionLength ?? 70;
  const sections = Math.max(1, Math.round(ctx.cl.length / sectionLength));
  const buckets: InstanceSpec[][] = Array.from({ length: sections }, () => []);
  for (const spec of specs) {
    const k = Math.floor((((spec.s / ctx.cl.length) % 1) + 1) % 1 * sections);
    buckets[Math.min(sections - 1, k)].push(spec);
  }
  ctx.disposables.push(geo, mat);
  const meshes: THREE.InstancedMesh[] = [];
  for (let b = 0; b < buckets.length; b++) {
    const bucket = buckets[b];
    if (bucket.length === 0) continue;
    const mesh = new THREE.InstancedMesh(geo, mat, bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      mesh.setMatrixAt(i, bucket[i].matrix);
      const c = bucket[i].color;
      if (c) mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.name = `${name}:${b}`;
    // The sphere three culls against: without it the mesh is tested with the geometry's own
    // (one instance at the origin) and vanishes.
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
