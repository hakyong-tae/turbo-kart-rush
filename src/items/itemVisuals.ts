/**
 * Procedural item visuals: 64x64 Canvas2D HUD icons and low-poly 3D meshes.
 * Everything is generated in code (no asset files). Geometries, materials and
 * textures are cached module-wide and shared between mesh instances.
 */
import * as THREE from 'three';
import type { ItemType } from '../core/types';
import { TAU } from '../core/math';

// ---------------------------------------------------------------------------
// Icons (Canvas2D)
// ---------------------------------------------------------------------------

const ICON_SIZE = 64;
const iconCache = new Map<ItemType, HTMLCanvasElement>();

/** Returns a cached 64x64 canvas icon for the HUD item slot / roulette. */
export function buildItemIcon(item: ItemType): HTMLCanvasElement {
  const cached = iconCache.get(item);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawIcon(ctx, item);
  }
  iconCache.set(item, canvas);
  return canvas;
}

function drawIcon(ctx: CanvasRenderingContext2D, item: ItemType): void {
  const c = ICON_SIZE / 2;
  switch (item) {
    case 'none':
      return;
    case 'banana':
      drawBanana(ctx, c, c + 1, 1);
      return;
    case 'triple_banana':
      drawBanana(ctx, c - 15, c - 10, 0.52);
      drawBanana(ctx, c + 15, c - 10, 0.52);
      drawBanana(ctx, c, c + 13, 0.52);
      return;
    case 'green_shell':
      drawShell(ctx, c, c, 1, '#2fd24a', '#0f6b22', false);
      return;
    case 'red_shell':
      drawShell(ctx, c, c, 1, '#ff3b30', '#8a1410', false);
      return;
    case 'blue_shell':
      drawShell(ctx, c, c, 1, '#2f7bff', '#12348f', true);
      return;
    case 'triple_green_shell':
      drawTriple(ctx, (x, y, s) => drawShell(ctx, x, y, s, '#2fd24a', '#0f6b22', false));
      return;
    case 'triple_red_shell':
      drawTriple(ctx, (x, y, s) => drawShell(ctx, x, y, s, '#ff3b30', '#8a1410', false));
      return;
    case 'nitro':
      drawNitro(ctx, c, c, 1);
      return;
    case 'triple_nitro':
      drawTriple(ctx, (x, y, s) => drawNitro(ctx, x, y, s));
      return;
    case 'overdrive':
      drawOverdrive(ctx, c, c, 1);
      return;
    case 'star':
      drawStar(ctx, c, c, 1);
      return;
    case 'lightning':
      drawLightning(ctx, c, c, 1);
      return;
    case 'bob_omb':
      drawBobOmb(ctx, c, c, 1);
      return;
    case 'magnet':
      drawMagnet(ctx, c, c, 1);
      return;
  }
}

/** Horseshoe magnet: red arc with grey pole tips. */
function drawMagnet(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 15;
  ctx.strokeStyle = '#4a0c14';
  ctx.beginPath();
  ctx.arc(0, -4, 16, Math.PI, 0);
  ctx.moveTo(-16, -4);
  ctx.lineTo(-16, 16);
  ctx.moveTo(16, -4);
  ctx.lineTo(16, 16);
  ctx.stroke();
  ctx.lineWidth = 11;
  ctx.strokeStyle = '#ff3b4a';
  ctx.beginPath();
  ctx.arc(0, -4, 16, Math.PI, 0);
  ctx.moveTo(-16, -4);
  ctx.lineTo(-16, 8);
  ctx.moveTo(16, -4);
  ctx.lineTo(16, 8);
  ctx.stroke();
  ctx.strokeStyle = '#d9dee6';
  ctx.beginPath();
  ctx.moveTo(-16, 8);
  ctx.lineTo(-16, 16);
  ctx.moveTo(16, 8);
  ctx.lineTo(16, 16);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -4, 19, Math.PI * 1.15, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();
}

function drawTriple(ctx: CanvasRenderingContext2D, fn: (x: number, y: number, s: number) => void): void {
  const c = ICON_SIZE / 2;
  fn(c - 15, c - 9, 0.5);
  fn(c + 15, c - 9, 0.5);
  fn(c, c + 13, 0.5);
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

function drawBanana(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.rotate(-0.35);
  // A shallow crescent (not a boomerang): long, fat body that tapers toward the blossom end.
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-21, -1);
    ctx.quadraticCurveTo(-2, 14, 21, -3);
  };
  ctx.lineCap = 'round';
  path();
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#4a3208';
  ctx.stroke();
  path();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffd83a';
  ctx.stroke();
  // Ridge highlight along the outer edge.
  ctx.beginPath();
  ctx.moveTo(-15, -3);
  ctx.quadraticCurveTo(-2, 8, 15, -3);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();
  // Stem (thick, brown) at one end, small dark blossom tip at the other.
  ctx.strokeStyle = '#6b4a12';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-20, -1);
  ctx.lineTo(-25, -6);
  ctx.stroke();
  ctx.fillStyle = '#3a2608';
  ctx.beginPath();
  ctx.arc(21.5, -3.5, 2.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawShell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  color: string,
  dark: string,
  spiky: boolean,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineWidth = 2.5;
  // underside body
  ctx.fillStyle = '#f5ead0';
  ctx.strokeStyle = '#3a2a10';
  ellipse(ctx, 0, 10, 23, 8);
  ctx.fill();
  ctx.stroke();
  // spikes behind the dome
  if (spiky) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3a3a3a';
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (Math.PI * (i + 0.5)) / 5;
      const bx = Math.cos(a) * 17;
      const by = 6 + Math.sin(a) * 17;
      const tx = Math.cos(a) * 28;
      const ty = 6 + Math.sin(a) * 28;
      const px = -Math.sin(a) * 4;
      const py = Math.cos(a) * 4;
      ctx.beginPath();
      ctx.moveTo(bx + px, by + py);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx - px, by - py);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  // dome
  ctx.beginPath();
  ctx.ellipse(0, 6, 22, 21, 0, Math.PI, TAU);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.stroke();
  // hex plate lines
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 6, 22, 21, 0, Math.PI, TAU);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-8, -15);
  ctx.lineTo(-11, -4);
  ctx.lineTo(-4, 2);
  ctx.lineTo(4, 2);
  ctx.lineTo(11, -4);
  ctx.lineTo(8, -15);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-11, -4);
  ctx.lineTo(-19, -1);
  ctx.moveTo(11, -4);
  ctx.lineTo(19, -1);
  ctx.moveTo(-4, 2);
  ctx.lineTo(-6, 9);
  ctx.moveTo(4, 2);
  ctx.lineTo(6, 9);
  ctx.stroke();
  ctx.restore();
  // white rim
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#3a2a10';
  ctx.lineWidth = 2;
  ellipse(ctx, 0, 6, 22.5, 5);
  ctx.fill();
  ctx.stroke();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ellipse(ctx, -9, -7, 5, 3);
  ctx.fill();
  ctx.restore();
}

/** Nitro can: a squat teal gas canister with a dark valve cap, gauge stripe and a flame badge. */
function drawNitro(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#10343a';
  // body
  const body = ctx.createLinearGradient(-14, 0, 14, 0);
  body.addColorStop(0, '#1fb2c9');
  body.addColorStop(0.45, '#7ff0ff');
  body.addColorStop(1, '#138aa0');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-14, -14, 28, 38, 7);
  ctx.fill();
  ctx.stroke();
  // neck + valve
  ctx.fillStyle = '#26343c';
  ctx.beginPath();
  ctx.roundRect(-7, -22, 14, 9, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff9a2e';
  ctx.beginPath();
  ctx.roundRect(-4, -27, 8, 6, 2);
  ctx.fill();
  // label band
  ctx.fillStyle = '#0c2a30';
  ctx.fillRect(-14, -3, 28, 12);
  ctx.fillStyle = '#ffe14a';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N₂O', 0, 3.5);
  // flame badge
  ctx.fillStyle = '#ff6a1a';
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.quadraticCurveTo(7, 15, 3, 21);
  ctx.quadraticCurveTo(1, 23, 0, 22);
  ctx.quadraticCurveTo(-1, 23, -3, 21);
  ctx.quadraticCurveTo(-7, 15, 0, 12);
  ctx.fill();
  // highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-9, -10);
  ctx.lineTo(-9, 18);
  ctx.stroke();
  ctx.restore();
}

/** Overdrive core: a gold hex reactor with an inner spinning ring — unlimited nitro for a while. */
function drawOverdrive(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const hex = (r: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 6;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, 30);
  glow.addColorStop(0, 'rgba(255,220,90,0.9)');
  glow.addColorStop(1, 'rgba(255,160,30,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-30, -30, 60, 60);
  const shell = ctx.createLinearGradient(-20, -20, 20, 20);
  shell.addColorStop(0, '#ffe680');
  shell.addColorStop(0.5, '#f2a91c');
  shell.addColorStop(1, '#b86a00');
  ctx.fillStyle = shell;
  ctx.strokeStyle = '#5a3400';
  ctx.lineWidth = 2.5;
  hex(22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a1600';
  hex(14);
  ctx.fill();
  // inner ring + core
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, -0.4, 2.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 2.7, 5.4);
  ctx.stroke();
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(1, '#ff9a2e');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const glow = ctx.createRadialGradient(0, 2, 4, 0, 2, 31);
  glow.addColorStop(0, 'rgba(255,236,120,0.95)');
  glow.addColorStop(0.55, 'rgba(255,210,60,0.35)');
  glow.addColorStop(1, 'rgba(255,200,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-32, -32, 64, 64);
  starPath(ctx, 0, 2, 26, 11.5);
  ctx.fillStyle = '#ffe23a';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#c47a00';
  ctx.stroke();
  starPath(ctx, -1, 0, 16, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  ctx.restore();
}

function drawLightning(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  // cloud
  ctx.fillStyle = '#4d5668';
  ctx.strokeStyle = '#1f2530';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(-13, -12, 10, 0, TAU);
  ctx.arc(1, -18, 12, 0, TAU);
  ctx.arc(15, -11, 10, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-23, -12, 46, 12, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-13, -12, 10, Math.PI * 0.75, Math.PI * 1.75);
  ctx.arc(1, -18, 12, Math.PI * 1.15, Math.PI * 1.95);
  ctx.arc(15, -11, 10, Math.PI * 1.3, Math.PI * 2.25);
  ctx.lineTo(23, -2);
  ctx.lineTo(-23, -2);
  ctx.closePath();
  ctx.stroke();
  // bolt
  ctx.shadowColor = 'rgba(255,225,60,0.9)';
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.moveTo(3, -10);
  ctx.lineTo(-9, 8);
  ctx.lineTo(-1, 8);
  ctx.lineTo(-7, 27);
  ctx.lineTo(12, 2);
  ctx.lineTo(3, 2);
  ctx.lineTo(11, -10);
  ctx.closePath();
  ctx.fillStyle = '#ffe135';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7a4d00';
  ctx.stroke();
  ctx.restore();
}

function drawBobOmb(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineWidth = 2.2;
  // feet
  ctx.fillStyle = '#f39a2b';
  ctx.strokeStyle = '#4a2a05';
  ellipse(ctx, -9, 25, 7, 4);
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, 9, 25, 7, 4);
  ctx.fill();
  ctx.stroke();
  // wind-up key
  ctx.fillStyle = '#ffd23a';
  ctx.strokeStyle = '#6a4a00';
  ctx.beginPath();
  ctx.rect(17, 3, 9, 4);
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, 27, 5, 4.5, 5.5);
  ctx.fill();
  ctx.stroke();
  // fuse
  ctx.strokeStyle = '#6f6f78';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.quadraticCurveTo(1, -20, 5, -24);
  ctx.stroke();
  // body
  ctx.fillStyle = '#1b1b24';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 6, 19, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ellipse(ctx, -7, -4, 6, 3.5);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, -6, 4, 3, 4.8);
  ctx.fill();
  ellipse(ctx, 6, 4, 3, 4.8);
  ctx.fill();
  ctx.fillStyle = '#000';
  ellipse(ctx, -5.5, 5.5, 1.3, 2.2);
  ctx.fill();
  ellipse(ctx, 6.5, 5.5, 1.3, 2.2);
  ctx.fill();
  // spark
  ctx.fillStyle = '#ff9a1f';
  ctx.beginPath();
  ctx.arc(6, -25, 4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath();
  ctx.arc(6, -25, 1.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 3D meshes
// ---------------------------------------------------------------------------

const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();
const textureCache = new Map<string, THREE.Texture>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geometryCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g;
}

function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = materialCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    materialCache.set(key, m);
  }
  return m;
}

function tex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = textureCache.get(key);
  if (!t) {
    t = make();
    textureCache.set(key, t);
  }
  return t;
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Hex-plate pattern shared by all shells (tinted through material.color). */
function shellTexture(): THREE.Texture {
  return tex('shellHex', () =>
    canvasTexture(256, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      const r = 40;
      const h = Math.sqrt(3) * r;
      for (let row = -1; row < 6; row++) {
        for (let col = -1; col < 5; col++) {
          const cx = col * r * 3 + (row % 2 === 0 ? 0 : r * 1.5);
          const cy = (row * h) / 2;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }),
  );
}

/** Mushroom cap texture: base colour with a pole spot (full-width band at v=0) and a ring of spots. */

function questionTexture(): THREE.Texture {
  return tex('question', () =>
    canvasTexture(128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.font = 'bold 96px "Arial Black", Impact, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#7a4400';
      ctx.strokeText('?', 64, 70);
      ctx.fillStyle = '#fff7c2';
      ctx.fillText('?', 64, 70);
    }),
  );
}

function standard(key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return mat(key, () => new THREE.MeshStandardMaterial(params));
}

/**
 * Tapers a TubeGeometry's radius along its length. Symmetric by default (thin at both
 * ends); `skew` > 0 keeps the u=0 end fatter (a banana's stem end) than the u=1 end.
 */
function taperTube(
  geometry: THREE.TubeGeometry,
  path: THREE.Curve<THREE.Vector3>,
  tubular: number,
  radial: number,
  strength = 0.72,
  skew = 0,
): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    path.getPointAt(u, p);
    const e = Math.abs(2 * u - 1);
    const f = (1 - strength * e * e * e * e) * (1 - skew * u * u);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(p).multiplyScalar(f).add(p);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Banana spine: a shallow crescent lying on its belly (tips only slightly raised), u=0 is
 * the stem end. The old deep U with two identical cone tips read as a boomerang.
 */
function bananaCurve(): THREE.QuadraticBezierCurve3 {
  return new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.5, 0.1, 0),
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0.5, 0.06, 0),
  );
}

function buildBanana(): THREE.Object3D {
  const g = new THREE.Group();
  const tubular = 18;
  const radial = 5; // real bananas have a pentagonal cross-section — the ridges sell it
  const body = new THREE.Mesh(
    geo('banana', () => {
      const curve = bananaCurve();
      const t = new THREE.TubeGeometry(curve, tubular, 0.15, radial, false);
      taperTube(t, curve, tubular, radial, 0.5, 0.3);
      return t;
    }),
    standard('banana', { color: 0xffd23a, roughness: 0.55, metalness: 0.0, flatShading: true }),
  );
  body.castShadow = true;
  g.add(body);
  const curve = bananaCurve();
  const p = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  // Stem: a short thick brown cylinder continuing the spine past the fat end.
  const stem = new THREE.Mesh(
    geo('bananaStem', () => new THREE.CylinderGeometry(0.045, 0.06, 0.2, 6)),
    standard('bananaStem', { color: 0x6b4a12, roughness: 0.85 }),
  );
  curve.getPointAt(0, p);
  curve.getTangentAt(0, tangent).negate().normalize();
  stem.position.copy(p).addScaledVector(tangent, 0.12);
  stem.quaternion.setFromUnitVectors(up, tangent);
  g.add(stem);
  // Blossom end: a small dark nub on the thin end.
  const tip = new THREE.Mesh(
    geo('bananaTip', () => new THREE.ConeGeometry(0.04, 0.08, 5)),
    standard('bananaTip', { color: 0x3a2608, roughness: 0.8 }),
  );
  curve.getPointAt(1, p);
  curve.getTangentAt(1, tangent).normalize();
  tip.position.copy(p).addScaledVector(tangent, 0.03);
  tip.quaternion.setFromUnitVectors(up, tangent);
  g.add(tip);
  // Rest on the belly with a slight roll so the ridges catch the light.
  g.rotation.z = 0.08;
  g.rotation.x = -0.35;
  g.position.y = 0.26;
  return g;
}

function buildShell(color: number, key: string, spiky: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    geo('shellDome', () => new THREE.SphereGeometry(0.42, 12, 6, 0, TAU, 0, Math.PI / 2)),
    standard(`shell_${key}`, { color, roughness: 0.35, metalness: 0.05, map: shellTexture() }),
  );
  dome.castShadow = true;
  g.add(dome);
  const rim = new THREE.Mesh(
    geo('shellRim', () => new THREE.TorusGeometry(0.4, 0.065, 6, 16)),
    standard('shellRim', { color: 0xfaf3e0, roughness: 0.5 }),
  );
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const body = new THREE.Mesh(
    geo('shellBody', () => new THREE.CylinderGeometry(0.36, 0.3, 0.16, 12, 1, false)),
    standard('shellBody', { color: 0xf1e2b8, roughness: 0.6 }),
  );
  body.position.y = -0.1;
  g.add(body);
  if (spiky) {
    const spikeGeo = geo('shellSpike', () => new THREE.ConeGeometry(0.07, 0.18, 5));
    const spikeMat = standard('shellSpike', { color: 0xffffff, roughness: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      const dir = new THREE.Vector3(Math.cos(a) * 0.72, 0.7, Math.sin(a) * 0.72).normalize();
      spike.position.copy(dir).multiplyScalar(0.44);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(spike);
    }
    const top = new THREE.Mesh(spikeGeo, spikeMat);
    top.position.y = 0.46;
    g.add(top);
    // wing-like fins
    const finGeo = geo('shellFin', () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.55, 0.12);
      shape.lineTo(0.62, 0.34);
      shape.lineTo(0.05, 0.2);
      shape.closePath();
      return new THREE.ShapeGeometry(shape);
    });
    const finMat = standard('shellFin', { color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide });
    for (let i = -1; i <= 1; i += 2) {
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(i * 0.34, 0.05, 0.12);
      fin.rotation.y = i > 0 ? 0 : Math.PI;
      fin.rotation.z = i * -0.15;
      g.add(fin);
    }
  }
  g.position.y = 0.2;
  return g;
}

function buildNitro(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    geo('nitroBody', () => new THREE.CapsuleGeometry(0.2, 0.42, 4, 14)),
    standard('nitroBody', { color: 0x36d5ea, roughness: 0.3, metalness: 0.35, emissive: 0x0b3a44, emissiveIntensity: 0.6 }),
  );
  body.castShadow = true;
  g.add(body);
  const band = new THREE.Mesh(
    geo('nitroBand', () => new THREE.CylinderGeometry(0.215, 0.215, 0.14, 14, 1, true)),
    standard('nitroBand', { color: 0x0c2a30, roughness: 0.6, side: THREE.DoubleSide }),
  );
  band.position.y = -0.02;
  g.add(band);
  const neck = new THREE.Mesh(
    geo('nitroNeck', () => new THREE.CylinderGeometry(0.09, 0.11, 0.14, 10)),
    standard('nitroNeck', { color: 0x26343c, roughness: 0.5, metalness: 0.6 }),
  );
  neck.position.y = 0.44;
  g.add(neck);
  const valve = new THREE.Mesh(
    geo('nitroValve', () => new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8)),
    standard('nitroValve', { color: 0xff9a2e, roughness: 0.4, emissive: 0xff5a00, emissiveIntensity: 0.5 }),
  );
  valve.position.y = 0.55;
  g.add(valve);
  g.position.y = 0.42;
  return g;
}

function buildOverdrive(): THREE.Object3D {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    geo('odShell', () => new THREE.IcosahedronGeometry(0.36, 0)),
    standard('odShell', { color: 0xf2a91c, roughness: 0.25, metalness: 0.8, emissive: 0x6a3a00, emissiveIntensity: 0.7, flatShading: true }),
  );
  shell.castShadow = true;
  g.add(shell);
  const core = new THREE.Mesh(
    geo('odCore', () => new THREE.SphereGeometry(0.2, 12, 8)),
    mat('odCore', () => new THREE.MeshBasicMaterial({ color: 0xffe680, toneMapped: false })),
  );
  g.add(core);
  const ring = new THREE.Mesh(
    geo('odRing', () => new THREE.TorusGeometry(0.46, 0.03, 6, 24)),
    mat('odRing', () => new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
  );
  ring.rotation.x = Math.PI / 2.6;
  g.add(ring);
  g.position.y = 0.5;
  return g;
}

function buildStar(): THREE.Object3D {
  const g = new THREE.Group();
  const star = new THREE.Mesh(
    geo('star', () => {
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.46 : 0.2;
        const a = Math.PI / 2 + (i * Math.PI) / 5;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      const e = new THREE.ExtrudeGeometry(shape, {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 1,
        curveSegments: 1,
      });
      e.translate(0, 0, -0.07);
      return e;
    }),
    standard('star', { color: 0xffe14a, emissive: 0xffb300, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }),
  );
  star.castShadow = true;
  g.add(star);
  g.position.y = 0.5;
  return g;
}

function buildBobOmb(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    geo('bombBody', () => new THREE.SphereGeometry(0.36, 12, 8)),
    standard('bombBody', { color: 0x15151c, roughness: 0.35, metalness: 0.3 }),
  );
  body.name = 'bombBody';
  body.castShadow = true;
  g.add(body);
  const footGeo = geo('bombFoot', () => new THREE.CylinderGeometry(0.08, 0.09, 0.07, 8));
  const footMat = standard('bombFoot', { color: 0xf39a2b, roughness: 0.6 });
  for (let i = -1; i <= 1; i += 2) {
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(i * 0.16, -0.36, 0.03);
    g.add(foot);
  }
  const keyMat = standard('bombKey', { color: 0xffd23a, roughness: 0.3, metalness: 0.6 });
  const shaft = new THREE.Mesh(geo('bombKeyShaft', () => new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6)), keyMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(0.42, 0.02, 0);
  g.add(shaft);
  const ring = new THREE.Mesh(geo('bombKeyRing', () => new THREE.TorusGeometry(0.09, 0.022, 4, 8)), keyMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0.53, 0.02, 0);
  g.add(ring);
  const fuse = new THREE.Mesh(
    geo('bombFuse', () => new THREE.CylinderGeometry(0.025, 0.025, 0.16, 5)),
    standard('bombFuse', { color: 0x777780, roughness: 0.9 }),
  );
  fuse.position.set(0.03, 0.42, 0);
  fuse.rotation.z = -0.25;
  g.add(fuse);
  const tip = new THREE.Mesh(
    geo('bombTip', () => new THREE.SphereGeometry(0.05, 6, 4)),
    standard('bombTip', { color: 0xffb020, emissive: 0xff7a00, emissiveIntensity: 2.5, roughness: 0.5 }),
  );
  tip.name = 'bombTip';
  tip.position.set(0.05, 0.51, 0);
  g.add(tip);
  const eyeGeo = geo('bombEye', () => new THREE.SphereGeometry(0.05, 6, 4));
  const eyeMat = standard('bombEye', { color: 0xffffff, roughness: 0.4 });
  for (let i = -1; i <= 1; i += 2) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(i * 0.11, 0.02, -0.33);
    eye.scale.set(1, 1.5, 0.6);
    g.add(eye);
  }
  g.position.y = 0.43;
  return g;
}

function buildLightning(): THREE.Object3D {
  const g = new THREE.Group();
  const boltGeo = geo('bolt', () => {
    const s = new THREE.Shape();
    s.moveTo(0.08, 0.5);
    s.lineTo(-0.22, 0.02);
    s.lineTo(-0.02, 0.02);
    s.lineTo(-0.18, -0.5);
    s.lineTo(0.3, 0.12);
    s.lineTo(0.08, 0.12);
    s.lineTo(0.28, 0.5);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
  const bolt = new THREE.Mesh(
    boltGeo,
    mat('bolt', () => new THREE.MeshBasicMaterial({ color: 0xffe135, side: THREE.DoubleSide, toneMapped: false })),
  );
  g.add(bolt);
  const glow = new THREE.Mesh(
    boltGeo,
    mat(
      'boltGlow',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xffc400,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
    ),
  );
  glow.scale.setScalar(1.35);
  glow.position.z = -0.01;
  g.add(glow);
  g.position.y = 0.55;
  return g;
}

function buildMagnet(): THREE.Object3D {
  const g = new THREE.Group();
  const arc = new THREE.Mesh(
    geo('magnetArc', () => new THREE.TorusGeometry(0.26, 0.075, 8, 18, Math.PI)),
    standard('magnet', { color: 0xff3b4a, roughness: 0.4, metalness: 0.2 }),
  );
  g.add(arc);
  const legGeo = geo('magnetLeg', () => new THREE.CylinderGeometry(0.075, 0.075, 0.2, 10));
  const tipGeo = geo('magnetTip', () => new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10));
  const tipMat = standard('magnetTip', { color: 0xd9dee6, roughness: 0.3, metalness: 0.8 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, arc.material);
    leg.position.set(sx * 0.26, -0.1, 0);
    g.add(leg);
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(sx * 0.26, -0.26, 0);
    g.add(tip);
  }
  g.position.y = 0.55;
  return g;
}

/**
 * Builds a fresh Object3D for the given item (≤ 600 triangles). Geometries and
 * materials are shared from the module caches; the returned group itself can be
 * freely positioned, scaled and removed. Triple items return the single base
 * item (the ItemManager instantiates three of them for the orbit).
 */
export function buildItemMesh(item: ItemType): THREE.Object3D {
  switch (item) {
    case 'banana':
    case 'triple_banana':
      return buildBanana();
    case 'green_shell':
    case 'triple_green_shell':
      return buildShell(0x2fd24a, 'green', false);
    case 'red_shell':
    case 'triple_red_shell':
      return buildShell(0xff3b30, 'red', false);
    case 'blue_shell':
      return buildShell(0x2f7bff, 'blue', true);
    case 'nitro':
    case 'triple_nitro':
      return buildNitro();
    case 'overdrive':
      return buildOverdrive();
    case 'star':
      return buildStar();
    case 'lightning':
      return buildLightning();
    case 'bob_omb':
      return buildBobOmb();
    case 'magnet':
      return buildMagnet();
    case 'none':
    default:
      return new THREE.Group();
  }
}

/** Base (non-triple) item type, e.g. 'triple_red_shell' -> 'red_shell'. */
export function baseItemType(item: ItemType): ItemType {
  switch (item) {
    case 'triple_banana':
      return 'banana';
    case 'triple_green_shell':
      return 'green_shell';
    case 'triple_red_shell':
      return 'red_shell';
    case 'triple_nitro':
      return 'nitro';
    default:
      return item;
  }
}

/** Frees all cached GPU resources (geometries, materials, textures) and icon canvases. */
export function disposeItemVisualCaches(): void {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  for (const t of textureCache.values()) t.dispose();
  textureCache.clear();
  iconCache.clear();
}
