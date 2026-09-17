// Renders the VXShop "premium-garage" product image (512x512) from the real kart model and the
// real cosmetics catalogue — the thing actually being sold, not an illustration of it.
//   node tools/vxshop-product.mjs [http://localhost:5178] [outDir]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv[2] || 'http://localhost:5178';
const OUT = process.argv[3] || 'marketing/.audit';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush);
await sleep(600);

const shots = await page.evaluate(async () => {
  const THREE = await import('/@id/three');
  const { getCharacter } = await import('/src/kart/roster.ts');
  const { buildKartModel } = await import('/src/kart/KartModel.ts');
  const S = 1024; // rendered at 2x and downscaled to 512 for clean edges

  document.getElementById('ui').style.display = 'none';
  document.querySelectorAll('canvas').forEach((c) => (c.style.visibility = 'hidden'));

  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;visibility:visible';
  document.body.appendChild(canvas);
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // Neon-garage key/fill: warm key from the front-right, cool rim from behind-left, so the
  // bodywork reads as lacquered rather than flat.
  scene.add(new THREE.HemisphereLight(0x8a6cff, 0x140b2a, 1.15));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2); key.position.set(4, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x4ad9ff, 1.9); rim.position.set(-5, 3, -4); scene.add(rim);
  const under = new THREE.PointLight(0xff3ab8, 2.4, 9); under.position.set(0, -0.5, 0); scene.add(under);

  // A premium kart wearing paid cosmetics: that is precisely what the 100 VX buys.
  const kart = buildKartModel(getCharacter('rosa'), {
    body: 0x2a1250, accent: 0xff3ab8, rim: 0x37e8ff, helmet: 0xf5f5ff,
    pattern: 'chromeSweep', patternColor: 0x37e8ff,
    underglow: 'pulse', underglowColor: 0xff3ab8,
    trail: 'ribbon', trailColor: 0x8ef4ff,
    flame: 'plasma', wheelFx: 'rimLight', badge: 'crown',
  });
  const model = kart.root;
  // Three-quarter front: the angle that shows the driver, the nose and the flank pattern at once.
  // Picked off a contact sheet of eight yaws — side-on hid the bodywork the pattern lives on.
  model.rotation.y = Math.PI * 0.88;
  scene.add(model);

  // Distance picked off a second contact sheet: closer than this and the roll bars and rear
  // wheel leave the frame, further and the kart is lost in the tile.
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  cam.position.set(2.98, 1.92, 3.46);
  cam.lookAt(0, 0.36, 0);
  r.setSize(S, S, false);
  r.render(scene, cam);

  // Compose: background, glow, the render, wordmark.
  const out = document.createElement('canvas');
  out.width = 512; out.height = 512;
  const g = out.getContext('2d');

  const bg = g.createLinearGradient(0, 0, 512, 512);
  bg.addColorStop(0, '#1b0f3a'); bg.addColorStop(0.55, '#2a1155'); bg.addColorStop(1, '#0d0722');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 512);

  const halo = g.createRadialGradient(256, 300, 20, 256, 300, 260);
  halo.addColorStop(0, 'rgba(255,58,184,0.42)');
  halo.addColorStop(0.5, 'rgba(120,60,220,0.18)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(0, 0, 512, 512);

  // Underglow pool. The underglow, trail and flame tiers are runtime particle effects rather
  // than parts of the model, so the one that sits still is drawn here — this is what it looks
  // like on the grid, and it keeps the kart planted instead of floating.
  g.save();
  g.translate(258, 350); g.scale(1, 0.26);
  const pool = g.createRadialGradient(0, 0, 8, 0, 0, 175);
  pool.addColorStop(0, 'rgba(255,58,184,0.85)');
  pool.addColorStop(0.45, 'rgba(255,58,184,0.32)');
  pool.addColorStop(1, 'rgba(255,58,184,0)');
  g.fillStyle = pool; g.beginPath(); g.arc(0, 0, 175, 0, Math.PI * 2); g.fill();
  g.restore();

  // floor line
  g.strokeStyle = 'rgba(141,244,255,0.3)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(44, 352); g.lineTo(468, 352); g.stroke();

  // Lifted so the lower sixth stays clear for the wordmark.
  g.drawImage(canvas, 0, 0, S, S, 0, -44, 512, 512);

  // Untitled first: the purchase dialog prints the product name beside the tile, so a version
  // without baked text is the safer default. No price on either — that is a console field.
  const plain = out.toDataURL('image/png');

  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.font = '700 46px Impact, "Black Han Sans", system-ui, sans-serif';
  g.shadowColor = 'rgba(255,58,184,0.9)'; g.shadowBlur = 18;
  g.fillText('PREMIUM', 256, 452);
  g.fillStyle = '#8ef4ff';
  g.font = '700 34px Impact, "Black Han Sans", system-ui, sans-serif';
  g.fillText('GARAGE', 256, 488);
  g.shadowBlur = 0;

  canvas.remove();
  return { plain, titled: out.toDataURL('image/png') };
});

for (const [name, url] of [['premium-garage-512', shots.titled], ['premium-garage-512-plain', shots.plain]]) {
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`wrote ${OUT}/${name}.png`);
}
await browser.close();
