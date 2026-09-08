/**
 * Track-select thumbnails: a 2D canvas painting per circuit — themed sky and scenery on the
 * horizon, the track's own palette for the ground, and the real course outline (from the
 * Centerline LUT) laid down in a tilted pseudo-3D view with curbs, dashes and the start line.
 * Pure canvas, no assets; cached per track id for the session.
 */
import type { TrackDefinition, TrackTheme } from '../core/types';
import { Centerline } from '../track/Centerline';

// 2:1 canvas; the card crops it to anything between ~2.2:1 and ~3.4:1 (object-fit: cover), so the
// scenery sits low and the course stays inside the middle band of the ground.
const W = 480;
const H = 240;
const HORIZON = 0.44; // fraction of height where sky meets ground

const cache = new Map<string, HTMLCanvasElement>();

export function buildTrackThumbnail(def: TrackDefinition): HTMLCanvasElement {
  const cached = cache.get(def.id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    try {
      paint(ctx, def);
    } catch (err) {
      console.warn('[thumbs] track thumbnail failed:', def.id, err);
    }
  }
  cache.set(def.id, canvas);
  return canvas;
}

// --- helpers ------------------------------------------------------------------

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');
const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
function shade(c: number, k: number): number {
  return k < 0 ? mix(c, 0x000000, -k) : mix(c, 0xffffff, k);
}
/** Deterministic per-track noise so the scenery never changes between visits. */
function seeded(id: string): () => number {
  let s = 0;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 10000) / 10000;
  };
}

// --- painting -------------------------------------------------------------------

function paint(ctx: CanvasRenderingContext2D, def: TrackDefinition): void {
  const env = def.environment;
  const pal = def.palette;
  const hy = H * HORIZON;
  const rnd = seeded(def.id);

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, hex(env.skyTop));
  sky.addColorStop(0.7, hex(env.skyHorizon));
  sky.addColorStop(1, hex(env.skyBottom));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hy + 1);

  drawScenery(ctx, def.theme, hy, env.skyHorizon, env.skyBottom, rnd);

  // Ground plane (darker toward the viewer for depth).
  const ground = ctx.createLinearGradient(0, hy, 0, H);
  ground.addColorStop(0, hex(shade(pal.ground, 0.12)));
  ground.addColorStop(1, hex(shade(pal.ground, -0.28)));
  ctx.fillStyle = ground;
  ctx.fillRect(0, hy, W, H - hy);
  // Haze line where ground meets sky.
  const haze = ctx.createLinearGradient(0, hy, 0, hy + 26);
  haze.addColorStop(0, rgba(env.skyBottom, 0.55));
  haze.addColorStop(1, rgba(env.skyBottom, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(0, hy, W, 26);

  drawCourse(ctx, def, hy);
}

function drawScenery(ctx: CanvasRenderingContext2D, theme: TrackTheme, hy: number, horizonColor: number, bottom: number, rnd: () => number): void {
  const far = shade(mix(horizonColor, 0x334, 0.35), -0.05);
  const near = shade(far, -0.25);
  switch (theme) {
    case 'grassland': {
      sun(ctx, W * 0.78, hy * 0.55, 20, 0xfff2b0);
      hills(ctx, hy, 0.16, 0x6ea85a, 3, rnd, 0.55);
      hills(ctx, hy, 0.09, 0x4f8f45, 2, rnd, 0.35);
      trees(ctx, hy, 0x2f6b34, 0x3d8a40, rnd, 7);
      break;
    }
    case 'beach': {
      sun(ctx, W * 0.72, hy * 0.5, 18, 0xfff3c4);
      // Sea band under the horizon glow.
      const sea = ctx.createLinearGradient(0, hy * 0.86, 0, hy);
      sea.addColorStop(0, '#2f8fd8');
      sea.addColorStop(1, '#5fc4ee');
      ctx.fillStyle = sea;
      ctx.fillRect(0, hy * 0.86, W, hy * 0.14 + 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) {
        const y = hy * 0.9 + i * 4;
        ctx.beginPath();
        ctx.moveTo(rnd() * W * 0.5, y);
        ctx.lineTo(rnd() * W * 0.5 + W * 0.5, y);
        ctx.stroke();
      }
      palms(ctx, hy, rnd);
      break;
    }
    case 'desert': {
      sun(ctx, W * 0.3, hy * 0.5, 26, 0xffd27a);
      hills(ctx, hy, 0.2, 0xd39a55, 2, rnd, 0.9);
      hills(ctx, hy, 0.11, 0xb9773c, 2, rnd, 0.6);
      cacti(ctx, hy, rnd);
      break;
    }
    case 'snow': {
      peaks(ctx, hy, 0xeaf2fb, 0xb7c7dc, rnd);
      trees(ctx, hy, 0x1f3d3a, 0x2c5a4f, rnd, 6, true);
      break;
    }
    case 'neon': {
      moon(ctx, W * 0.8, hy * 0.48, 14);
      skyline(ctx, hy, 0x1a1030, rnd);
      break;
    }
    case 'volcano': {
      const glow = ctx.createRadialGradient(W * 0.55, hy * 0.75, 4, W * 0.55, hy * 0.75, W * 0.45);
      glow.addColorStop(0, 'rgba(255,120,40,0.55)');
      glow.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, hy);
      hills(ctx, hy, 0.22, 0x3a2a2c, 2, rnd, 0.8);
      volcano(ctx, W * 0.55, hy);
      break;
    }
    default:
      hills(ctx, hy, 0.12, far, 2, rnd, 0.5);
      hills(ctx, hy, 0.07, near, 2, rnd, 0.3);
  }
}

function sun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number): void {
  const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.6);
  g.addColorStop(0, rgba(color, 0.95));
  g.addColorStop(0.45, rgba(color, 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  ctx.fillStyle = hex(color);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function moon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(255,240,220,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,80,140,0.35)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.2, r * 0.32, 0, Math.PI * 2);
  ctx.arc(x + r * 0.35, y + r * 0.35, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

/** Rolling silhouette of `bumps` humps rising `amp` × hy above the horizon. */
function hills(ctx: CanvasRenderingContext2D, hy: number, amp: number, color: number, bumps: number, rnd: () => number, alpha: number): void {
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(0, hy + 2);
  const seg = W / (bumps * 2);
  let x = 0;
  for (let i = 0; i < bumps * 2 + 1; i++) {
    const peak = i % 2 === 1;
    const y = hy - (peak ? hy * amp * (0.7 + rnd() * 0.5) : hy * amp * 0.15 * rnd());
    ctx.quadraticCurveTo(x + seg * 0.5, y, x + seg, i === bumps * 2 ? hy : y + (peak ? 6 : -4));
    x += seg;
  }
  ctx.lineTo(W, hy + 2);
  ctx.closePath();
  ctx.fill();
}

function trees(ctx: CanvasRenderingContext2D, hy: number, dark: number, light: number, rnd: () => number, count: number, conifer = false): void {
  for (let i = 0; i < count; i++) {
    const x = 12 + rnd() * (W - 24);
    const h = 10 + rnd() * 14;
    const base = hy + 1;
    ctx.fillStyle = hex(rnd() > 0.5 ? dark : light);
    if (conifer) {
      ctx.beginPath();
      ctx.moveTo(x, base - h);
      ctx.lineTo(x + h * 0.38, base);
      ctx.lineTo(x - h * 0.38, base);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#4a3320';
      ctx.fillRect(x - 1.2, base - h * 0.45, 2.4, h * 0.45);
      ctx.fillStyle = hex(rnd() > 0.5 ? dark : light);
      ctx.beginPath();
      ctx.arc(x, base - h * 0.62, h * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function palms(ctx: CanvasRenderingContext2D, hy: number, rnd: () => number): void {
  for (let i = 0; i < 4; i++) {
    const x = 20 + rnd() * (W - 40);
    const h = 26 + rnd() * 18;
    const lean = (rnd() - 0.5) * 10;
    ctx.strokeStyle = '#5a3a1e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, hy + 4);
    ctx.quadraticCurveTo(x + lean, hy - h * 0.5, x + lean * 1.4, hy - h);
    ctx.stroke();
    ctx.strokeStyle = '#2f7a3a';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (let f = 0; f < 6; f++) {
      const a = -Math.PI * 0.9 + (f / 5) * Math.PI * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + lean * 1.4, hy - h);
      ctx.quadraticCurveTo(x + lean * 1.4 + Math.cos(a) * 12, hy - h + Math.sin(a) * 12 - 4, x + lean * 1.4 + Math.cos(a) * 18, hy - h + Math.sin(a) * 18 + 6);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

function cacti(ctx: CanvasRenderingContext2D, hy: number, rnd: () => number): void {
  ctx.fillStyle = '#3f7a3a';
  for (let i = 0; i < 4; i++) {
    const x = 20 + rnd() * (W - 40);
    const h = 10 + rnd() * 10;
    ctx.fillRect(x - 2, hy - h, 4, h + 2);
    ctx.fillRect(x - 7, hy - h * 0.55, 5, 2.5);
    ctx.fillRect(x - 7, hy - h * 0.55 - 5, 2.5, 6);
    ctx.fillRect(x + 2, hy - h * 0.7, 5, 2.5);
    ctx.fillRect(x + 4.5, hy - h * 0.7 - 6, 2.5, 7);
  }
}

function peaks(ctx: CanvasRenderingContext2D, hy: number, snow: number, rock: number, rnd: () => number): void {
  let x = -20;
  while (x < W + 20) {
    const w = 60 + rnd() * 70;
    const h = hy * (0.35 + rnd() * 0.45);
    const px = x + w / 2;
    // Rock body.
    ctx.fillStyle = hex(rock);
    ctx.beginPath();
    ctx.moveTo(x, hy + 2);
    ctx.lineTo(px, hy - h);
    ctx.lineTo(x + w, hy + 2);
    ctx.closePath();
    ctx.fill();
    // Sunlit face.
    ctx.fillStyle = hex(shade(rock, 0.18));
    ctx.beginPath();
    ctx.moveTo(px, hy - h);
    ctx.lineTo(x + w, hy + 2);
    ctx.lineTo(px + w * 0.1, hy + 2);
    ctx.closePath();
    ctx.fill();
    // Snow cap.
    ctx.fillStyle = hex(snow);
    ctx.beginPath();
    ctx.moveTo(px, hy - h);
    ctx.lineTo(px + w * 0.16, hy - h * 0.7);
    ctx.lineTo(px + w * 0.06, hy - h * 0.66);
    ctx.lineTo(px - w * 0.04, hy - h * 0.72);
    ctx.lineTo(px - w * 0.15, hy - h * 0.68);
    ctx.closePath();
    ctx.fill();
    x += w * 0.72;
  }
}

function skyline(ctx: CanvasRenderingContext2D, hy: number, color: number, rnd: () => number): void {
  let x = 0;
  const neon = ['#ff3fb4', '#3ec6ff', '#c26bff', '#ffd23f'];
  while (x < W) {
    const w = 14 + rnd() * 26;
    const h = hy * (0.2 + rnd() * 0.6);
    ctx.fillStyle = hex(color);
    ctx.fillRect(x, hy - h, w, h + 2);
    // Lit windows.
    for (let wy = hy - h + 4; wy < hy - 4; wy += 6) {
      for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        if (rnd() > 0.55) {
          ctx.fillStyle = rnd() > 0.7 ? neon[Math.floor(rnd() * neon.length)] : 'rgba(255,230,180,0.75)';
          ctx.fillRect(wx, wy, 2, 3);
        }
      }
    }
    // Neon roof edge.
    ctx.fillStyle = neon[Math.floor(rnd() * neon.length)];
    ctx.fillRect(x, hy - h, w, 1.5);
    x += w + 2;
  }
}

function volcano(ctx: CanvasRenderingContext2D, cx: number, hy: number): void {
  const h = hy * 0.8;
  const w = W * 0.42;
  ctx.fillStyle = '#2a1c1e';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, hy + 2);
  ctx.lineTo(cx - w * 0.08, hy - h);
  ctx.lineTo(cx + w * 0.08, hy - h);
  ctx.lineTo(cx + w / 2, hy + 2);
  ctx.closePath();
  ctx.fill();
  // Lava crown + rivulets.
  ctx.fillStyle = '#ff6a1a';
  ctx.beginPath();
  ctx.ellipse(cx, hy - h, w * 0.1, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff8a2a';
  ctx.lineWidth = 2.5;
  for (const k of [-0.05, 0.02, 0.07]) {
    ctx.beginPath();
    ctx.moveTo(cx + w * k, hy - h + 2);
    ctx.quadraticCurveTo(cx + w * k * 3, hy - h * 0.55, cx + w * k * 4.5, hy - h * 0.25);
    ctx.stroke();
  }
  // Smoke.
  ctx.fillStyle = 'rgba(90,70,80,0.55)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(cx + i * 9 - 6, hy - h - 8 - i * 7, 7 + i * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The real course outline from the centerline LUT, tilted onto the ground plane. */
function drawCourse(ctx: CanvasRenderingContext2D, def: TrackDefinition, hy: number): void {
  const cl = new Centerline(def);
  const N = 240;
  const step = cl.n / N;
  const cx = (cl.minX + cl.maxX) / 2;
  const cz = (cl.minZ + cl.maxZ) / 2;
  const span = Math.max(cl.maxX - cl.minX, cl.maxZ - cl.minZ) || 1;
  const halfW = W * 0.4;
  const groundH = H - hy;
  const midY = hy + groundH * 0.42;
  const halfH = groundH * 0.25;
  // Orient the course so its long axis runs left-right.
  const rotate = cl.maxZ - cl.minZ > cl.maxX - cl.minX;

  const pts: { x: number; y: number; d: number }[] = [];
  for (let k = 0; k < N; k++) {
    const i = Math.min(cl.n - 1, Math.floor(k * step));
    let nx = (cl.px[i] - cx) / span; // -0.5..0.5
    let nz = (cl.pz[i] - cz) / span;
    if (rotate) [nx, nz] = [nz, -nx];
    const depth = 0.5 - nz; // 0 = far (top), 1 = near (bottom)
    const persp = 0.7 + 0.6 * depth; // wider toward the viewer
    pts.push({ x: W / 2 + nx * 2 * halfW * persp, y: midY + nz * 2 * halfH, d: depth });
  }

  const path = (): void => {
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const p = pts[k % N];
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Drop shadow / embankment.
  ctx.save();
  ctx.translate(0, 4);
  path();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 15;
  ctx.stroke();
  ctx.restore();
  // Off-road shoulder, curb, road.
  path();
  ctx.strokeStyle = hex(def.palette.offroad);
  ctx.lineWidth = 15;
  ctx.stroke();
  path();
  ctx.strokeStyle = hex(def.palette.curb);
  ctx.lineWidth = 11;
  ctx.stroke();
  path();
  ctx.strokeStyle = hex(def.palette.road);
  ctx.lineWidth = 7.5;
  ctx.stroke();
  // Centre dashes.
  path();
  ctx.setLineDash([7, 9]);
  ctx.strokeStyle = rgba(def.palette.roadStripe, 0.85);
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.setLineDash([]);
  // Start / finish: checkered bar across the road at t = 0.
  const a = pts[0];
  const b = pts[1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(ang);
  for (let i = -2; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#111';
      ctx.fillRect(j * 2.2 - 2.2, i * 2.4, 2.2, 2.4);
    }
  }
  ctx.restore();
  // Direction arrow a little way down the road.
  const c = pts[8];
  const d = pts[12];
  const ang2 = Math.atan2(d.y - c.y, d.x - c.x);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(ang2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(3.5, 0);
  ctx.lineTo(-2, -2.6);
  ctx.lineTo(-2, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
