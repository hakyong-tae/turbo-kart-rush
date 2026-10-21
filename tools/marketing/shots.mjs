// ONE store screenshots for Drift Dash GP: raw in-game screens, no captions or overlays.
//
//   npx vite --port 4941 --strictPort &          # dev server (needed for ?auto=1)
//   node tools/marketing/shots.mjs [desktop|phone]   # both when omitted
//
// desktop → marketing/onestore-kit/ScreenShots/screenshot-01..08  (1280×720, DPR 1)
// phone   → marketing/onestore-kit/ScreenShots/phone-1..5        (844×390 @3 = 2532×1170, touch)
// Race shots come from a real race with the dev autopilot driving the player: every few frames
// the scene is scored (drift sparks / boost, a hit the camera can see, a pack ahead) and the
// best frames per category are kept under _work/cand-<profile>/ (override a pick with
// PICK_<profile>_<cat>=<file>; SCENES=a,b re-shoots only those scenes). Each output is PNG when ≤ 1.3 MB, else a high-quality JPG.
// Also writes _work/keyart/*.png (HUD hidden) for graphic.mjs.
import { mkdirSync, copyFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import {
  KIT, WORK, launch, openGame, startRace, takeControlOfTime, releaseTime, attachActionLog,
  sampleAction, hideChrome, saveCapped, sleep,
} from './lib.mjs';

const OUT = `${KIT}/ScreenShots`;
const FPS = 30;
const STEP = 1000 / FPS;

const PROFILES = {
  desktop: {
    view: { width: 1280, height: 720, dpr: 1, phone: false },
    racer: 0, // Zippy Nova
    tracks: [1, 5], // Coral Coast, Magma Ridge (best finish → results shot)
    name: (i) => `screenshot-${String(i).padStart(2, '0')}`,
    // order → scene
    plan: ['lobby', 'racers', 'tracks', 'drift', 'item', 'pack', 'garage', 'results'],
  },
  phone: {
    view: { width: 844, height: 390, dpr: 3, phone: true },
    racer: 3, // Max Vortex
    tracks: [4], // Neon Nexus
    name: (i) => `phone-${i}`,
    plan: ['lobby', 'drift', 'item', 'garage', 'daily'],
  },
  // HUD-free 1920×1080 race frames for graphic.mjs (no store screenshots).
  keyart: {
    view: { width: 1920, height: 1080, dpr: 1, phone: false },
    racer: 0,
    tracks: [5, 4],
    name: () => 'unused',
    plan: [],
    keyart: true,
  },
};

const want = process.argv[2] ? [process.argv[2]] : ['desktop', 'phone', 'keyart'];
mkdirSync(OUT, { recursive: true });
const browser = await launch();
try {
  for (const id of want) await runProfile(id, PROFILES[id]);
} finally {
  await browser.close();
}

async function runProfile(id, P) {
  console.log(`== ${id}`);
  const shots = {};
  const stem = (scene) => `${OUT}/${P.name(P.plan.indexOf(scene) + 1)}`;
  const only = process.env.SCENES?.split(',');
  const need = (scene) => P.plan.includes(scene) && (!only || only.includes(scene));

  // ── Menus ──────────────────────────────────────────────────────────────
  {
    const page = await openGame(browser, P.view);
    if (need('lobby')) {
      await sleep(1500);
      shots.lobby = await saveCapped(page, stem('lobby'));
    }
    if (need('racers') || need('tracks')) {
      await page.evaluate(() => document.querySelector('.single-toggle').click());
      await sleep(1800);
      if (need('racers')) shots.racers = await saveCapped(page, stem('racers'));
      await page.evaluate(() => [...document.querySelectorAll('.panel-chars .actions button')].at(-1).click());
      await sleep(1800);
      if (need('tracks')) {
        // Highlight a later, more dramatic circuit card than the default first one.
        await page.evaluate(() => [...document.querySelectorAll('.track-card')][5]?.click());
        await sleep(600);
        // At 1280×720 the card grid sits on top of the "2 / 2 단계 · 서킷 선택" header and only a
        // sliver of it peeks out; hide that sliver rather than ship a stray glyph.
        await page.addStyleTag({ content: '.panel-tracks .select-header { visibility: hidden !important; }' });
        await sleep(800);
        shots.tracks = await saveCapped(page, stem('tracks'));
      }
    }
    await page.context().close();
  }
  if (need('garage')) {
    const page = await openGame(browser, P.view);
    await page.evaluate(() => document.querySelector('.garage-toggle').click());
    await sleep(1200);
    // Local dev build: "차고 해금 · 100 VX" opens the in-memory mock checkout (no real purchase).
    await page.evaluate(() => document.querySelector('.garage-unlock')?.click());
    await sleep(600);
    await page.evaluate(() => document.querySelector('[data-mock="buy"]')?.click());
    await sleep(900);
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.garage-tab')].find((b) => /프리셋|Preset/i.test(b.textContent));
      tab?.click();
    });
    await sleep(500);
    await page.evaluate((pick) => {
      const opts = [...document.querySelectorAll('.garage-presets .garage-option')];
      (opts.find((b) => b.textContent.includes(pick)) || opts[11])?.click();
    }, process.env.GARAGE_PRESET || '홀로');
    await sleep(2500);
    await hideChrome(page);
    shots.garage = await saveCapped(page, stem('garage'));
    await page.context().close();
  }
  if (need('daily')) {
    const page = await openGame(browser, P.view);
    await page.evaluate(() => document.querySelector('.daily-toggle').click());
    await sleep(2500);
    // Off Verse8 the board cannot load and the panel says so; that line is a dev-only artefact.
    await page.addStyleTag({ content: '.daily-status { visibility: hidden !important; }' });
    shots.daily = await saveCapped(page, stem('daily'));
    await page.context().close();
  }

  // ── Race ───────────────────────────────────────────────────────────────
  const raceScenes = ['drift', 'item', 'pack', 'results'].filter(need);
  const keyart = Boolean(P.keyart);
  if (raceScenes.length || keyart) {
    const cand = `${WORK}/cand-${id}`;
    if (!only && raceScenes.length) rmSync(cand, { recursive: true, force: true });
    mkdirSync(cand, { recursive: true });
    const keyDir = `${WORK}/keyart`;
    if (keyart) rmSync(keyDir, { recursive: true, force: true });
    mkdirSync(keyDir, { recursive: true });
    const keyList = [];
    const score = {
      drift: (a) => (a.drift >= 2 || a.boost ? a.drift * 2 + a.boost * 2 + Math.min(a.pack, 3) * 0.6 + (a.air ? 1 : 0) : 0),
      item: (a) => (a.hit > 0 ? a.hit * 2 + Math.min(a.pack, 3) * 0.4 : 0),
      pack: (a) => (a.pack >= 3 ? a.pack + a.boost + (a.drift ? 1 : 0) : 0),
    };
    const KEEP = 10;
    const best = { drift: [], item: [], pack: [] };
    const results = [];
    let page = null;
    const tracks = process.env.TRACKS ? process.env.TRACKS.split(',').map(Number) : P.tracks;
    for (const ti of tracks) {
      if (page) await page.context().close();
      page = await openGame(browser, { ...P.view, query: '&auto=1' });
      await startRace(page, { ci: P.racer, ti });
      await takeControlOfTime(page);
      await hideChrome(page);
      await page.evaluate((dt) => window.__step(dt, 30 * 4.2), STEP); // countdown
      await attachActionLog(page);
      const lastAt = { drift: -999, item: -999, pack: -999, key: -999 };
      let keyBest = 0;
      for (let f = 0; f < FPS * 240; f++) {
        await page.evaluate((dt) => window.__step(dt), STEP);
        if (f % 3) continue;
        const a = await sampleAction(page);
        if (!a) continue;
        if (a.state !== 'racing') {
          if (a.state === 'results') break;
          continue;
        }
        for (const cat of Object.keys(best)) {
          if (!need(cat)) continue;
          const s = score[cat](a);
          const list = best[cat];
          const floor = list.length >= KEEP ? list[list.length - 1].s : 0;
          if (s <= 0 || s <= floor || f - lastAt[cat] < FPS) continue;
          lastAt[cat] = f;
          const saved = await saveCapped(page, `${cand}/${cat}_t${ti}_${String(f).padStart(5, '0')}`);
          list.push({ s, f, ti, file: saved });
          list.sort((x, y) => y.s - x.s);
          while (list.length > KEEP) rmSync(list.pop().file, { force: true });
        }
        // Key-art frames for graphic.mjs: big drift/boost/hit moments with the HUD hidden.
        if (keyart) {
          const k = Math.max(score.drift(a), score.item(a) * 1.2, score.pack(a));
          const floor = keyList.length >= 12 ? keyList[keyList.length - 1].k : 0;
          if (k >= 5 && k > floor && f - lastAt.key > FPS) {
            lastAt.key = f;
            // HUD hidden; the rear-view PiP is drawn into the WebGL frame, so switch it off and
            // re-render one frame without it.
            await hideChrome(page, { hud: false });
            await page.evaluate((dt) => {
              const hud = window.__tkr.getRace().hud;
              const real = hud.getMirrorRect;
              hud.getMirrorRect = () => null;
              window.__step(dt);
              hud.getMirrorRect = real;
            }, STEP);
            const file = `${keyDir}/t${ti}_${String(f).padStart(5, '0')}_${k.toFixed(1)}.png`;
            writeFileSync(file, await page.screenshot({ type: 'png' }));
            await hideChrome(page);
            keyList.push({ k, file });
            keyList.sort((x, y) => y.k - x.k);
            while (keyList.length > 12) rmSync(keyList.pop().file, { force: true });
          }
        }
        if (f % (FPS * 20) === 0) console.log(`  track ${ti} t=${(f / FPS).toFixed(0)}s lap ${a.lap} place ${a.place}`);
      }
      if (need('results')) {
        // Keep stepping until the autopilot crosses the line and the results panel is up;
        // the best finish across the races becomes the results shot.
        for (let i = 0; i < 400; i++) {
          const st = await page.evaluate(() => document.getElementById('ui').dataset.state);
          if (st === 'results') break;
          await page.evaluate((dt) => window.__step(dt, 30), STEP);
        }
        await releaseTime(page);
        await sleep(3500);
        await hideChrome(page);
        const place = await page.evaluate(() => window.__tkr.getRace()?.karts?.find((k) => k.state.isPlayer)?.state.place ?? 9);
        results.push({ place, file: await saveCapped(page, `${cand}/results_t${ti}_p${place}`) });
      }
    }
    writeFileSync(`${cand}/log.json`, JSON.stringify(best, null, 1));

    for (const cat of Object.keys(best)) {
      if (!need(cat)) continue;
      const override = process.env[`PICK_${id}_${cat}`];
      const src = override ? `${cand}/${override}` : best[cat][0]?.file;
      if (!src || !existsSync(src)) {
        console.warn(`  no ${cat} candidate`);
        continue;
      }
      const ext = src.endsWith('.jpg') ? 'jpg' : 'png';
      for (const e of ['png', 'jpg']) rmSync(`${stem(cat)}.${e}`, { force: true });
      copyFileSync(src, `${stem(cat)}.${ext}`);
      shots[cat] = `${stem(cat)}.${ext}`;
    }

    if (need('results')) {
      const r = results.sort((x, y) => x.place - y.place)[0];
      if (r) {
        for (const e of ['png', 'jpg']) rmSync(`${stem('results')}.${e}`, { force: true });
        const ext = r.file.endsWith('.jpg') ? 'jpg' : 'png';
        copyFileSync(r.file, `${stem('results')}.${ext}`);
        shots.results = `${stem('results')}.${ext}`;
      }
    }
    await page.context().close();
  }
  for (const [k, v] of Object.entries(shots)) console.log(`  ${k.padEnd(8)} → ${v}`);
}
