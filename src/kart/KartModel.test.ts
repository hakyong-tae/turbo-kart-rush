// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KART_BODIES } from './bodies';
import { buildKartModel } from './KartModel';
import { CHARACTERS } from './roster';

/** Cheap fingerprint of a geometry's vertex positions. */
function fingerprint(geo: THREE.BufferGeometry): string {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let h = pos.count;
  for (let i = 0; i < pos.count; i += 7) {
    h = (h * 31 + Math.round(pos.getX(i) * 1000) + Math.round(pos.getY(i) * 1000) * 7 + Math.round(pos.getZ(i) * 1000) * 13) | 0;
  }
  return `${pos.count}:${h}`;
}

describe('kart bodies', () => {
  it('every character has its own body spec', () => {
    for (const c of CHARACTERS) expect(KART_BODIES[c.id], c.id).toBeDefined();
  });

  it('builds all eight karts with the handles Kart.ts animates', () => {
    for (const c of CHARACTERS) {
      const p = buildKartModel(c);
      expect(p.wheels, c.id).toHaveLength(4);
      expect(p.frontWheels, c.id).toHaveLength(2);
      expect(p.wheelRadii, c.id).toHaveLength(4);
      expect(p.exhausts.length, c.id).toBeGreaterThanOrEqual(1);
      expect(p.steeringWheel, c.id).toBeInstanceOf(THREE.Object3D);
      expect(p.driverHead, c.id).toBeInstanceOf(THREE.Object3D);
      expect(p.body.geometry.attributes.position.count, c.id).toBeGreaterThan(40);
      // Wheels rest on the ground whatever their visual size.
      p.wheels.forEach((w, i) => expect(w.parent!.position.y, `${c.id} wheel ${i}`).toBeCloseTo(p.wheelRadii[i], 6));
      let meshes = 0;
      p.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes, `${c.id} draw calls`).toBeLessThanOrEqual(44); // neon ring + afterburner cone + halo per exhaust (Juno has 4 pipes)
      p.dispose();
    }
  });

  it('gives the eight racers pairwise different chassis geometry', () => {
    const prints = new Map<string, string>();
    for (const c of CHARACTERS) {
      const p = buildKartModel(c);
      prints.set(c.id, fingerprint(p.body.geometry));
      p.dispose();
    }
    const values = [...prints.values()];
    expect(new Set(values).size).toBe(values.length);
  });

  it('scales wheel radii with the body spec', () => {
    const rosa = buildKartModel(CHARACTERS.find((c) => c.id === 'rosa')!);
    const max = buildKartModel(CHARACTERS.find((c) => c.id === 'max')!);
    expect(rosa.wheelRadii[2]).toBeGreaterThan(max.wheelRadii[2] * 1.3);
    expect(rosa.wheelRadii[0]).toBeCloseTo(max.wheelRadii[0], 6);
    // Rosa's stacks point up: the pipe group is pitched -90°.
    expect(rosa.exhausts[0].rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    rosa.dispose();
    max.dispose();
  });
});
