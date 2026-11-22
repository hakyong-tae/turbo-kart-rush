// Graphics reference shots: the same moments of the same races, so two builds can be compared.
//
//   node tools/gfx-shots.mjs [outDir=marketing/.audit/gfx/now] [pc|phone] [track,track,...]
//
// Needs the dev server on :5178 (BASE overrides). `Math.random` is seeded and the game clock is
// stepped by hand, so a run is repeatable as long as the simulation itself is not changed; the
// player kart is driven by the dev autopilot (`?auto=1`).
//
// Per circuit: the grid (chase camera), four moments of the race (chase camera, HUD hidden) and
// two close-ups of the player kart from a low camera beside it. Also prints the average time a
// frame took to step and draw, which is the number to watch when a change costs performance.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const BASE = process.env.BASE || 'http://localhost:5178';
const [OUT = 'marketing/.audit/gfx/now', SIZE = 'pc', LIST = ''] = process.argv.slice(2);
const TRACKS = LIST
  ? LIST.split(',')
  : ['Sunny Circuit', 'Coral Coast', 'Neon Nexus', 'Magma Ridge', 'Frostbite Falls', 'Dune Drift', 'Stunt Park', 'Skyline Loop'];
const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc: { width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const MOMENTS = (process.env.MOMENTS || '4,9,15,22').split(',').map(Number);
const STEP = 1000 / 30;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});

function closeUp(cam) {
  const g = window.__tkr.game;
  const r = window.__tkr.getRace();
  const s = r.karts.find((k) => k.state.isPlayer).state;
  const c = g.camera;
  window.__camSave = { p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov };
  const fx = -Math.sin(s.heading), fz = -Math.cos(s.heading);
  const rx = -fz, rz = fx;
  c.position.set(s.position.x + fx * cam.f + rx * cam.r, s.position.y + cam.u, s.position.z + fz * cam.f + rz * cam.r);
  c.fov = cam.fov;
  c.updateProjectionMatrix();
  c.lookAt(s.position.x, s.position.y + cam.look, s.position.z);
  c.updateMatrixWorld(true);
  g.render(0);
}
function restore() {
  const c = window.__tkr.game.camera;
  const s = window.__camSave;
  c.position.copy(s.p);
  c.quaternion.copy(s.q);
  c.fov = s.fov;
  c.updateProjectionMatrix();
}

const timings = {};
try {
  for (const track of TRACKS) {
    const slug = track.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const page = await browser.newPage();
    await page.setViewport(SIZES[SIZE]);
    await page.evaluateOnNewDocument(() => {
      // Seeded: the same field, the same item rolls, the same particles, every run.
      let s = 0x2f6e2b1;
      Math.random = () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        localStorage.setItem('tkr.lang', 'en');
        localStorage.setItem('tkr.nudged', '1');
        localStorage.setItem('tkr.local.user', JSON.stringify({ coins: 300, xp: 120 }));
      } catch {}
    });
    page.on('pageerror', (e) => console.warn('  [pageerror]', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.warn(`  [${m.type()}]`, m.text().slice(0, 300));
    });
    await page.goto(`${BASE}/?auto=1&lobby${process.env.QUERY || ''}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'), { timeout: 60000 });
    await sleep(1200);
    const picked = await page.evaluate(async (name) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((n) => n.textContent.toLowerCase().includes(text.toLowerCase()));
      document.querySelector('.single-toggle').click();
      await wait(700);
      byText('.char-card', 'Zippy Nova')?.click();
      [...document.querySelectorAll('.panel-chars .actions button')].at(-1).click();
      await wait(700);
      const t = byText('.track-card', name);
      t?.click();
      await wait(250);
      [...document.querySelectorAll('.panel-tracks .actions button')].at(-1).click();
      return Boolean(t);
    }, track);
    if (!picked) {
      console.warn(`  ${track}: no such circuit card`);
      await page.close();
      continue;
    }
    await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'countdown', { timeout: 90000 });
    await page.addStyleTag({
      content:
        '.hud, .touch-controls, .coach-card, .hud-feed, .hud-hints, .mute-indicator, .orientation-gate, .toast-host, .version { display: none !important; }',
    });
    await page.evaluate(() => {
      for (const n of document.body.querySelectorAll(':scope > div')) if ((n.textContent || '').startsWith('build ')) n.remove();
      const g = window.__turboKartRush;
      window.__pending = null;
      window.__t = performance.now();
      window.requestAnimationFrame = (cb) => {
        window.__pending = cb;
        return 1;
      };
      window.__step = (dtMs, n = 1) => {
        for (let i = 0; i < n; i++) {
          const cb = window.__pending;
          window.__pending = null;
          window.__t += dtMs;
          if (cb) cb(window.__t);
          else g.loop(window.__t);
        }
      };
    });
    await sleep(200);
    await page.evaluate((dt) => window.__step(dt, 20), STEP);
    await page.screenshot({ path: `${OUT}/${slug}-0-grid.jpg`, type: 'jpeg', quality: 92 });
    await page.evaluate(closeUp, { f: 3.4, r: 1.6, u: 0.8, look: 0.5, fov: 40 });
    await page.screenshot({ path: `${OUT}/${slug}-0-kart.jpg`, type: 'jpeg', quality: 92 });
    await page.evaluate(restore);

    for (let i = 0; i < 400; i++) {
      await page.evaluate((dt) => window.__step(dt, 3), STEP);
      if ((await page.evaluate(() => document.getElementById('ui').dataset.state)) === 'racing') break;
    }
    let at = 0;
    let cost = 0;
    let frames = 0;
    for (const [i, m] of MOMENTS.entries()) {
      const n = Math.round((m - at) * 30);
      cost += await page.evaluate(
        ([dt, n]) => {
          const t0 = performance.now();
          window.__step(dt, n);
          window.__tkr.renderer.getContext().finish();
          return performance.now() - t0;
        },
        [STEP, n],
      );
      frames += n;
      at = m;
      await page.screenshot({ path: `${OUT}/${slug}-${i + 1}-race.jpg`, type: 'jpeg', quality: 92 });
      if (i === 1 || i === 3) {
        await page.evaluate(closeUp, i === 1 ? { f: 4.2, r: -2.6, u: 0.7, look: 0.6, fov: 46 } : { f: -4.4, r: 2.0, u: 1.2, look: 0.6, fov: 48 });
        await page.screenshot({ path: `${OUT}/${slug}-${i + 1}-kart.jpg`, type: 'jpeg', quality: 92 });
        await page.evaluate(restore);
      }
    }
    const info = await page.evaluate(() => {
      const i = window.__tkr.renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0, textures: i.memory.textures, geometries: i.memory.geometries };
    });
    timings[track] = { msPerFrame: +(cost / frames).toFixed(2), ...info };
    console.log(`${track}: ${JSON.stringify(timings[track])}`);
    await page.close();
  }
} finally {
  await browser.close();
}
