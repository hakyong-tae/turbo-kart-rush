// Renders all eight karts from the real model builder in an isolated scene (4 × 2 grid) so
// body changes can be eyeballed without playing a race.
//   node tools/kart-lineup.mjs [http://localhost:5178]   → marketing/.audit/kart-lineup.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv[2] || 'http://localhost:5178';
const OUT = 'marketing/.audit';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush);
await sleep(500);
for (const [name, yaw] of [['kart-lineup', Math.PI * 0.8], ['kart-lineup-front', Math.PI * 1.75]]) {
  await page.evaluate(async (yaw) => {
    const THREE = await import('/@id/three');
    const { CHARACTERS } = await import('/src/kart/roster.ts');
    const { buildKartModel } = await import('/src/kart/KartModel.ts');
    const W = 1600, H = 900, COLS = 4, ROWS = 2;
    document.getElementById('ui').style.display = 'none';
    document.querySelectorAll('canvas').forEach((c) => (c.style.visibility = 'hidden'));
    document.querySelectorAll('.lineup-canvas').forEach((c) => c.remove());
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.className = 'lineup-canvas';
    canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#2b2f3a;visibility:visible';
    document.body.appendChild(canvas);
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.setClearColor(0x2b2f3a); r.setScissorTest(true); r.outputColorSpace = THREE.SRGBColorSpace;
    const ov = document.createElement('canvas'); ov.width = W; ov.height = H; ov.className = 'lineup-canvas';
    ov.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;visibility:visible'; document.body.appendChild(ov);
    const ctx = ov.getContext('2d'); ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif';
    const cellW = W / COLS, cellH = H / ROWS;
    CHARACTERS.forEach((def, i) => {
      const parts = buildKartModel(def);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(2.5, 4, 3); scene.add(sun);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshStandardMaterial({ color: 0x3c4150 }));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
      parts.root.rotation.y = yaw; scene.add(parts.root);
      const col = i % COLS, row = Math.floor(i / COLS);
      const cam = new THREE.PerspectiveCamera(30, cellW / (cellH - 30), 0.1, 50); cam.position.set(2.7, 1.7, 2.7); cam.lookAt(0, 0.38, 0);
      const y0 = H - (row + 1) * cellH;
      r.setViewport(col * cellW, y0, cellW, cellH - 30); r.setScissor(col * cellW, y0, cellW, cellH - 30); r.render(scene, cam);
      ctx.fillText(`${def.name}${def.premium ? '  ★premium' : ''}  (${def.weightClass})`, col * cellW + 10, (row + 1) * cellH - 9);
      parts.dispose();
    });
    r.dispose();
  }, yaw);
  await sleep(200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`wrote ${OUT}/${name}.png`);
}
await browser.close();
