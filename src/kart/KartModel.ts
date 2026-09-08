/**
 * Procedural go-kart model. Cartoony-but-polished, faces local -Z, wheels rest
 * on y = 0. Everything is generated from primitives (no assets). Static parts
 * that share a material are merged into single meshes to keep draw calls low
 * (~20 per kart).
 *
 * The chassis / spoiler / trim silhouette comes from the character's body spec
 * (`bodies.ts`); this file owns materials and the parts every kart shares
 * (floor pan, engine, steering, seat, driver, wheels, plates, exhausts).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CharacterDef } from '../core/types';
import { createBodyKit, getBodySpec, type WheelSize } from './bodies';
import { Batch, addVertexColor, limbGeometry, makeMesh } from './modelUtils';
import { CHARACTERS } from './roster';

export interface KartModelParts {
  root: THREE.Group;
  body: THREE.Mesh;
  /** The four spinning wheel groups (rotate about local X). Order: FL, FR, RL, RR. */
  wheels: THREE.Object3D[];
  /** Steering pivots for the two front wheels (rotate about local Y). */
  frontWheels: THREE.Object3D[];
  /** Rotate about local Z to turn the steering wheel. */
  steeringWheel: THREE.Object3D;
  driver: THREE.Group;
  driverHead: THREE.Object3D;
  /** Exhaust pipe groups at the rear (local +Z is the pipe direction). */
  exhausts: THREE.Object3D[];
  bodyMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
}

/** Extra handles the Kart uses for animation; a structural subtype of KartModelParts. */
export interface KartModelPartsEx extends KartModelParts {
  /** Emissive material on the exhaust tips (flickers while boosting). */
  exhaustGlowMaterial: THREE.MeshStandardMaterial;
  /** Wheel radii matching `wheels` order (for spin speed). */
  wheelRadii: number[];
  /** Disposes every geometry, material and texture owned by this model. */
  dispose(): void;
}

// --- dimensions -------------------------------------------------------------
const WHEEL_R_F = 0.2;
const WHEEL_R_R = 0.22;
const WHEEL_W_F = 0.18;
const WHEEL_W_R = 0.22;
const WHEEL_X = 0.52;
const WHEEL_Z_F = -0.52;
const WHEEL_Z_R = 0.5;
const BASE_PIPE_LENGTH = 0.28;

function makeNumberTexture(num: number, accent: number, color: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const accentCss = '#' + accent.toString(16).padStart(6, '0');
    const dark = new THREE.Color(color).multiplyScalar(0.28);
    const r = 22;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#f8f9fc';
    ctx.beginPath();
    ctx.roundRect(4, 4, size - 8, size - 8, r);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = accentCss;
    ctx.stroke();
    ctx.fillStyle = '#' + dark.getHexString();
    ctx.font = 'bold 88px system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), size / 2, size / 2 + 6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

interface WheelGeos {
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
}

function buildWheelGeometry(radius: number, width: number): WheelGeos {
  const tube = width * 0.5;
  const tyreBatch = new Batch();
  const torus = addVertexColor(new THREE.TorusGeometry(radius - tube, tube, 8, 16), 0x15151a);
  tyreBatch.add(torus, 0, 0, 0, 0, Math.PI / 2, 0);
  torus.dispose();
  const tread = addVertexColor(
    new THREE.CylinderGeometry(radius * 1.005, radius * 1.005, width * 0.42, 22, 1, true),
    0x2c2c33,
  );
  tyreBatch.add(tread, 0, 0, 0, 0, 0, Math.PI / 2);
  tread.dispose();

  const rimBatch = new Batch();
  const rimR = radius * 0.58;
  const rimW = width * 0.72;
  const rim = new THREE.CylinderGeometry(rimR, rimR, rimW, 14);
  rimBatch.add(rim, 0, 0, 0, 0, 0, Math.PI / 2);
  rim.dispose();
  const spoke = new THREE.BoxGeometry(rimW + 0.03, radius * 0.5, 0.035);
  spoke.translate(0, radius * 0.3, 0);
  for (let i = 0; i < 5; i++) {
    rimBatch.add(spoke, 0, 0, 0, (i / 5) * Math.PI * 2, 0, 0);
  }
  spoke.dispose();
  const hub = new THREE.SphereGeometry(radius * 0.22, 10, 7);
  rimBatch.add(hub, 0, 0, 0, 0, 0, 0, 1.6, 1, 1);
  hub.dispose();

  return { tyre: tyreBatch.build(), rim: rimBatch.build() };
}

export function buildKartModel(character: CharacterDef): KartModelPartsEx {
  const spec = getBodySpec(character.id);
  const lift = spec.lift;
  const root = new THREE.Group();
  root.name = `kart-${character.id}`;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.add(g);
    return g;
  };
  const mat = <T extends THREE.Material>(m: T): T => {
    materials.add(m);
    return m;
  };

  // --- materials -----------------------------------------------------------
  const bodyMaterial = mat(
    new THREE.MeshPhysicalMaterial({
      color: character.color,
      metalness: 0.2,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  const accentMaterial = mat(
    new THREE.MeshStandardMaterial({
      color: character.accent,
      metalness: 0.45,
      roughness: 0.3,
      emissive: character.accent,
      emissiveIntensity: 0.32,
    }),
  );
  // Scenes have no environment map, so pure metals fake their ambient reflection with a grey emissive.
  const chrome = mat(
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.18, emissive: 0x4a5058, emissiveIntensity: 1 }),
  );
  const darkMetal = mat(new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.55, roughness: 0.5 }));
  const rubber = mat(new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.9, metalness: 0.05 }));
  const tyreMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  const rimMat = mat(
    new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.7, roughness: 0.3, emissive: 0x2a2e34, emissiveIntensity: 1 }),
  );
  const seatMat = mat(
    new THREE.MeshStandardMaterial({ color: 0x1c1c23, roughness: 0.88, metalness: 0.05, side: THREE.DoubleSide }),
  );
  const suitMat = mat(new THREE.MeshStandardMaterial({ color: character.color, roughness: 0.62, metalness: 0.08 }));
  const helmetMat = mat(
    new THREE.MeshPhysicalMaterial({
      color: character.driverColor,
      metalness: 0.15,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
  );
  const visorMat = mat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0a1424,
      metalness: 0.55,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    }),
  );
  const exhaustGlowMaterial = mat(
    new THREE.MeshStandardMaterial({
      color: 0x120805,
      emissive: 0xff7a1a,
      emissiveIntensity: 0,
      roughness: 0.6,
    }),
  );
  const number = Math.max(1, CHARACTERS.indexOf(character) + 1);
  const plateTex = makeNumberTexture(number, character.accent, character.color);
  textures.add(plateTex);
  const plateMat = mat(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.45, metalness: 0.05 }));

  // --- body spec: chassis, spoiler, trim (into the four shared batches) -------
  const bodyBatch = new Batch();
  const accentBatch = new Batch();
  const darkBatch = new Batch();
  const chromeBatch = new Batch();
  spec.build(createBodyKit(bodyBatch, accentBatch, darkBatch, chromeBatch));
  const body = makeMesh(track(bodyBatch.build()), bodyMaterial, 'body');
  body.receiveShadow = true;
  root.add(body);

  // --- dark metal parts ----------------------------------------------------
  const floorPan = new RoundedBoxGeometry(0.98, 0.06, 1.34, 1, 0.02);
  darkBatch.add(floorPan, 0, 0.13, -0.02);
  floorPan.dispose();
  const mount = new THREE.BoxGeometry(0.04, 0.04, 0.14);
  darkBatch.add(mount, 0.17, 0.19, -0.76);
  darkBatch.add(mount, -0.17, 0.19, -0.76);
  mount.dispose();
  const column = limbGeometry(0, 0.46 + lift, -0.3, 0, 0.6 + lift, -0.08, 0.022, 8);
  darkBatch.add(column);
  column.dispose();
  if (spec.engine) {
    const engine = new RoundedBoxGeometry(0.4, 0.24, 0.26, 1, 0.04);
    darkBatch.add(engine, 0, 0.55, 0.66);
    engine.dispose();
    const strut = new THREE.BoxGeometry(0.04, 0.26, 0.05);
    darkBatch.add(strut, 0.3, 0.575, 0.68);
    darkBatch.add(strut, -0.3, 0.575, 0.68);
    strut.dispose();
    const head = new RoundedBoxGeometry(0.3, 0.1, 0.16, 1, 0.03);
    chromeBatch.add(head, 0, 0.7, 0.64);
    head.dispose();
    const filter = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12);
    chromeBatch.add(filter, -0.12, 0.7, 0.74, 0, 0, Math.PI / 2);
    filter.dispose();
  }
  root.add(makeMesh(track(darkBatch.build()), darkMetal, 'darkParts'));
  if (!chromeBatch.isEmpty) root.add(makeMesh(track(chromeBatch.build()), chrome, 'chromeParts'));

  // --- exhausts (separate so they can flicker) ------------------------------
  const exhausts: THREE.Object3D[] = [];
  const pipeGeo = track(new THREE.CylinderGeometry(0.046, 0.052, BASE_PIPE_LENGTH, 12, 1, false));
  pipeGeo.translate(0, BASE_PIPE_LENGTH / 2, 0);
  pipeGeo.rotateX(Math.PI / 2);
  const glowGeo = track(new THREE.CircleGeometry(0.04, 12));
  glowGeo.translate(0, 0, BASE_PIPE_LENGTH + 0.003);
  for (const e of spec.exhausts) {
    const g = new THREE.Group();
    g.name = 'exhaust';
    g.position.set(e.x, e.y, e.z);
    g.rotation.x = e.rx;
    // Longer pipes (vertical stacks) stretch along the pipe axis only; the glow disc is flat in XY.
    g.scale.z = e.length / BASE_PIPE_LENGTH;
    g.add(makeMesh(pipeGeo, chrome, 'pipe'));
    const glow = makeMesh(glowGeo, exhaustGlowMaterial, 'exhaustGlow');
    glow.castShadow = false;
    g.add(glow);
    root.add(g);
    exhausts.push(g);
  }

  // --- accent parts: spec trim + driver gloves -------------------------------
  const glove = new THREE.SphereGeometry(0.05, 8, 6);
  accentBatch.add(glove, 0.13, 0.605 + lift, -0.08);
  accentBatch.add(glove, -0.13, 0.605 + lift, -0.08);
  glove.dispose();
  root.add(makeMesh(track(accentBatch.build()), accentMaterial, 'accentParts'));

  // --- number plates -------------------------------------------------------
  const plateBatch = new Batch();
  const frontPlate = new THREE.PlaneGeometry(0.22, 0.16);
  plateBatch.add(frontPlate, 0, spec.plates.front.y, spec.plates.front.z, 0.08, Math.PI, 0);
  frontPlate.dispose();
  const sidePlate = new THREE.PlaneGeometry(0.18, 0.11);
  const sp = spec.plates.side;
  plateBatch.add(sidePlate, sp.x, sp.y, sp.z, 0, Math.PI / 2, 0);
  plateBatch.add(sidePlate, -sp.x, sp.y, sp.z, 0, -Math.PI / 2, 0);
  sidePlate.dispose();
  const plates = makeMesh(track(plateBatch.build()), plateMat, 'plates');
  plates.castShadow = false;
  root.add(plates);

  // --- seat ----------------------------------------------------------------
  const seatBatch = new Batch();
  const seatBack = new THREE.CylinderGeometry(0.23, 0.21, 0.42, 14, 1, true, -Math.PI / 2, Math.PI);
  seatBatch.add(seatBack, 0, 0.57 + lift, 0.3, 0.12, 0, 0);
  seatBack.dispose();
  const seatBase = new RoundedBoxGeometry(0.46, 0.09, 0.4, 1, 0.03);
  seatBatch.add(seatBase, 0, 0.37 + lift, 0.16);
  seatBase.dispose();
  const headrest = new RoundedBoxGeometry(0.2, 0.12, 0.08, 1, 0.03);
  seatBatch.add(headrest, 0, 0.84 + lift, 0.4);
  headrest.dispose();
  root.add(makeMesh(track(seatBatch.build()), seatMat, 'seat'));

  // --- steering wheel --------------------------------------------------------
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0.61 + lift, -0.07);
  steerPivot.rotation.x = -0.53;
  const steeringWheel = new THREE.Group();
  steeringWheel.name = 'steeringWheel';
  const wheelBatch = new Batch();
  const ring = new THREE.TorusGeometry(0.13, 0.022, 6, 20);
  wheelBatch.add(ring);
  ring.dispose();
  const hubGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12);
  wheelBatch.add(hubGeo, 0, 0, 0, Math.PI / 2, 0, 0);
  hubGeo.dispose();
  const spokeGeo = new THREE.BoxGeometry(0.03, 0.11, 0.015);
  spokeGeo.translate(0, 0.07, 0);
  for (const a of [Math.PI, Math.PI / 6, -Math.PI / 6]) {
    wheelBatch.add(spokeGeo, 0, 0, 0, 0, 0, a);
  }
  spokeGeo.dispose();
  steeringWheel.add(makeMesh(track(wheelBatch.build()), rubber, 'steeringWheelMesh'));
  steerPivot.add(steeringWheel);
  root.add(steerPivot);

  // --- wheels ----------------------------------------------------------------
  const sized = (base: number, baseW: number, s: WheelSize) => ({ r: base * s.r, w: baseW * s.w });
  const frontSize = sized(WHEEL_R_F, WHEEL_W_F, spec.wheels.front);
  const rearSize = sized(WHEEL_R_R, WHEEL_W_R, spec.wheels.rear);
  const frontGeos = buildWheelGeometry(frontSize.r, frontSize.w);
  const rearGeos = buildWheelGeometry(rearSize.r, rearSize.w);
  track(frontGeos.tyre);
  track(frontGeos.rim);
  track(rearGeos.tyre);
  track(rearGeos.rim);
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wheelRadii: number[] = [];
  const makeWheel = (geos: WheelGeos, radius: number, x: number, z: number, isFront: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, radius, z);
    const spin = new THREE.Group();
    spin.name = 'wheel';
    spin.add(makeMesh(geos.tyre, tyreMat, 'tyre'));
    spin.add(makeMesh(geos.rim, rimMat, 'rim'));
    pivot.add(spin);
    root.add(pivot);
    wheels.push(spin);
    wheelRadii.push(radius);
    if (isFront) frontWheels.push(pivot);
  };
  makeWheel(frontGeos, frontSize.r, -WHEEL_X, WHEEL_Z_F, true);
  makeWheel(frontGeos, frontSize.r, WHEEL_X, WHEEL_Z_F, true);
  makeWheel(rearGeos, rearSize.r, -WHEEL_X, WHEEL_Z_R, false);
  makeWheel(rearGeos, rearSize.r, WHEEL_X, WHEEL_Z_R, false);

  // --- driver ------------------------------------------------------------------
  // Pivot at the hips so leaning rotates the whole upper body.
  const driver = new THREE.Group();
  driver.name = 'driver';
  driver.position.set(0, 0.41 + lift, 0.18);
  const suitBatch = new Batch();
  const torso = new THREE.CapsuleGeometry(0.15, 0.1, 3, 12);
  suitBatch.add(torso, 0, 0.2, 0.02, 0, 0, 0, 1.1, 1, 0.75);
  torso.dispose();
  const shoulder = new THREE.SphereGeometry(0.075, 8, 6);
  suitBatch.add(shoulder, 0.2, 0.33, 0.02);
  suitBatch.add(shoulder, -0.2, 0.33, 0.02);
  shoulder.dispose();
  for (const sx of [-1, 1]) {
    const upper = limbGeometry(sx * 0.2, 0.33, 0.02, sx * 0.21, 0.2, -0.13, 0.05);
    suitBatch.add(upper);
    upper.dispose();
    const fore = limbGeometry(sx * 0.21, 0.2, -0.13, sx * 0.13, 0.195, -0.26, 0.045);
    suitBatch.add(fore);
    fore.dispose();
    const thigh = limbGeometry(sx * 0.1, 0.02, -0.02, sx * 0.13, -0.03, -0.34, 0.06);
    suitBatch.add(thigh);
    thigh.dispose();
  }
  const neck = new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8);
  suitBatch.add(neck, 0, 0.36, 0.02);
  neck.dispose();
  driver.add(makeMesh(track(suitBatch.build()), suitMat, 'suit'));

  const driverHead = new THREE.Group();
  driverHead.name = 'driverHead';
  driverHead.position.set(0, 0.4, 0.02);
  const helmetGeo = track(new THREE.SphereGeometry(0.155, 16, 12));
  helmetGeo.translate(0, 0.14, 0);
  driverHead.add(makeMesh(helmetGeo, helmetMat, 'helmet'));
  const visorGeo = track(
    new THREE.SphereGeometry(0.16, 12, 6, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.26),
  );
  visorGeo.translate(0, 0.14, 0);
  const visor = makeMesh(visorGeo, visorMat, 'visor');
  visor.castShadow = false;
  driverHead.add(visor);
  const stripeGeo = track(new THREE.TorusGeometry(0.152, 0.012, 5, 20, Math.PI * 1.1));
  stripeGeo.rotateZ(-Math.PI * 0.05);
  stripeGeo.rotateY(Math.PI / 2);
  stripeGeo.translate(0, 0.14, 0);
  const stripe = makeMesh(stripeGeo, accentMaterial, 'helmetStripe');
  stripe.castShadow = false;
  driverHead.add(stripe);
  driver.add(driverHead);
  root.add(driver);

  const dispose = () => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    geometries.clear();
    materials.clear();
    textures.clear();
    root.removeFromParent();
  };

  return {
    root,
    body,
    wheels,
    frontWheels,
    steeringWheel,
    driver,
    driverHead,
    exhausts,
    bodyMaterial,
    accentMaterial,
    exhaustGlowMaterial,
    wheelRadii,
    dispose,
  };
}
