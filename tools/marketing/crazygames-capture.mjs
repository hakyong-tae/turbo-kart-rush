// CrazyGames covers and preview videos for Drift Kart: capture stage.
//
//   npx vite --mode crazygames --port 4942 --strictPort &     # dev server, CrazyGames edition
//   WORK=<dir> node tools/marketing/crazygames-capture.mjs race "Neon Nexus" [seconds] [skipSeconds]
//   WORK=<dir> node tools/marketing/crazygames-capture.mjs hero "Coral Coast" [seconds] [skipSeconds]
//
// race → $WORK/race/<slug>/f0000.jpg … (2880×1620, HUD hidden, one per 1/30 s) plus scores.json
//        (what the camera saw in each frame). One capture feeds both videos: landscape is the frame
//        scaled to 1920×1080, portrait is its centre 1080×1620.
// hero → $WORK/hero/<slug>/*.png: the same race, but whenever the player kart is drifting or
//        boosting, the standing frame is re-shot from a low camera near the kart (cover art, not a
//        screenshot of the chase view).
//
// The dev autopilot (`?auto=1`) drives the player. The save is an old one so all 16 circuits are open.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

// lib.mjs reads BASE as it loads, so the default port is set first and the import comes after.
process.env.BASE = process.env.BASE || 'http://localhost:4942';
const { BASE, launch, takeControlOfTime, attachActionLog, sampleAction, hideChrome, sleep } = await import('./lib.mjs');

const [MODE = 'race', TRACK = 'Coral Coast', SECONDS = '20', SKIP = '6'] = process.argv.slice(2);
const RACER = process.env.RACER || 'Zippy Nova';
const WORK = process.env.WORK;
if (!WORK) throw new Error('set WORK');
const FPS = 30;
const STEP = 1000 / FPS;
const slug = TRACK.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const OUT = `${WORK}/${MODE}/${slug}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Camera placements relative to the player kart: forward / right / up in metres, look-at height,
// vertical field of view.
const CAMERAS = {
  front: { f: 5.2, r: 2.6, u: 1.15, look: 0.55, fov: 42 },
  low: { f: 4.2, r: 3.4, u: 0.55, look: 0.7, fov: 50 },
  rear: { f: -4.6, r: 2.2, u: 1.3, look: 0.6, fov: 48 },
  // Close-ups for cover art: the kart fills a third of the frame, rivals behind it.
  c1: { f: 3.4, r: 1.5, u: 0.75, look: 0.5, fov: 40 },
  c2: { f: 3.0, r: 2.2, u: 0.42, look: 0.62, fov: 46 },
  c3: { f: 4.2, r: 0.9, u: 0.95, look: 0.5, fov: 34 },
};

function placeCamera(cam) {
  const g = window.__tkr.game;
  const r = window.__tkr.getRace();
  const me = r.karts.find((k) => k.state.isPlayer);
  const s = me.state;
  const c = g.camera;
  if (!window.__camSave) window.__camSave = { p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov };
  const fx = -Math.sin(s.heading), fz = -Math.cos(s.heading);
  const rx = -fz, rz = fx;
  const side = cam.side ?? 1;
  c.position.set(s.position.x + fx * cam.f + rx * cam.r * side, s.position.y + cam.u, s.position.z + fz * cam.f + rz * cam.r * side);
  c.fov = cam.fov;
  c.updateProjectionMatrix();
  c.lookAt(s.position.x, s.position.y + cam.look, s.position.z);
  c.updateMatrixWorld(true);
  g.render(0);
  let near = 0;
  for (const k of r.karts) {
    if (k === me) continue;
    const d = Math.hypot(k.state.position.x - s.position.x, k.state.position.z - s.position.z);
    if (d < 14) near++;
  }
  return { near };
}

function restoreCamera() {
  const c = window.__tkr.game.camera;
  const s = window.__camSave;
  if (!s) return;
  c.position.copy(s.p);
  c.quaternion.copy(s.q);
  c.fov = s.fov;
  c.updateProjectionMatrix();
  window.__camSave = null;
}

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('tkr.lang', 'en');
      localStorage.setItem('tkr.nudged', '1');
      if (!localStorage.getItem('tkr.local.user')) localStorage.setItem('tkr.local.user', JSON.stringify({ coins: 300, xp: 120 }));
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  [pageerror]', e.message));
  await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'), null, { timeout: 60000 });
  await sleep(1500);

  const picked = await page.evaluate(
    async ([racer, track]) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((n) => n.textContent.toLowerCase().includes(text.toLowerCase()));
      document.querySelector('.single-toggle').click();
      await wait(700);
      const c = byText('.char-card', racer);
      c?.click();
      [...document.querySelectorAll('.panel-chars .actions button')].at(-1).click();
      await wait(700);
      const t = byText('.track-card', track);
      t?.click();
      await wait(250);
      [...document.querySelectorAll('.panel-tracks .actions button')].at(-1).click();
      return { racer: !!c, track: !!t, cls: t?.className, cards: document.querySelectorAll('.track-card').length };
    },
    [RACER, TRACK],
  );
  console.log('picked', JSON.stringify(picked));
  if (!picked.racer || !picked.track) throw new Error('racer or circuit card not found');
  await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'countdown', null, { timeout: 90000 });
  await hideChrome(page, { hud: false });
  await page.addStyleTag({ content: '.coach-card, .hud-feed, .hud-hints, .mute-indicator, .orientation-gate { display: none !important; } * { cursor: none !important; }' });
  await takeControlOfTime(page);
  await attachActionLog(page);

  for (let i = 0; i < 400; i++) {
    await page.evaluate((dt) => window.__step(dt, 3), STEP);
    if ((await page.evaluate(() => document.getElementById('ui').dataset.state)) === 'racing') break;
  }
  await page.evaluate(([dt, n]) => window.__step(dt, n), [STEP, Math.round(Number(SKIP) * FPS)]);

  const total = Math.round(Number(SECONDS) * FPS);
  if (MODE === 'race') {
    const scores = [];
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate((dt) => window.__step(dt), STEP);
      scores.push(await sampleAction(page));
      await page.screenshot({ path: `${OUT}/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 });
      if (i % 90 === 0) console.log(`  ${slug} frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(scores.at(-1)));
      if (scores.at(-1)?.state !== 'racing') break;
    }
    writeFileSync(`${OUT}/scores.json`, JSON.stringify(scores));
  } else {
    let shots = 0;
    let cooldown = 0;
    const want = (process.env.CAMS || 'front,low,rear').split(',');
    for (let i = 0; i < total && shots < Number(process.env.MAX || 30); i++) {
      await page.evaluate((dt) => window.__step(dt), STEP);
      if (cooldown-- > 0) continue;
      const a = await sampleAction(page);
      if (!a || a.state !== 'racing') break;
      const good = process.env.ALL ? !a.spin : (a.drift >= 1 || a.boost) && !a.spin && !a.air;
      if (!good) continue;
      for (const name of want) {
        for (const side of [1, -1]) {
          const info = await page.evaluate(placeCamera, { ...CAMERAS[name], side });
          await page.screenshot({ path: `${OUT}/h${String(i).padStart(4, '0')}_${name}${side > 0 ? 'R' : 'L'}_d${a.drift}b${a.boost}_n${info.near}.jpg`, type: 'jpeg', quality: 95 });
        }
      }
      await page.evaluate(restoreCamera);
      shots++;
      cooldown = Number(process.env.EVERY || 15);
    }
    console.log(`  ${slug}: ${shots} hero moments`);
  }
  await ctx.close();
} finally {
  await browser.close();
}
