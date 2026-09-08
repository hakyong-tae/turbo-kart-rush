/**
 * Per-character kart bodies. Each spec is data (wheel sizes, exhaust layout, plate
 * positions) plus one `build()` that adds chassis / spoiler / trim geometry to the four
 * material batches. Specs never create scene objects — `KartModel.ts` merges the batches
 * into one mesh per material, so a fancy body costs no extra draw calls.
 *
 * Kart space: forward = -z, wheels at x ±0.52 (front z -0.52, rear z +0.5), ground y = 0,
 * floor pan y 0.13, seat base y 0.37 / z 0.16, driver hips y 0.41 / z 0.18.
 * See docs/superpowers/specs/2026-09-07-kart-bodies-design.md for the silhouette table.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { lerp, smoothstep } from '../core/math';
import { Batch, limbGeometry, profileChassis } from './modelUtils';

export interface WheelSize {
  /** Multiplier on the base wheel radius (visual only — the hub stays put). */
  r: number;
  /** Multiplier on the base wheel width. */
  w: number;
}

export interface ExhaustSpec {
  x: number;
  y: number;
  z: number;
  /** Pitch of the pipe; -0.16 = slightly raised rear pipe, -Math.PI / 2 = vertical stack. */
  rx: number;
  /** Pipe length (base pipe is 0.28). */
  length: number;
}

export interface KartBodySpec {
  wheels: { front: WheelSize; rear: WheelSize };
  /** Raises seat, driver, steering column and gloves for tall chassis. */
  lift: number;
  /** Show the common rear engine block + chrome air filter. */
  engine: boolean;
  exhausts: ExhaustSpec[];
  plates: { front: { y: number; z: number }; side: { x: number; y: number; z: number } };
  build(kit: BodyKit): void;
}

/** Helper handed to `build()`: the four batches plus geometry shortcuts that dispose after use. */
export interface BodyKit {
  body: Batch;
  accent: Batch;
  dark: Batch;
  chrome: Batch;
  /** Adds `geo` to `batch` with a transform, then disposes `geo`. */
  add(batch: Batch, geo: THREE.BufferGeometry, x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number, sx?: number, sy?: number, sz?: number): void;
  /** Adds the same geometry at several transforms, then disposes it. */
  addMany(batch: Batch, geo: THREE.BufferGeometry, placements: number[][]): void;
  rb(w: number, h: number, d: number, radius?: number): THREE.BufferGeometry;
  box(w: number, h: number, d: number): THREE.BufferGeometry;
  cyl(rTop: number, rBottom: number, h: number, segments?: number): THREE.BufferGeometry;
  cone(r: number, h: number, segments?: number): THREE.BufferGeometry;
  sphere(r: number, ws?: number, hs?: number, phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number): THREE.BufferGeometry;
  torus(r: number, tube: number, arc?: number, radial?: number, tubular?: number): THREE.BufferGeometry;
  /** Tube from a to b (roll cages, bars). */
  tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): THREE.BufferGeometry;
  profile(shape: THREE.Shape, width: number, widthScale: (z: number) => number): THREE.BufferGeometry;
}

export function createBodyKit(body: Batch, accent: Batch, dark: Batch, chrome: Batch): BodyKit {
  return {
    body,
    accent,
    dark,
    chrome,
    add(batch, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      batch.add(geo, x, y, z, rx, ry, rz, sx, sy, sz);
      geo.dispose();
    },
    addMany(batch, geo, placements) {
      for (const p of placements) batch.add(geo, ...(p as [number, number, number, number, number, number, number, number, number]));
      geo.dispose();
    },
    rb: (w, h, d, radius = 0.04) => new RoundedBoxGeometry(w, h, d, 2, radius),
    box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    cyl: (rTop, rBottom, h, segments = 12) => new THREE.CylinderGeometry(rTop, rBottom, h, segments),
    cone: (r, h, segments = 8) => new THREE.ConeGeometry(r, h, segments),
    sphere: (r, ws = 16, hs = 10, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) =>
      new THREE.SphereGeometry(r, ws, hs, phiStart, phiLength, thetaStart, thetaLength),
    torus: (r, tube, arc = Math.PI * 2, radial = 8, tubular = 20) => new THREE.TorusGeometry(r, tube, radial, tubular, arc),
    tube: (ax, ay, az, bx, by, bz, r) => limbGeometry(ax, ay, az, bx, by, bz, r, 8),
    profile: profileChassis,
  };
}

// --- shared bits -------------------------------------------------------------

const WHEEL_X = 0.52;
const REAR_PIPE = { y: 0.5, z: 0.64, rx: -0.16, length: 0.28 };
const twinPipes = (x: number): ExhaustSpec[] => [{ x: -x, ...REAR_PIPE }, { x, ...REAR_PIPE }];
const std: WheelSize = { r: 1, w: 1 };

/** The original cigar profile (Max), reused with tweaks by other bodies. */
function cigarShape(scaleY = 1): THREE.Shape {
  const s = new THREE.Shape();
  const y = (v: number) => 0.17 + (v - 0.17) * scaleY;
  s.moveTo(-0.76, y(0.17));
  s.lineTo(0.74, y(0.17));
  s.quadraticCurveTo(0.86, y(0.17), 0.86, y(0.27));
  s.quadraticCurveTo(0.86, y(0.36), 0.72, y(0.39));
  s.lineTo(0.36, y(0.46));
  s.quadraticCurveTo(0.18, y(0.5), 0.12, y(0.44));
  s.lineTo(0.06, y(0.31));
  s.lineTo(-0.4, y(0.31));
  s.lineTo(-0.48, y(0.42));
  s.lineTo(-0.7, y(0.42));
  s.quadraticCurveTo(-0.8, y(0.42), -0.8, y(0.32));
  return s;
}

function cigarWidth(z: number): number {
  const nose = smoothstep(-0.92, -0.18, z);
  const tail = smoothstep(0.25, 0.86, z);
  return lerp(0.5, 1, nose) * lerp(1, 0.8, tail);
}

/** Classic high rear wing with end plates. */
function highWing(kit: BodyKit, width = 0.94, y = 0.71, z = 0.72): void {
  kit.add(kit.accent, kit.rb(width, 0.035, 0.24, 0.015), 0, y, z, -0.22, 0, 0);
  kit.addMany(kit.accent, kit.box(0.025, 0.11, 0.26), [
    [width / 2, y + 0.01, z, -0.22, 0, 0, 1, 1, 1],
    [-width / 2, y + 0.01, z, -0.22, 0, 0, 1, 1, 1],
  ]);
}

// --- the roster ----------------------------------------------------------------

const max: KartBodySpec = {
  wheels: { front: std, rear: std },
  lift: 0,
  engine: true,
  exhausts: twinPipes(0.17),
  plates: { front: { y: 0.29, z: -0.9 }, side: { x: 0.636, y: 0.24, z: 0.02 } },
  build(kit) {
    kit.add(kit.body, kit.profile(cigarShape(), 0.64, cigarWidth));
    kit.addMany(kit.body, kit.rb(0.28, 0.16, 0.74, 0.05), [
      [WHEEL_X - 0.03, 0.24, 0.02, 0, 0, 0, 1, 1, 1],
      [-WHEEL_X + 0.03, 0.24, 0.02, 0, 0, 0, 1, 1, 1],
    ]);
    highWing(kit);
    const bumperArc = Math.PI * 0.9;
    const bumper = kit.torus(0.33, 0.03, bumperArc, 6, 18);
    bumper.rotateX(Math.PI / 2);
    bumper.rotateY(bumperArc / 2 + Math.PI / 2);
    kit.add(kit.accent, bumper, 0, 0.19, -0.5);
    kit.addMany(kit.accent, kit.box(0.05, 0.014, 0.62), [
      [WHEEL_X - 0.03, 0.325, 0.02, 0, 0, 0, 1, 1, 1],
      [-WHEEL_X + 0.03, 0.325, 0.02, 0, 0, 0, 1, 1, 1],
    ]);
    kit.add(kit.accent, kit.box(0.06, 0.012, 0.36), 0, 0.465, -0.54, -0.19, 0, 0);
    kit.add(kit.accent, kit.box(0.42, 0.03, 0.02), 0, 0.27, 0.815, 0.25, 0, 0);
  },
};

/** Zippy Nova — arrowhead speedster: lowest, narrowest, single centre pipe, thin low wing. */
const zippy: KartBodySpec = {
  wheels: { front: { r: 0.85, w: 0.9 }, rear: { r: 0.85, w: 0.9 } },
  lift: 0,
  engine: true,
  exhausts: [{ x: 0, ...REAR_PIPE }],
  plates: { front: { y: 0.27, z: -0.78 }, side: { x: 0.53, y: 0.23, z: 0.02 } },
  build(kit) {
    const width = (z: number) => lerp(0.3, 1, smoothstep(-0.95, -0.05, z)) * lerp(1, 0.72, smoothstep(0.3, 0.86, z));
    kit.add(kit.body, kit.profile(cigarShape(0.72), 0.5, width));
    // Nose cone pointing forward (-z), flattened.
    kit.add(kit.body, kit.cone(0.16, 0.5, 6), 0, 0.24, -1.02, -Math.PI / 2, 0, 0, 1.35, 1, 0.55);
    kit.addMany(kit.body, kit.rb(0.2, 0.1, 0.9, 0.03), [
      [0.42, 0.22, 0.0, 0, 0, 0, 1, 1, 1],
      [-0.42, 0.22, 0.0, 0, 0, 0, 1, 1, 1],
    ]);
    // Thin low wing.
    kit.add(kit.accent, kit.rb(0.9, 0.02, 0.16, 0.005), 0, 0.46, 0.78);
    kit.addMany(kit.accent, kit.rb(0.02, 0.12, 0.16, 0.005), [
      [0.45, 0.4, 0.78, 0, 0, 0, 1, 1, 1],
      [-0.45, 0.4, 0.78, 0, 0, 0, 1, 1, 1],
    ]);
    kit.add(kit.accent, kit.rb(0.06, 0.012, 1.2, 0.004), 0, 0.345, -0.1);
    kit.add(kit.accent, kit.box(0.34, 0.025, 0.02), 0, 0.24, 0.79, 0.25, 0, 0);
  },
};

/** Pixel Pop — bubble car: round pod, fender domes, twin canopy arches, no spoiler. */
const pixel: KartBodySpec = {
  wheels: { front: { r: 0.95, w: 1.2 }, rear: { r: 0.95, w: 1.2 } },
  lift: 0,
  engine: true,
  exhausts: twinPipes(0.17),
  plates: { front: { y: 0.28, z: -0.7 }, side: { x: 0.49, y: 0.3, z: 0.05 } },
  build(kit) {
    kit.add(kit.body, kit.sphere(0.5, 24, 16), 0, 0.28, 0.05, 0, 0, 0, 0.95, 0.55, 1.45);
    const dome = kit.sphere(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    kit.addMany(kit.body, dome, [
      [WHEEL_X, 0.2, -0.52, 0, 0, 0, 1, 0.9, 1.05],
      [-WHEEL_X, 0.2, -0.52, 0, 0, 0, 1, 0.9, 1.05],
      [WHEEL_X, 0.2, 0.5, 0, 0, 0, 1, 0.9, 1.05],
      [-WHEEL_X, 0.2, 0.5, 0, 0, 0, 1, 0.9, 1.05],
    ]);
    // Canopy arches over the seat.
    kit.addMany(kit.accent, kit.torus(0.42, 0.035, Math.PI, 8, 24), [
      [0, 0.42, 0.28, 0, 0, 0, 1, 1, 1],
      [0, 0.42, -0.02, 0, 0, 0, 1, 1, 1],
    ]);
    kit.addMany(kit.accent, kit.sphere(0.06, 10, 8), [
      [0.2, 0.42, 0.74, 0, 0, 0, 1, 1, 1],
      [-0.2, 0.42, 0.74, 0, 0, 0, 1, 1, 1],
    ]);
  },
};

/** Fennec Flash (premium) — desert buggy: flat tub, tube roll cage, ear intakes, knobby tyres. */
const fennec: KartBodySpec = {
  wheels: { front: { r: 1.1, w: 1.3 }, rear: { r: 1.2, w: 1.4 } },
  lift: 0,
  engine: true,
  exhausts: twinPipes(0.17),
  plates: { front: { y: 0.3, z: -0.88 }, side: { x: 0.365, y: 0.25, z: 0.05 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.72, 0.16, 1.55, 0.05), 0, 0.25, 0);
    kit.add(kit.body, kit.rb(0.5, 0.12, 0.35, 0.04), 0, 0.36, -0.7, 0.25, 0, 0);
    // Roll cage.
    const R = 0.028;
    for (const sx of [-1, 1]) {
      kit.add(kit.dark, kit.tube(sx * 0.33, 0.3, 0.45, sx * 0.33, 0.98, 0.42, R));
      kit.add(kit.dark, kit.tube(sx * 0.33, 0.98, 0.42, sx * 0.3, 0.55, -0.35, R));
      kit.add(kit.dark, kit.tube(sx * 0.3, 0.55, -0.35, sx * 0.3, 0.32, -0.7, R));
    }
    kit.add(kit.dark, kit.tube(-0.33, 0.98, 0.42, 0.33, 0.98, 0.42, R));
    kit.add(kit.dark, kit.tube(-0.3, 0.55, -0.35, 0.3, 0.55, -0.35, R));
    // Big ears.
    kit.addMany(kit.accent, kit.rb(0.14, 0.34, 0.2, 0.05), [
      [0.34, 0.78, 0.66, -0.3, 0, -0.25, 1, 1, 1],
      [-0.34, 0.78, 0.66, -0.3, 0, 0.25, 1, 1, 1],
    ]);
    kit.add(kit.accent, kit.rb(0.06, 0.012, 0.8, 0.004), 0, 0.335, -0.2);
  },
};

/** Juno Bolt — stealth wedge: angular slab, tapered nose, zig-zag lightning fins, four pipes. */
const juno: KartBodySpec = {
  wheels: { front: std, rear: std },
  lift: 0,
  engine: true,
  exhausts: [...twinPipes(0.26), ...twinPipes(0.12)],
  plates: { front: { y: 0.3, z: -0.9 }, side: { x: 0.4, y: 0.3, z: 0.1 } },
  build(kit) {
    kit.add(kit.body, kit.box(0.78, 0.2, 1.3), 0, 0.3, 0.1);
    kit.add(kit.body, kit.box(0.62, 0.16, 0.7), 0, 0.3, -0.85, 0.3, 0, 0);
    kit.add(kit.body, kit.box(0.22, 0.12, 0.8), 0.45, 0.28, 0.1, 0, 0, 0.3);
    kit.add(kit.body, kit.box(0.22, 0.12, 0.8), -0.45, 0.28, 0.1, 0, 0, -0.3);
    for (const sx of [-1, 1]) {
      kit.add(kit.accent, kit.box(0.03, 0.3, 0.16), sx * 0.42, 0.6, 0.72, 0, 0, sx * 0.45);
      kit.add(kit.accent, kit.box(0.03, 0.26, 0.14), sx * 0.52, 0.86, 0.7, 0, 0, sx * -0.55);
    }
    kit.add(kit.accent, kit.box(0.9, 0.03, 0.14), 0, 0.98, 0.7);
    kit.add(kit.accent, kit.box(0.04, 0.02, 1.1), 0.18, 0.41, -0.2, 0, 0.12, 0);
    kit.add(kit.accent, kit.box(0.04, 0.02, 1.1), -0.18, 0.41, -0.2, 0, -0.12, 0);
  },
};

/** Kai Tidewater — surf longboard: long flat deck, wave skirts, shark-fin spoiler. */
const kai: KartBodySpec = {
  wheels: { front: std, rear: std },
  lift: 0,
  engine: true,
  exhausts: twinPipes(0.17),
  plates: { front: { y: 0.24, z: -1.16 }, side: { x: 0.34, y: 0.22, z: 0.3 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.66, 0.1, 1.95, 0.05), 0, 0.22, 0.02);
    kit.add(kit.body, kit.sphere(0.34, 20, 12), 0, 0.24, -0.75, 0, 0, 0, 0.97, 0.55, 1.3);
    // Side rails with wave bumps along the deck edge.
    kit.addMany(kit.accent, kit.rb(0.05, 0.04, 1.3, 0.02), [
      [0.345, 0.26, 0.0, 0, 0, 0, 1, 1, 1],
      [-0.345, 0.26, 0.0, 0, 0, 0, 1, 1, 1],
    ]);
    kit.addMany(
      kit.accent,
      kit.sphere(0.055, 10, 8),
      [-0.45, -0.05, 0.35].flatMap((z) => [
        [0.35, 0.29, z, 0, 0, 0, 1, 1, 1],
        [-0.35, 0.29, z, 0, 0, 0, 1, 1, 1],
      ]),
    );
    kit.add(kit.accent, kit.box(0.04, 0.42, 0.36), 0, 0.55, 0.78, -0.55, 0, 0);
    kit.add(kit.accent, kit.box(0.03, 0.22, 0.22), 0.28, 0.42, 0.8, -0.55, 0, 0);
    kit.add(kit.accent, kit.box(0.03, 0.22, 0.22), -0.28, 0.42, 0.8, -0.55, 0, 0);
    kit.add(kit.accent, kit.rb(0.5, 0.012, 1.4, 0.004), 0, 0.275, -0.1);
  },
};

/** Boulder Bram (premium) — monster chassis: wide and low, armour, bull bar, fat wheels. */
const bram: KartBodySpec = {
  wheels: { front: { r: 1.25, w: 1.5 }, rear: { r: 1.3, w: 1.6 } },
  lift: 0.03,
  engine: true,
  exhausts: twinPipes(0.2),
  plates: { front: { y: 0.42, z: -0.9 }, side: { x: 0.43, y: 0.3, z: 0.1 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.84, 0.26, 1.45, 0.06), 0, 0.3, 0.02);
    kit.add(kit.body, kit.rb(0.66, 0.2, 0.5, 0.05), 0, 0.5, -0.5);
    // Fender flares over the big tyres.
    kit.addMany(kit.body, kit.rb(0.26, 0.1, 0.6, 0.04), [
      [WHEEL_X, 0.5, -0.52, 0, 0, 0, 1, 1, 1],
      [-WHEEL_X, 0.5, -0.52, 0, 0, 0, 1, 1, 1],
      [WHEEL_X, 0.56, 0.5, 0, 0, 0, 1, 1, 1],
      [-WHEEL_X, 0.56, 0.5, 0, 0, 0, 1, 1, 1],
    ]);
    // Armour plates on the cab, bull bar up front.
    kit.add(kit.dark, kit.rb(0.06, 0.22, 0.5, 0.02), 0.36, 0.5, -0.5, 0, 0, -0.15);
    kit.add(kit.dark, kit.rb(0.06, 0.22, 0.5, 0.02), -0.36, 0.5, -0.5, 0, 0, 0.15);
    kit.add(kit.dark, kit.torus(0.4, 0.045, Math.PI, 8, 20), 0, 0.3, -0.9);
    kit.add(kit.dark, kit.box(0.9, 0.05, 0.05), 0, 0.3, -0.9);
    kit.addMany(kit.dark, kit.rb(0.06, 0.3, 0.06, 0.02), [
      [0.36, 0.62, 0.7, 0, 0, 0, 1, 1, 1],
      [-0.36, 0.62, 0.7, 0, 0, 0, 1, 1, 1],
    ]);
    kit.add(kit.accent, kit.rb(0.9, 0.05, 0.28, 0.02), 0, 0.78, 0.7, -0.15, 0, 0);
    kit.addMany(kit.accent, kit.rb(0.18, 0.02, 0.4, 0.005), [
      [-0.2, 0.605, -0.5, 0, 0, 0, 1, 1, 1],
      [0.2, 0.605, -0.5, 0, 0, 0, 1, 1, 1],
    ]);
  },
};

/** Big Rig Rosa (premium) — truck: tall hood, chrome grille, twin stacks, flatbed, big rear wheels. */
const rosa: KartBodySpec = {
  wheels: { front: std, rear: { r: 1.35, w: 1.5 } },
  lift: 0.05,
  engine: false,
  exhausts: [
    { x: -0.38, y: 0.42, z: 0.3, rx: -Math.PI / 2, length: 0.8 },
    { x: 0.38, y: 0.42, z: 0.3, rx: -Math.PI / 2, length: 0.8 },
  ],
  plates: { front: { y: 0.26, z: -0.965 }, side: { x: 0.365, y: 0.5, z: -0.5 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.72, 0.46, 0.72, 0.06), 0, 0.44, -0.5);
    kit.add(kit.body, kit.rb(0.66, 0.18, 1.4, 0.05), 0, 0.27, 0.1);
    kit.add(kit.chrome, kit.rb(0.56, 0.3, 0.06, 0.02), 0, 0.44, -0.88);
    kit.addMany(
      kit.dark,
      kit.box(0.5, 0.02, 0.02),
      [0, 1, 2, 3].map((i) => [0, 0.33 + i * 0.07, -0.915, 0, 0, 0, 1, 1, 1]),
    );
    kit.add(kit.chrome, kit.box(0.9, 0.06, 0.08), 0, 0.22, -0.92);
    kit.addMany(kit.accent, kit.sphere(0.07, 10, 8), [
      [0.3, 0.6, -0.87, 0, 0, 0, 1, 1, 1],
      [-0.3, 0.6, -0.87, 0, 0, 0, 1, 1, 1],
    ]);
    kit.add(kit.dark, kit.rb(0.66, 0.1, 0.5, 0.03), 0, 0.4, 0.62);
    kit.add(kit.accent, kit.rb(0.7, 0.03, 0.2, 0.01), 0, 0.5, 0.82, -0.2, 0, 0);
    kit.add(kit.accent, kit.rb(0.08, 0.012, 0.5, 0.004), 0, 0.676, -0.5);
  },
};

export const KART_BODIES: Readonly<Record<string, KartBodySpec>> = { zippy, pixel, fennec, max, juno, kai, bram, rosa };

export function getBodySpec(characterId: string): KartBodySpec {
  return KART_BODIES[characterId] ?? max;
}
