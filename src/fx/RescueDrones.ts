/**
 * Rescue drones: the machine that fishes a kart out of the void and carries it back.
 *
 * Purely visual. `RaceManager` owns the rescue itself — it freezes the kart and flies it along
 * the path — and announces it with `kart:rescueStart` / `kart:rescueEnd`. A drone then simply
 * hovers over that kart for as long as the rescue lasts, which means the two can never disagree
 * about where the kart is, and a client watching a remote kart gets the same show for free.
 *
 * Procedural like everything else here: a body, four rotors, a cable and an electromagnet, built
 * from shared geometry. Drones are pooled — eight karts can fall at once, but almost never do —
 * and a leaving drone shrinks rather than fades, so instances can keep sharing one set of
 * materials instead of cloning them per drone.
 */
import * as THREE from 'three';
import { events } from '../core/events';
import type { IKart } from '../core/types';

/** How high the drone hovers above the kart it is carrying. */
const HOVER = 3.2;
/** Magnet height above the kart; the cable spans the gap up to the body. */
const MAGNET_GAP = 1.1;
const ARRIVE_SECONDS = 0.42;
const LEAVE_SECONDS = 0.5;
/** Extra altitude the drone drops in from, and climbs away to. */
const APPROACH_RISE = 13;
const ROTOR_SPEED = 34;

interface Drone {
  group: THREE.Group;
  rotors: THREE.Mesh[];
  kartId: number;
  /** 0 → 1 while arriving, 1 while carrying, 1 → 0 while leaving. */
  presence: number;
  leaving: boolean;
}

export class RescueDrones {
  readonly object: THREE.Group;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly template: THREE.Group;
  private readonly active: Drone[] = [];
  private readonly pool: Drone[] = [];
  private readonly unsubs: (() => void)[] = [];
  private spin = 0;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'RescueDrones';
    this.template = this.buildTemplate();
    this.unsubs.push(
      events.on('kart:rescueStart', (e) => this.start(e.kartId)),
      events.on('kart:rescueEnd', (e) => this.stop(e.kartId)),
    );
  }

  update(dt: number, karts: readonly IKart[]): void {
    if (this.active.length === 0) return;
    this.spin = (this.spin + dt * ROTOR_SPEED) % (Math.PI * 2);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i];
      const kart = karts.find((k) => k.state.id === d.kartId);
      // The kart went away mid-rescue (race disposed, roster changed): take the drone with it.
      if (!kart) {
        this.retire(i);
        continue;
      }
      const rate = d.leaving ? -dt / LEAVE_SECONDS : dt / ARRIVE_SECONDS;
      d.presence = Math.min(1, Math.max(0, d.presence + rate));
      if (d.leaving && d.presence <= 0) {
        this.retire(i);
        continue;
      }
      // Ease so the drone settles into the hover instead of stopping dead.
      const k = d.presence * d.presence * (3 - 2 * d.presence);
      const p = kart.state.position;
      d.group.position.set(p.x, p.y + HOVER + APPROACH_RISE * (1 - k), p.z);
      d.group.scale.setScalar(0.6 + 0.4 * k);
      d.group.rotation.y += dt * 0.6;
      for (const r of d.rotors) r.rotation.y = this.spin;
    }
  }

  /** Drops every drone immediately. Called when a race ends under one. */
  reset(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.retire(i);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.reset();
    this.pool.length = 0;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.object.removeFromParent();
  }

  // -------------------------------------------------------------------------

  private start(kartId: number): void {
    const existing = this.active.find((d) => d.kartId === kartId);
    if (existing) {
      existing.leaving = false;
      return;
    }
    const drone = this.pool.pop() ?? this.spawn();
    drone.kartId = kartId;
    drone.presence = 0;
    drone.leaving = false;
    drone.group.visible = true;
    this.object.add(drone.group);
    this.active.push(drone);
  }

  private stop(kartId: number): void {
    const d = this.active.find((x) => x.kartId === kartId);
    if (d) d.leaving = true;
  }

  private retire(index: number): void {
    const d = this.active[index];
    this.active.splice(index, 1);
    d.group.removeFromParent();
    d.group.visible = false;
    this.pool.push(d);
  }

  private spawn(): Drone {
    const group = this.template.clone(true);
    const rotors: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o.name === 'rotor') rotors.push(o as THREE.Mesh);
    });
    return { group, rotors, kartId: -1, presence: 0, leaving: false };
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** One drone's worth of meshes. Clones share these geometries and materials. */
  private buildTemplate(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'rescueDrone';
    group.visible = false;

    const shell = this.mat(new THREE.MeshStandardMaterial({ color: 0x2b3140, roughness: 0.5, metalness: 0.55 }));
    const trim = this.mat(new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.4, metalness: 0.3 }));
    const dark = this.mat(new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.8, metalness: 0.2 }));
    const glow = this.mat(
      new THREE.MeshBasicMaterial({ color: 0x36d5ea, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    const magnetRed = this.mat(new THREE.MeshStandardMaterial({ color: 0xff3b4a, roughness: 0.45, metalness: 0.4 }));

    const body = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.95, 0.28, 0.7)), shell);
    body.castShadow = false;
    group.add(body);
    const fin = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.2, 0.22, 0.5)), trim);
    fin.position.set(0, 0.2, 0);
    group.add(fin);
    // A beacon so the drone reads against a night track as well as a bright one.
    const beacon = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 8, 6)), glow);
    beacon.position.set(0, 0.3, -0.3);
    group.add(beacon);

    const armGeo = this.geo(new THREE.BoxGeometry(0.62, 0.07, 0.09));
    const rotorGeo = this.geo(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 10));
    const hubGeo = this.geo(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6));
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      const dx = Math.cos(angle) * 0.52;
      const dz = Math.sin(angle) * 0.52;
      const arm = new THREE.Mesh(armGeo, shell);
      arm.position.set(dx * 0.5, 0.02, dz * 0.5);
      arm.rotation.y = -angle;
      group.add(arm);
      const hub = new THREE.Mesh(hubGeo, dark);
      hub.position.set(dx, 0.08, dz);
      group.add(hub);
      const rotor = new THREE.Mesh(rotorGeo, dark);
      rotor.name = 'rotor';
      rotor.position.set(dx, 0.15, dz);
      group.add(rotor);
    }

    // Cable + electromagnet, hanging down to just above the kart's roll bar.
    const drop = HOVER - MAGNET_GAP;
    const cable = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.025, 0.025, drop, 5)), dark);
    cable.position.set(0, -drop / 2, 0);
    group.add(cable);
    const magnet = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12)), magnetRed);
    magnet.position.set(0, -drop, 0);
    group.add(magnet);
    const coil = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.3, 0.05, 6, 14)), glow);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0, -drop - 0.1, 0);
    group.add(coil);
    // The pull itself: a soft cone from the magnet down onto the kart.
    const beam = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.55, MAGNET_GAP, 12, 1, true)), glow);
    beam.position.set(0, -drop - MAGNET_GAP / 2, 0);
    beam.rotation.x = Math.PI;
    group.add(beam);

    return group;
  }
}
