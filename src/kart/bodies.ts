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

// --- second wave (2026-11): eight more silhouettes ------------------------------------------
// Same rule as the first eight: the outline alone has to say which kart it is.

/** Tubby Splash — a bathtub: deep tub with a rolled rim, tap up front, shower head for a spoiler. */
const tubby: KartBodySpec = {
  wheels: { front: { r: 0.9, w: 1 }, rear: { r: 0.9, w: 1 } },
  lift: 0,
  engine: false,
  exhausts: twinPipes(0.2),
  plates: { front: { y: 0.3, z: -0.87 }, side: { x: 0.43, y: 0.3, z: 0.05 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.8, 0.3, 1.62, 0.13), 0, 0.31, 0);
    // Rolled rim.
    kit.addMany(kit.accent, kit.rb(0.07, 0.07, 1.6, 0.03), [
      [0.4, 0.47, 0, 0, 0, 0, 1, 1, 1],
      [-0.4, 0.47, 0, 0, 0, 0, 1, 1, 1],
    ]);
    kit.addMany(kit.accent, kit.rb(0.86, 0.07, 0.07, 0.03), [
      [0, 0.47, -0.8, 0, 0, 0, 1, 1, 1],
      [0, 0.47, 0.8, 0, 0, 0, 1, 1, 1],
    ]);
    // Claw feet.
    kit.addMany(
      kit.chrome,
      kit.sphere(0.075, 10, 8),
      [-1, 1].flatMap((sx) => [-0.66, 0.66].map((z) => [sx * 0.33, 0.12, z, 0, 0, 0, 1, 1, 1])),
    );
    // Tap on the nose: a riser, a spout curling back toward the driver, two handles.
    kit.add(kit.chrome, kit.cyl(0.035, 0.045, 0.3, 10), 0, 0.64, -0.74);
    const spout = kit.torus(0.1, 0.03, Math.PI / 2, 8, 10);
    spout.rotateY(Math.PI / 2);
    kit.add(kit.chrome, spout, 0, 0.78, -0.64);
    kit.addMany(kit.accent, kit.sphere(0.05, 8, 6), [
      [0.14, 0.56, -0.76, 0, 0, 0, 1, 1, 1],
      [-0.14, 0.56, -0.76, 0, 0, 0, 1, 1, 1],
    ]);
    // Shower pole and head at the back.
    kit.add(kit.chrome, kit.tube(0.3, 0.45, 0.76, 0.3, 1.12, 0.76, 0.024));
    kit.add(kit.chrome, kit.tube(0.3, 1.12, 0.76, 0.06, 1.16, 0.6, 0.024));
    kit.add(kit.accent, kit.cyl(0.13, 0.05, 0.07, 14), 0.03, 1.12, 0.56, 0.6, 0, 0);
    // Soap bubbles riding on the rim.
    kit.addMany(kit.accent, kit.sphere(0.08, 10, 8), [
      [-0.34, 0.56, 0.62, 0, 0, 0, 1, 1, 1],
      [-0.26, 0.64, 0.74, 0, 0, 0, 0.7, 0.7, 0.7],
      [-0.4, 0.6, 0.48, 0, 0, 0, 0.55, 0.55, 0.55],
    ]);
  },
};

/** Comet Coco (premium) — a rocket: tube fuselage, red nose cone, three tail fins, one big nozzle. */
const coco: KartBodySpec = {
  wheels: { front: { r: 0.85, w: 0.9 }, rear: { r: 0.9, w: 1 } },
  lift: 0,
  engine: false,
  exhausts: [{ x: 0, y: 0.33, z: 0.86, rx: 0, length: 0.3 }],
  plates: { front: { y: 0.2, z: -0.86 }, side: { x: 0.5, y: 0.24, z: 0.1 } },
  build(kit) {
    kit.add(kit.body, kit.cyl(0.27, 0.3, 1.5, 18), 0, 0.33, 0, Math.PI / 2, 0, 0, 1.12, 1, 1);
    kit.add(kit.accent, kit.cone(0.27, 0.62, 18), 0, 0.33, -1.06, -Math.PI / 2, 0, 0, 1.12, 1, 1);
    // Nozzle bell.
    kit.add(kit.dark, kit.cyl(0.17, 0.27, 0.24, 16), 0, 0.33, 0.87, Math.PI / 2, 0, 0);
    // Strap-on boosters over the wheel gap.
    kit.addMany(kit.body, kit.cyl(0.1, 0.1, 0.72, 12), [
      [0.43, 0.24, 0.02, Math.PI / 2, 0, 0, 1, 1, 1],
      [-0.43, 0.24, 0.02, Math.PI / 2, 0, 0, 1, 1, 1],
    ]);
    kit.addMany(kit.accent, kit.cone(0.1, 0.2, 12), [
      [0.43, 0.24, -0.44, -Math.PI / 2, 0, 0, 1, 1, 1],
      [-0.43, 0.24, -0.44, -Math.PI / 2, 0, 0, 1, 1, 1],
    ]);
    // Three fins: two swept out to the sides, one straight up.
    kit.add(kit.accent, kit.box(0.035, 0.46, 0.44), 0, 0.82, 0.62, -0.5, 0, 0);
    kit.add(kit.accent, kit.box(0.035, 0.4, 0.4), 0.42, 0.52, 0.66, -0.5, 0, -1.05);
    kit.add(kit.accent, kit.box(0.035, 0.4, 0.4), -0.42, 0.52, 0.66, -0.5, 0, 1.05);
    // Portholes.
    const port = kit.torus(0.075, 0.02, Math.PI * 2, 6, 14);
    port.rotateY(Math.PI / 2);
    kit.addMany(kit.chrome, port, [
      [0.31, 0.37, -0.36, 0, 0, 0, 1, 1, 1],
      [-0.31, 0.37, -0.36, 0, 0, 0, 1, 1, 1],
    ]);
    kit.add(kit.accent, kit.rb(0.62, 0.02, 0.1, 0.005), 0, 0.5, -0.62);
  },
};

/** Rusty Piston — a hot rod: chrome engine out in the open, tiny front wheels, huge rears. */
const rusty: KartBodySpec = {
  wheels: { front: { r: 0.8, w: 0.8 }, rear: { r: 1.4, w: 1.7 } },
  lift: 0,
  engine: false,
  exhausts: [
    { x: -0.4, y: 0.2, z: 0.3, rx: -0.04, length: 0.62 },
    { x: 0.4, y: 0.2, z: 0.3, rx: -0.04, length: 0.62 },
  ],
  plates: { front: { y: 0.28, z: -1.0 }, side: { x: 0.345, y: 0.3, z: 0.34 } },
  build(kit) {
    // Cabin tub at the back, frame rails and a narrow hood line up front.
    kit.add(kit.body, kit.rb(0.66, 0.24, 0.96, 0.07), 0, 0.31, 0.32);
    kit.add(kit.body, kit.sphere(0.36, 16, 10), 0, 0.34, 0.74, 0, 0, 0, 0.9, 0.62, 0.8);
    kit.add(kit.body, kit.rb(0.44, 0.1, 0.9, 0.03), 0, 0.23, -0.5);
    // Grille shell.
    kit.add(kit.accent, kit.rb(0.4, 0.34, 0.07, 0.03), 0, 0.36, -0.94);
    kit.addMany(
      kit.dark,
      kit.box(0.3, 0.018, 0.02),
      [0, 1, 2, 3].map((i) => [0, 0.26 + i * 0.065, -0.98, 0, 0, 0, 1, 1, 1]),
    );
    // The engine: block, blower with a scoop, eight stacks.
    kit.add(kit.chrome, kit.rb(0.34, 0.2, 0.44, 0.03), 0, 0.4, -0.5);
    kit.add(kit.dark, kit.rb(0.22, 0.12, 0.3, 0.03), 0, 0.56, -0.5);
    kit.add(kit.accent, kit.rb(0.24, 0.07, 0.2, 0.02), 0, 0.655, -0.54, 0.2, 0, 0);
    kit.addMany(
      kit.chrome,
      kit.cyl(0.026, 0.026, 0.2, 8),
      [-1, 1].flatMap((sx) => [-0.66, -0.56, -0.46, -0.36].map((z) => [sx * 0.23, 0.5, z, 0, 0, sx * -0.65, 1, 1, 1])),
    );
    // Headlamps on stalks.
    kit.addMany(kit.chrome, kit.sphere(0.065, 10, 8), [
      [0.3, 0.4, -0.9, 0, 0, 0, 1, 1, 1],
      [-0.3, 0.4, -0.9, 0, 0, 0, 1, 1, 1],
    ]);
    // Pinstripe and a short rear deck lip.
    kit.add(kit.accent, kit.rb(0.05, 0.012, 0.8, 0.004), 0, 0.435, 0.34);
    kit.add(kit.accent, kit.rb(0.6, 0.03, 0.14, 0.01), 0, 0.5, 0.86, -0.25, 0, 0);
  },
};

/** Zorp Orbit (premium) — a flying saucer: flat disc, a ring round the rim, canopy hoops, antenna. */
const zorp: KartBodySpec = {
  wheels: { front: { r: 0.8, w: 0.9 }, rear: { r: 0.8, w: 0.9 } },
  lift: 0,
  engine: false,
  exhausts: [{ x: 0, y: 0.25, z: 0.92, rx: -0.1, length: 0.22 }],
  plates: { front: { y: 0.3, z: -1.0 }, side: { x: 0.8, y: 0.3, z: 0 } },
  build(kit) {
    kit.add(kit.body, kit.sphere(0.8, 28, 14), 0, 0.3, 0, 0, 0, 0, 1, 0.24, 1.2);
    kit.add(kit.dark, kit.cyl(0.5, 0.36, 0.1, 20), 0, 0.14, 0, 0, 0, 0, 1, 1, 1.2);
    const ring = kit.torus(0.8, 0.045, Math.PI * 2, 8, 36);
    ring.rotateX(Math.PI / 2);
    kit.add(kit.accent, ring, 0, 0.3, 0, 0, 0, 0, 1, 1, 1.2);
    // Running lights round the rim.
    const lights: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      lights.push([Math.sin(a) * 0.66, 0.4, Math.cos(a) * 0.79, 0, 0, 0, 1, 1, 1]);
    }
    kit.addMany(kit.chrome, kit.sphere(0.045, 8, 6), lights);
    // Canopy: two crossed hoops over the seat instead of a glass dome.
    kit.add(kit.accent, kit.torus(0.44, 0.03, Math.PI, 8, 22), 0, 0.44, 0.16);
    const hoop = kit.torus(0.44, 0.03, Math.PI, 8, 22);
    hoop.rotateY(Math.PI / 2);
    kit.add(kit.accent, hoop, 0, 0.44, 0.16, 0, 0, 0, 1, 1, 1.15);
    // Antenna.
    kit.add(kit.chrome, kit.tube(0, 0.42, 0.78, 0, 0.98, 0.84, 0.014));
    kit.add(kit.accent, kit.sphere(0.055, 10, 8), 0, 1.0, 0.84);
  },
};

/** Vera Apex (premium) — a formula car: needle monocoque, front wing, two-tier rear wing, airbox. */
const vera: KartBodySpec = {
  wheels: { front: { r: 1.0, w: 1.15 }, rear: { r: 1.1, w: 1.55 } },
  lift: 0,
  engine: true,
  exhausts: [{ x: 0, ...REAR_PIPE }],
  plates: { front: { y: 0.24, z: -1.02 }, side: { x: 0.505, y: 0.27, z: 0.14 } },
  build(kit) {
    const width = (z: number) => lerp(0.34, 1, smoothstep(-1.0, -0.2, z)) * lerp(1, 0.86, smoothstep(0.3, 0.86, z));
    kit.add(kit.body, kit.profile(cigarShape(0.86), 0.46, width));
    kit.add(kit.body, kit.rb(0.14, 0.08, 0.5, 0.03), 0, 0.2, -1.05);
    // Side pods.
    kit.addMany(kit.body, kit.rb(0.24, 0.17, 0.74, 0.05), [
      [0.38, 0.25, 0.14, 0, 0, 0, 1, 1, 1],
      [-0.38, 0.25, 0.14, 0, 0, 0, 1, 1, 1],
    ]);
    // Front wing with end plates.
    kit.add(kit.accent, kit.rb(1.2, 0.025, 0.2, 0.01), 0, 0.11, -1.2);
    kit.addMany(kit.body, kit.box(0.025, 0.12, 0.24), [
      [0.6, 0.15, -1.2, 0, 0, 0, 1, 1, 1],
      [-0.6, 0.15, -1.2, 0, 0, 0, 1, 1, 1],
    ]);
    // Wishbones to the front hubs.
    for (const sx of [-1, 1]) {
      kit.add(kit.dark, kit.tube(sx * 0.14, 0.26, -0.44, sx * 0.48, 0.22, -0.52, 0.014));
      kit.add(kit.dark, kit.tube(sx * 0.14, 0.26, -0.62, sx * 0.48, 0.22, -0.52, 0.014));
    }
    // Two-tier rear wing between tall end plates.
    kit.add(kit.accent, kit.rb(0.96, 0.03, 0.22, 0.012), 0, 0.82, 0.8, -0.24, 0, 0);
    kit.add(kit.accent, kit.rb(0.96, 0.025, 0.16, 0.01), 0, 0.66, 0.82, -0.12, 0, 0);
    kit.addMany(kit.dark, kit.box(0.025, 0.34, 0.3), [
      [0.48, 0.72, 0.8, 0, 0, 0, 1, 1, 1],
      [-0.48, 0.72, 0.8, 0, 0, 0, 1, 1, 1],
    ]);
    // Airbox behind the driver's head, and a stripe down the nose.
    kit.add(kit.body, kit.rb(0.2, 0.2, 0.34, 0.06), 0, 0.9, 0.6);
    kit.add(kit.dark, kit.box(0.13, 0.11, 0.02), 0, 0.91, 0.425);
    // Engine cover fin tying the airbox down to the tail.
    kit.add(kit.body, kit.rb(0.07, 0.36, 0.5, 0.03), 0, 0.66, 0.66, -0.3, 0, 0);
    kit.add(kit.accent, kit.box(0.05, 0.012, 0.9), 0, 0.42, -0.5, -0.17, 0, 0);
  },
};

/** Loco Lou — a steam locomotive: boiler out front, funnel, brass dome, cowcatcher, cab roof. */
const lou: KartBodySpec = {
  wheels: { front: { r: 0.9, w: 1.1 }, rear: { r: 1.3, w: 1.3 } },
  lift: 0.02,
  engine: false,
  // The funnel is the exhaust: boost flames come out of the top of it.
  exhausts: [{ x: 0, y: 0.92, z: -0.74, rx: -Math.PI / 2, length: 0.16 }],
  plates: { front: { y: 0.5, z: -1.0 }, side: { x: 0.385, y: 0.27, z: 0.1 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.74, 0.14, 1.72, 0.04), 0, 0.24, 0.0);
    // Boiler and smokebox door.
    kit.add(kit.body, kit.cyl(0.27, 0.27, 0.98, 18), 0, 0.5, -0.47, Math.PI / 2, 0, 0);
    kit.add(kit.dark, kit.cyl(0.25, 0.25, 0.04, 18), 0, 0.5, -0.975, Math.PI / 2, 0, 0);
    kit.add(kit.accent, kit.sphere(0.06, 10, 8), 0, 0.5, -1.0);
    // Boiler bands.
    kit.addMany(kit.accent, kit.torus(0.275, 0.018, Math.PI * 2, 6, 24), [
      [0, 0.5, -0.2, 0, 0, 0, 1, 1, 1],
      [0, 0.5, -0.52, 0, 0, 0, 1, 1, 1],
      [0, 0.5, -0.84, 0, 0, 0, 1, 1, 1],
    ]);
    // Funnel with a flared brass cap, steam dome behind it.
    kit.add(kit.dark, kit.cyl(0.07, 0.09, 0.26, 12), 0, 0.87, -0.74);
    kit.add(kit.accent, kit.cyl(0.13, 0.075, 0.08, 12), 0, 1.02, -0.74);
    kit.add(kit.accent, kit.sphere(0.1, 12, 8), 0, 0.77, -0.38);
    // Cowcatcher: a slatted wedge.
    kit.add(kit.dark, kit.box(0.74, 0.04, 0.3), 0, 0.2, -1.08, 0.75, 0, 0);
    kit.addMany(
      kit.accent,
      kit.box(0.03, 0.045, 0.32),
      [-0.3, -0.15, 0, 0.15, 0.3].map((x) => [x, 0.21, -1.085, 0.75, 0, 0, 1, 1, 1]),
    );
    // Cab: side sheets, four posts, a roof.
    kit.addMany(kit.body, kit.rb(0.05, 0.3, 0.6, 0.02), [
      [0.38, 0.45, 0.42, 0, 0, 0, 1, 1, 1],
      [-0.38, 0.45, 0.42, 0, 0, 0, 1, 1, 1],
    ]);
    for (const sx of [-1, 1]) {
      kit.add(kit.dark, kit.tube(sx * 0.38, 0.58, 0.14, sx * 0.38, 1.24, 0.14, 0.02));
      kit.add(kit.dark, kit.tube(sx * 0.38, 0.58, 0.7, sx * 0.38, 1.24, 0.7, 0.02));
    }
    kit.add(kit.accent, kit.rb(0.9, 0.05, 0.76, 0.02), 0, 1.27, 0.42);
    // Coal bunker.
    kit.add(kit.dark, kit.rb(0.62, 0.2, 0.22, 0.03), 0, 0.42, 0.78);
  },
};

/** Dozer Dot — a bulldozer: blade out front on push arms, track pods over the wheels, roll frame. */
const dot: KartBodySpec = {
  wheels: { front: { r: 1.0, w: 1.3 }, rear: { r: 1.0, w: 1.3 } },
  lift: 0.03,
  engine: false,
  exhausts: [{ x: 0.2, y: 0.56, z: -0.5, rx: -Math.PI / 2, length: 0.42 }],
  plates: { front: { y: 0.34, z: -1.13 }, side: { x: 0.695, y: 0.3, z: 0 } },
  build(kit) {
    kit.add(kit.body, kit.rb(0.72, 0.3, 1.02, 0.05), 0, 0.39, 0.22);
    kit.add(kit.body, kit.rb(0.56, 0.24, 0.52, 0.04), 0, 0.42, -0.5);
    // Track pods: a guard over each side with a tread band under it.
    kit.addMany(kit.dark, kit.rb(0.3, 0.1, 1.5, 0.04), [
      [0.53, 0.44, 0, 0, 0, 0, 1, 1, 1],
      [-0.53, 0.44, 0, 0, 0, 0, 1, 1, 1],
    ]);
    kit.addMany(kit.dark, kit.rb(0.04, 0.26, 1.46, 0.02), [
      [0.67, 0.3, 0, 0, 0, 0, 1, 1, 1],
      [-0.67, 0.3, 0, 0, 0, 0, 1, 1, 1],
    ]);
    // Blade and push arms.
    kit.add(kit.accent, kit.rb(1.36, 0.44, 0.07, 0.03), 0, 0.33, -1.08, -0.18, 0, 0);
    kit.add(kit.dark, kit.box(1.36, 0.05, 0.1), 0, 0.1, -1.1);
    for (const sx of [-1, 1]) {
      kit.add(kit.dark, kit.tube(sx * 0.42, 0.3, -0.3, sx * 0.42, 0.26, -1.04, 0.03));
      kit.add(kit.chrome, kit.tube(sx * 0.3, 0.52, -0.62, sx * 0.3, 0.42, -1.02, 0.02));
    }
    // Roll frame with a beacon.
    for (const sx of [-1, 1]) {
      kit.add(kit.dark, kit.tube(sx * 0.36, 0.52, 0.52, sx * 0.36, 1.2, 0.5, 0.03));
      kit.add(kit.dark, kit.tube(sx * 0.36, 1.2, 0.5, sx * 0.36, 1.2, 0.02, 0.03));
    }
    kit.add(kit.dark, kit.tube(-0.36, 1.2, 0.5, 0.36, 1.2, 0.5, 0.03));
    kit.add(kit.dark, kit.tube(-0.36, 1.2, 0.02, 0.36, 1.2, 0.02, 0.03));
    kit.add(kit.accent, kit.cyl(0.06, 0.06, 0.09, 10), 0, 1.27, 0.26);
    // Hazard chevrons on the back.
    kit.addMany(
      kit.accent,
      kit.box(0.09, 0.3, 0.012),
      [-0.24, -0.08, 0.08, 0.24].map((x) => [x, 0.39, 0.735, 0, 0, 0.6, 1, 1, 1]),
    );
  },
};

/** Side profile of a ship's hull: raised bow, low waist where the seat is, tall stern castle. */
function hullShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.8, 0.16);
  s.lineTo(0.72, 0.16);
  s.quadraticCurveTo(1.0, 0.2, 1.14, 0.52); // stem sweeping up to the prow
  s.lineTo(0.98, 0.52);
  s.quadraticCurveTo(0.8, 0.4, 0.5, 0.4); // foredeck
  s.lineTo(0.1, 0.36);
  s.lineTo(-0.36, 0.36); // waist
  s.lineTo(-0.42, 0.6);
  s.lineTo(-0.86, 0.66); // stern castle
  s.quadraticCurveTo(-0.92, 0.4, -0.8, 0.16);
  return s;
}

/** Captain Brine (premium) — a pirate ship: plank hull, mast and sail at the stern, bowsprit, guns. */
const brine: KartBodySpec = {
  wheels: { front: { r: 1.05, w: 1.2 }, rear: { r: 1.15, w: 1.3 } },
  lift: 0.02,
  engine: false,
  // Stern chasers: boost flames come out of the two guns at the back.
  exhausts: [
    { x: -0.2, y: 0.4, z: 0.86, rx: -0.05, length: 0.22 },
    { x: 0.2, y: 0.4, z: 0.86, rx: -0.05, length: 0.22 },
  ],
  plates: { front: { y: 0.3, z: -0.98 }, side: { x: 0.375, y: 0.28, z: 0.05 } },
  build(kit) {
    const width = (z: number) => lerp(0.12, 1, smoothstep(-1.16, -0.35, z)) * lerp(1, 0.9, smoothstep(0.4, 0.9, z));
    kit.add(kit.body, kit.profile(hullShape(), 0.74, width));
    // Gunwale stripe and the planking line below it.
    kit.addMany(kit.accent, kit.rb(0.03, 0.05, 1.2, 0.01), [
      [0.385, 0.37, 0.1, 0, 0, 0, 1, 1, 1],
      [-0.385, 0.37, 0.1, 0, 0, 0, 1, 1, 1],
    ]);
    // Broadside guns.
    kit.addMany(kit.dark, kit.cyl(0.045, 0.055, 0.2, 10), [
      [0.44, 0.29, -0.2, 0, 0, Math.PI / 2, 1, 1, 1],
      [-0.44, 0.29, -0.2, 0, 0, Math.PI / 2, 1, 1, 1],
      [0.44, 0.29, 0.34, 0, 0, Math.PI / 2, 1, 1, 1],
      [-0.44, 0.29, 0.34, 0, 0, Math.PI / 2, 1, 1, 1],
    ]);
    // Bowsprit.
    kit.add(kit.dark, kit.tube(0, 0.5, -0.98, 0, 0.66, -1.42, 0.024));
    // Mast at the stern (behind the driver, so the sail never hides the road), yard, sail, pennant.
    kit.add(kit.dark, kit.tube(0, 0.6, 0.66, 0, 1.36, 0.66, 0.03));
    kit.add(kit.dark, kit.tube(-0.36, 1.2, 0.66, 0.36, 1.2, 0.66, 0.02));
    // A square sail, bellied forward a little by two angled halves.
    kit.add(kit.accent, kit.box(0.34, 0.5, 0.02), 0.165, 0.93, 0.61, 0, 0.22, 0);
    kit.add(kit.accent, kit.box(0.34, 0.5, 0.02), -0.165, 0.93, 0.61, 0, -0.22, 0);
    kit.add(kit.dark, kit.tube(-0.33, 0.68, 0.66, 0.33, 0.68, 0.66, 0.016));
    kit.add(kit.accent, kit.box(0.02, 0.09, 0.2), 0, 1.38, 0.78);
    // Stern lantern and rail.
    kit.add(kit.chrome, kit.sphere(0.055, 10, 8), 0, 0.75, 0.9);
    kit.add(kit.accent, kit.rb(0.62, 0.035, 0.035, 0.01), 0, 0.69, 0.86);
  },
};

export const KART_BODIES: Readonly<Record<string, KartBodySpec>> = {
  zippy, pixel, fennec, max, juno, kai, bram, rosa,
  tubby, coco, rusty, zorp, vera, lou, dot, brine,
};

export function getBodySpec(characterId: string): KartBodySpec {
  return KART_BODIES[characterId] ?? max;
}
