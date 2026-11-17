/**
 * Live 3D backdrop behind the menus: a frozen kart slowly turning on a low turntable that sits on
 * a start grid — dark asphalt, yellow grid boxes, a white start line and a checker band — under a
 * flat asphalt-coloured sky the floor fogs into. The camera orbits slowly. The framing mode
 * decides where the kart sits on screen so the DOM menus can be composed around it.
 *
 * Deliberately plain: no bokeh, no stars, no glowing rings. The kart is the only thing lit.
 */
import * as THREE from 'three';
import type { CharacterDef, IKart } from '../core/types';
import { damp } from '../core/math';
import { Kart } from '../kart/Kart';
import type { KartCosmetics } from '../core/cosmetics';
import { getCosmetics } from '../verse8/entitlements';

export type MenuFraming = 'title' | 'characters' | 'tracks';

interface FramingSpec {
  /** Horizontal camera distance from the kart (m). */
  distance: number;
  /** Camera height above the kart focus point (m). */
  height: number;
  fov: number;
  /** Desired NDC position (-1..1) of the kart focus point on screen. */
  sx: number;
  sy: number;
}

const FRAMINGS: Record<MenuFraming, FramingSpec> = {
  title: { distance: 5.7, height: 1.0, fov: 30, sx: -0.42, sy: -0.3 },
  characters: { distance: 5.3, height: 0.95, fov: 30, sx: 0.58, sy: -0.08 },
  tracks: { distance: 5.9, height: 0.85, fov: 30, sx: 0, sy: 0.42 },
};

/**
 * Portrait phones: the vertical FOV is fixed, so a tall viewport crops the sides and the kart
 * would fill the whole width behind the cards. Pull the camera back by 1/aspect and park the
 * kart low and centred, under the scrolling menus.
 */
const PORTRAIT_FRAMINGS: Record<MenuFraming, FramingSpec> = {
  title: { distance: 5.7, height: 1.0, fov: 30, sx: 0, sy: -0.32 },
  characters: { distance: 5.3, height: 0.95, fov: 30, sx: 0, sy: -0.62 },
  tracks: { distance: 5.9, height: 0.85, fov: 30, sx: 0, sy: -0.62 },
};
const PORTRAIT_MIN_ASPECT = 0.45;

const PODIUM_RADIUS = 1.55;
const PODIUM_HEIGHT = 0.14;
/** Height of the kart's visual centre above the turntable top. */
const KART_FOCUS_Y = 0.42;
const ORBIT_SPEED = 0.11;
const KART_SPIN = 0.22;
const FRAMING_LAMBDA = 3.2;
/** `--asphalt` in the stylesheet. Sky, fog and the far floor are all this one colour. */
const ASPHALT = 0x15161a;
const RACE_YELLOW = '#ffd400';
/** Painted start grid: a strip of track this wide and long (metres), centred on the kart. */
const GRID_WIDTH = 12;
const GRID_LENGTH = 48;

export class MenuBackdrop {
  readonly group = new THREE.Group();

  private kart: IKart | null = null;
  private currentId: string | null = null;
  private readonly kartHolder = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly fog = new THREE.FogExp2(ASPHALT, 0.03);
  private readonly background = new THREE.Color(ASPHALT);
  private envTexture: THREE.Texture | null = null;

  private framing: MenuFraming = 'title';
  private readonly cur: FramingSpec = { ...FRAMINGS.title };
  private angle = 0.7;
  private time = 0;

  private readonly origin = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private readonly focus = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly upv = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.group.name = 'MenuBackdrop';

    // Floor: matte asphalt that fogs into the flat sky colour -----------------------
    const floorGeo = new THREE.CircleGeometry(140, 72);
    const asphaltTex = this.makeAsphaltTexture();
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x5c5f66, roughness: 0.94, metalness: 0, map: asphaltTex, envMapIntensity: 0.2 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.005;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.disposables.push(floorGeo, floorMat, asphaltTex);

    // Start grid painted on the asphalt: yellow boxes, white start line, checker band ---
    const gridGeo = new THREE.PlaneGeometry(GRID_WIDTH, GRID_LENGTH);
    const gridTex = this.makeStartGridTexture();
    const gridMat = new THREE.MeshStandardMaterial({
      color: 0x8e9198,
      map: gridTex,
      transparent: true,
      depthWrite: false,
      roughness: 0.85,
      metalness: 0,
      envMapIntensity: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const grid = new THREE.Mesh(gridGeo, gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.002;
    grid.receiveShadow = true;
    this.group.add(grid);
    this.disposables.push(gridGeo, gridMat, gridTex);

    // Turntable: a low matte disc, just enough to lift the kart off the paint ----------
    const podiumMat = new THREE.MeshStandardMaterial({ color: 0x17181c, metalness: 0.1, roughness: 0.8, envMapIntensity: 0.3 });
    const podiumGeo = new THREE.CylinderGeometry(PODIUM_RADIUS, PODIUM_RADIUS + 0.06, PODIUM_HEIGHT, 72);
    const podium = new THREE.Mesh(podiumGeo, podiumMat);
    podium.position.y = PODIUM_HEIGHT / 2;
    podium.castShadow = true;
    podium.receiveShadow = true;
    this.group.add(podium);
    this.disposables.push(podiumGeo, podiumMat);

    // Lights -----------------------------------------------------------------------
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3.2, 6.5, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3.5;
    key.shadow.camera.right = 3.5;
    key.shadow.camera.top = 3.5;
    key.shadow.camera.bottom = -3.5;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.group.add(key, key.target);

    const top = new THREE.SpotLight(0xffffff, 9, 0, 0.55, 0.7, 2);
    top.position.set(0, 6.5, 0.5);
    top.target.position.set(0, PODIUM_HEIGHT, 0);
    this.group.add(top, top.target);

    // White key + a weak yellow fill. Same five lights as before (the count is what the kart's
    // shaders were compiled against), only their colours changed.
    const hemi = new THREE.HemisphereLight(0x8a8f9c, 0x101114, 0.55);
    this.group.add(hemi);
    const rimA = new THREE.PointLight(0xffffff, 10, 22, 2);
    rimA.position.set(-4.2, 1.9, -3.2);
    const rimB = new THREE.PointLight(0xffe9a0, 10, 22, 2);
    rimB.position.set(4.2, 1.5, -3.2);
    this.group.add(rimA, rimB);

    this.kartHolder.position.y = PODIUM_HEIGHT;
    this.group.add(this.kartHolder);
    this.focus.set(0, PODIUM_HEIGHT + KART_FOCUS_Y, 0);
  }

  /**
   * Swap the displayed kart to a character (no-op if unchanged), wearing the player's saved look.
   * The showcase is the first thing anyone sees after painting, so it has to reflect the garage.
   */
  setCharacter(def: CharacterDef): void {
    if (def.id === this.currentId) return;
    this.currentId = def.id;
    this.disposeKart();
    try {
      const kart: IKart = new Kart(0, def, true, getCosmetics());
      kart.setFrozen(true);
      kart.resetTo(this.origin, this.identity);
      kart.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      this.kartHolder.add(kart.object);
      this.kart = kart;
    } catch (err) {
      console.error('[MenuBackdrop] failed to build kart', err);
      this.kart = null;
    }
  }

  /** Where the kart should sit on screen for the current menu panel. */
  setFraming(mode: MenuFraming, immediate = false): void {
    this.framing = mode;
    if (immediate) Object.assign(this.cur, FRAMINGS[mode]);
  }

  attach(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer): void {
    scene.add(this.group);
    scene.fog = this.fog;
    scene.background = this.background;
    if (renderer && !this.envTexture) this.buildEnvironment(renderer);
    scene.environment = this.envTexture;
    Object.assign(this.cur, FRAMINGS[this.framing]);
    camera.fov = this.cur.fov;
    camera.updateProjectionMatrix();
    this.update(0, camera);
  }

  detach(scene: THREE.Scene): void {
    scene.remove(this.group);
    if (scene.fog === this.fog) scene.fog = null;
    if (scene.environment === this.envTexture) scene.environment = null;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.time += dt;
    this.angle += dt * ORBIT_SPEED;
    this.kartHolder.rotation.y += dt * KART_SPIN;

    if (this.kart) {
      this.kart.updateVisuals(dt);
      this.kart.object.position.copy(this.origin);
    }

    // Ease framing parameters toward the active mode.
    const portrait = camera.aspect < 1;
    const want = (portrait ? PORTRAIT_FRAMINGS : FRAMINGS)[this.framing];
    const c = this.cur;
    c.distance = damp(c.distance, want.distance, FRAMING_LAMBDA, dt);
    c.height = damp(c.height, want.height, FRAMING_LAMBDA, dt);
    c.fov = damp(c.fov, want.fov, FRAMING_LAMBDA, dt);
    c.sx = damp(c.sx, want.sx, FRAMING_LAMBDA, dt);
    c.sy = damp(c.sy, want.sy, FRAMING_LAMBDA, dt);

    const bob = Math.sin(this.time * 0.45) * 0.1;
    const f = this.focus;
    const distance = portrait ? c.distance / Math.max(PORTRAIT_MIN_ASPECT, camera.aspect) : c.distance;
    this.camPos.set(Math.sin(this.angle) * distance, f.y + c.height + bob, Math.cos(this.angle) * distance);

    // Place the kart focus point at NDC (sx, sy) by offsetting the look target in the
    // camera's own right/up directions.
    this.dir.subVectors(f, this.camPos);
    const dist = this.dir.length();
    this.dir.multiplyScalar(1 / Math.max(1e-6, dist));
    this.right.crossVectors(this.dir, this.worldUp).normalize();
    this.upv.crossVectors(this.right, this.dir);
    const halfH = dist * Math.tan((c.fov * Math.PI) / 360);
    const halfW = halfH * Math.max(0.1, camera.aspect);
    this.target.copy(f).addScaledVector(this.right, -c.sx * halfW).addScaledVector(this.upv, -c.sy * halfH);

    camera.position.copy(this.camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    if (Math.abs(camera.fov - c.fov) > 0.01) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.disposeKart();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    if (this.envTexture) {
      this.envTexture.dispose();
      this.envTexture = null;
    }
    this.group.clear();
  }

  // ----------------------------------------------------------------- private

  /** Repaints the showcase kart in place — called when the garage saves. */
  applyCosmetics(cos: KartCosmetics): void {
    this.kart?.applyCosmetics?.(cos);
  }

  private disposeKart(): void {
    if (!this.kart) return;
    this.kartHolder.remove(this.kart.object);
    try {
      this.kart.dispose();
    } catch (err) {
      console.warn('[MenuBackdrop] kart dispose failed', err);
    }
    this.kart = null;
  }

  /**
   * Small PMREM environment (flat dark sky + three soft light cards) for the kart's paint.
   * The cards are grey, not white: white ones put highlights on the chrome hot enough to bloom.
   */
  private buildEnvironment(renderer: THREE.WebGLRenderer): void {
    let pmrem: THREE.PMREMGenerator | null = null;
    try {
      pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(ASPHALT);
      const cardMat = (c: number) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, fog: false });
      const cardGeo = new THREE.PlaneGeometry(12, 5);
      const cardA = new THREE.Mesh(cardGeo, cardMat(0x8f9299));
      cardA.position.set(-6, 9, 4);
      cardA.lookAt(0, 0, 0);
      const cardB = new THREE.Mesh(cardGeo, cardMat(0x9c8f62));
      cardB.position.set(7, 7, -3);
      cardB.lookAt(0, 0, 0);
      const cardC = new THREE.Mesh(cardGeo, cardMat(0xa4a7ae));
      cardC.position.set(0, 12, 0);
      cardC.lookAt(0, 0, 0);
      envScene.add(cardA, cardB, cardC);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 24), new THREE.MeshBasicMaterial({ color: 0x0e0f12, fog: false }));
      floor.rotation.x = -Math.PI / 2;
      envScene.add(floor);
      const rt = pmrem.fromScene(envScene, 0.04, 0.5, 300);
      this.envTexture = rt.texture;
      cardGeo.dispose();
      (cardA.material as THREE.Material).dispose();
      (cardB.material as THREE.Material).dispose();
      (cardC.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
    } catch (err) {
      console.warn('[MenuBackdrop] environment map failed', err);
      this.envTexture = null;
    } finally {
      pmrem?.dispose();
    }
  }

  /** Tiling asphalt: a dark base with fine aggregate speckle. */
  private makeAsphaltTexture(): THREE.Texture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#2b2d33';
      ctx.fillRect(0, 0, size, size);
      // Deterministic speckle so the floor looks the same on every visit.
      let seed = 1337;
      const rnd = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 5200; i++) {
        const v = rnd();
        const shade = v < 0.5 ? 30 + Math.floor(v * 30) : 52 + Math.floor(v * 34);
        ctx.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
        const r = 0.6 + rnd() * 1.1;
        ctx.fillRect(rnd() * size, rnd() * size, r, r);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * The paint on the asphalt, on a transparent canvas: white lane edges, a white start line with
   * a checker band ahead of it, the kart's own yellow grid box, and staggered boxes behind it.
   * Canvas x spans GRID_WIDTH, canvas y spans GRID_LENGTH; the kart stands at the centre.
   */
  private makeStartGridTexture(): THREE.Texture {
    const w = 512;
    const h = 2048;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) {
      const px = w / GRID_WIDTH; // pixels per metre (same on both axes)
      const X = (m: number): number => w / 2 + m * px;
      const Y = (m: number): number => h / 2 + m * px;
      const rect = (x0: number, y0: number, x1: number, y1: number): void => {
        ctx.fillRect(X(x0), Y(y0), (x1 - x0) * px, (y1 - y0) * px);
      };
      const lane = 4.6; // half width of the painted lane
      const line = 0.15;

      // Lane edges.
      ctx.fillStyle = '#e9ebef';
      rect(-lane - line, -GRID_LENGTH / 2, -lane, GRID_LENGTH / 2);
      rect(lane, -GRID_LENGTH / 2, lane + line, GRID_LENGTH / 2);

      // Checker band, then the start line, ahead of the kart (negative y).
      const sq = 0.46;
      const cols = Math.round((lane * 2) / sq);
      const cw = (lane * 2) / cols;
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < cols; i++) {
          ctx.fillStyle = (i + row) % 2 === 0 ? '#f4f5f7' : '#101114';
          rect(-lane + i * cw, -4.4 + row * sq, -lane + (i + 1) * cw, -4.4 + (row + 1) * sq);
        }
      }
      ctx.fillStyle = '#f4f5f7';
      rect(-lane, -3.3, lane, -2.95);

      // Grid boxes: a bar across the front and two short sides, open at the back.
      ctx.fillStyle = RACE_YELLOW;
      const box = (cx: number, front: number, half: number, depth: number): void => {
        rect(cx - half, front, cx + half, front + line);
        rect(cx - half, front, cx - half + line, front + depth);
        rect(cx + half - line, front, cx + half, front + depth);
      };
      box(0, -2.2, 1.95, 1.5); // the kart's own box, around the turntable
      for (let k = 0; k < 7; k++) box(k % 2 === 0 ? -2.35 : 2.35, 3.2 + k * 2.7, 1.6, 1.2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
