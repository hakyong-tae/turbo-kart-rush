// Contact sheets for the moving cosmetics: underglow pools and boost trails, shot from the
// game's own chase camera at racing speed, because both effects only read in motion.
//
//   node tools/fx-sheet.mjs [http://localhost:5178]   # needs `npm run dev` running
//
// Outputs marketing/.audit/underglow-sheet.png and marketing/.audit/trail-sheet.png.
// A style that cannot be told from its neighbour here does not earn its slot.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const PUPPETEER_DIR = process.env.PUPPETEER_DIR || '/Users/hytae/Downloads/cryzen-downloader';
const puppeteer = createRequire(`file://${PUPPETEER_DIR}/`)('puppeteer');
const BASE = process.argv[2] || 'http://localhost:5178';
const OUT = 'marketing/.audit';
const TMP = `${OUT}/.fx`;
const STEP_MS = 1000 / 60;

const UNDERGLOWS = ['solid', 'pulse', 'breathe', 'strobe', 'rainbow', 'ripple'];
const TRAILS = ['ribbon', 'sparks', 'smoke', 'stars', 'hex', 'bolts', 'shards', 'rings', 'embers', 'pixels'];

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('tkr.lang', 'en');
    localStorage.setItem('tkr.nudged', '1');
  } catch {}
});
await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'), { timeout: 30000 });
await sleep(400);
await page.evaluate(() => {
  document.querySelector('.single-toggle').click();
  [...document.querySelectorAll('.char-card')][0].click();
  [...document.querySelectorAll('.panel-chars .actions button')][1].click();
  // Neon Nexus: night track, the only fair test for additive glow and trails.
  [...document.querySelectorAll('.track-card')][4].click();
  [...document.querySelectorAll('.panel-tracks .actions button')][1].click();
});
await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'countdown', { timeout: 60000 });

// Step time by hand so every shot sees the same amount of simulated motion.
await page.evaluate(() => {
  window.__pending = null;
  window.__t = performance.now();
  window.requestAnimationFrame = (cb) => {
    window.__pending = cb;
    return 1;
  };
  window.__step = (dtMs) => {
    const cb = window.__pending;
    window.__pending = null;
    window.__t += dtMs;
    if (cb) cb(window.__t);
    else window.__turboKartRush.loop(window.__t);
  };
});
await sleep(150);

// A locked camera rig: same distance, same angle, every shot.
await page.evaluate(async () => {
  const THREE = await import('/@id/three');
  const g = window.__turboKartRush;
  const cam = new THREE.PerspectiveCamera(42, 640 / 400, 0.1, 500);
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  // dist/up/side place the eye behind, above and beside the kart; `back` slides the look-at point
  // down the wake, because a trail lives behind the kart and a tight rig frames it out.
  window.__shot = (dist, up, side, back) => {
    const kart = g.race.karts.find((k) => k.state.isPlayer) || g.race.karts[0];
    const p = kart.state.position;
    const h = kart.state.heading;
    const bx = Math.sin(h);
    const bz = Math.cos(h);
    eye.set(p.x + bx * dist + bz * side, p.y + up, p.z + bz * dist - bx * side);
    look.set(p.x + bx * back, p.y + 0.35, p.z + bz * back);
    cam.position.copy(eye);
    cam.lookAt(look);
    g.renderer.render(g.scene, cam);
  };
});

const step = async (frames) => {
  for (let i = 0; i < frames; i++) await page.evaluate((dt) => window.__step(dt), STEP_MS);
};

// Countdown out, then up to speed.
await step(340);
await page.evaluate(() => {
  document.getElementById('ui').style.visibility = 'hidden';
});

async function shoot(group, styles, apply, rig) {
  const files = [];
  for (const style of styles) {
    await page.evaluate(
      (s, fn) => {
        const g = window.__turboKartRush;
        // The chase camera follows the kart flagged isPlayer, which is not always index 0.
        const kart = g.race.karts.find((k) => k.state.isPlayer) || g.race.karts[g.race.localKartId ?? 0];
        kart.applyCosmetics(new Function('s', `return (${fn})(s)`)(s));
        // Label in the page: this ffmpeg build ships without drawtext.
        let tag = document.getElementById('fx-tag');
        if (!tag) {
          tag = document.createElement('div');
          tag.id = 'fx-tag';
          tag.style.cssText =
            'position:fixed;left:8px;top:8px;z-index:2147483647;font:bold 18px system-ui,sans-serif;' +
            'color:#fff;background:rgba(0,0,0,.62);padding:4px 10px;border-radius:6px;visibility:visible';
          document.body.appendChild(tag);
        }
        tag.textContent = s;
      },
      style,
      apply,
    );
    await step(70); // ~1.2 s: long enough for a trail to stream out behind the kart
    // Re-render from a fixed rear-quarter rig instead of the chase camera, so all six shots
    // frame the kart identically and a style can be compared against its neighbour.
    await page.evaluate((r) => window.__shot(r[0], r[1], r[2], r[3]), rig);
    const file = `${TMP}/${group}-${style}.png`;
    await page.screenshot({ path: file });
    files.push(file);
    console.log(`  ${group}: ${style}`);
  }
  return files;
}

// Close rig for the pool on the road; a long rig down the wake for the trails.
const glowFiles = await shoot('underglow', UNDERGLOWS, String((s) => ({ body: 0x101218, accent: 0x3a7bff, underglow: s, underglowColor: 0x36d5ea })), [5.2, 2.0, 1.6, 0]);
const trailFiles = await shoot('trail', TRAILS, String((s) => ({ body: 0xe8ecf2, accent: 0xff3b4a, trail: s, trailColor: 0xffb020 })), [9.5, 3.2, 3.6, 3]);

function montage(files, cols, out) {
  const inputs = files.flatMap((f) => ['-i', f]);
  const rows = Math.ceil(files.length / cols);
  const chain = `${files.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${files.length}:layout=${layout(files.length, cols)}[out]`;
  execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', chain, '-map', '[out]', '-frames:v', '1', out], { stdio: 'pipe' });
  console.log(`wrote ${out} (${files.length} styles, ${cols}x${rows})`);
}

function layout(n, cols) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    parts.push(`${c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+')}_${r === 0 ? '0' : Array.from({ length: r }, (_, k) => `h${k * cols}`).join('+')}`);
  }
  return parts.join('|');
}

montage(glowFiles, 3, `${OUT}/underglow-sheet.png`);
montage(trailFiles, 5, `${OUT}/trail-sheet.png`);
await browser.close();
