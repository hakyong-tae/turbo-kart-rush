// Contact sheet of every livery pattern on one kart, so the catalogue can be eyeballed for
// duplicates. A pattern that is not distinguishable at this size does not earn its slot.
//   node tools/livery-sheet.mjs [http://localhost:5178]   → marketing/.audit/livery-sheet.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv[2] || 'http://localhost:5178';
const OUT = 'marketing/.audit';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1120, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush);
await sleep(600);

const count = await page.evaluate(async () => {
  const THREE = await import('/@id/three');
  const { PATTERNS } = await import('/src/core/cosmetics.ts');
  const { getCharacter } = await import('/src/kart/roster.ts');
  const { buildKartModel } = await import('/src/kart/KartModel.ts');
  const W = 1680, H = 1120, COLS = 6;
  const ROWS = Math.ceil(PATTERNS.length / COLS);
  const cellW = W / COLS, cellH = H / ROWS;

  document.getElementById('ui').style.display = 'none';
  document.querySelectorAll('canvas').forEach((c) => (c.style.visibility = 'hidden'));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#20232c;visibility:visible';
  document.body.appendChild(canvas);
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setClearColor(0x20232c);
  r.setScissorTest(true);
  r.outputColorSpace = THREE.SRGBColorSpace;
  const ov = document.createElement('canvas');
  ov.width = W;
  ov.height = H;
  ov.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;visibility:visible';
  document.body.appendChild(ov);
  const ctx = ov.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px sans-serif';

  const def = getCharacter('max');
  PATTERNS.forEach((entry, i) => {
    const parts = buildKartModel(def, {
      body: 0xe8ecf2,
      accent: 0x22262f,
      pattern: entry.id,
      patternColor: 0x1e6bff,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(2.5, 4, 3);
    scene.add(sun);
    parts.root.rotation.y = Math.PI * 0.78;
    scene.add(parts.root);
    const col = i % COLS, row = Math.floor(i / COLS);
    const cam = new THREE.PerspectiveCamera(30, cellW / (cellH - 26), 0.1, 50);
    cam.position.set(2.5, 1.5, 2.5);
    cam.lookAt(0, 0.38, 0);
    const y0 = H - (row + 1) * cellH;
    r.setViewport(col * cellW, y0, cellW, cellH - 26);
    r.setScissor(col * cellW, y0, cellW, cellH - 26);
    r.render(scene, cam);
    ctx.fillText(`${i}. ${entry.id}${entry.free ? '  (free)' : ''}`, col * cellW + 10, (row + 1) * cellH - 8);
    parts.dispose();
  });
  r.dispose();
  return PATTERNS.length;
});
await sleep(250);
await page.screenshot({ path: `${OUT}/livery-sheet.png` });
console.log(`wrote ${OUT}/livery-sheet.png (${count} patterns)`);
await browser.close();
