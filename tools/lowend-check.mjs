// A slow device, simulated: the build under CPU throttling, from a first visit to a race.
//
//   node tools/lowend-check.mjs <base> [rates=1,4,6] [gfx=auto|low|medium|high] [pc|touch] [--no-race] [--trace]
//
// <base> is a served production build (`vite preview --mode crazygames --outDir dist-crazygames`)
// or the dev server. For each throttling rate, with empty storage, it records
//   * whether the first visit went straight to a race, and whether the lobby was ever shown on the way
//   * when the page's load event fired, how long the main thread was blocked before it, and when
//     the grid was on screen
//   * the frame rate of the race over two six-second stretches (unless --no-race)
//
// Throttling is CDP's Emulation.setCPUThrottlingRate: the CPU is slowed, the GPU is not, so this
// says nothing about a weak GPU. Run it alone: a second browser on the machine changes the numbers.
//
// Exit code 1 when a first visit shows the lobby or never reaches the grid at any rate.
// (Grew out of the coordinating session's r2-audit/boot.mjs and perf.mjs.)
import { createRequire } from 'node:module';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [BASE, RATES = '1,4,6', GFX = 'auto', MODE = 'pc'] = argv.filter((a) => !a.startsWith('--'));
if (!BASE) {
  console.error('usage: node tools/lowend-check.mjs <base> [rates] [gfx] [pc|touch] [--no-race]');
  process.exit(2);
}
const RACE = !flags.includes('--no-race');
const touch = MODE === 'touch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;

for (const rate of RATES.split(',').map(Number)) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport(touch ? { width: 800, height: 450, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1366, height: 768, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    try {
      if (!sessionStorage.getItem('lowend.init')) {
        localStorage.clear();
        sessionStorage.setItem('lowend.init', '1');
      }
      localStorage.setItem('tkr.lang', 'en');
    } catch {}
    // What the page went through, with the page's own clock.
    const log = (window.__lowend = { states: [], longTasks: [], load: null, lobbyShown: null, grid: null });
    const now = () => Math.round(performance.now());
    const watch = () => {
      const ui = document.getElementById('ui');
      if (!ui) return requestAnimationFrame(watch);
      const read = () => {
        const state = ui.dataset.state;
        const hidden = ui.classList.contains('first-boot');
        const last = log.states[log.states.length - 1];
        if (!last || last.state !== state || last.hidden !== hidden) log.states.push({ t: now(), state, hidden });
        // The lobby counts as shown once it is the state and nothing is holding it back.
        if (state === 'title' && !hidden && log.lobbyShown === null && log.grid === null) log.lobbyShown = now();
        if ((state === 'countdown' || state === 'racing') && log.grid === null) log.grid = now();
      };
      read();
      new MutationObserver(read).observe(ui, { attributes: true });
    };
    document.addEventListener('DOMContentLoaded', watch);
    addEventListener('load', () => (log.load = now()));
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) log.longTasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) });
      }).observe({ entryTypes: ['longtask'] });
    } catch {}
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });

  await page.goto(`${BASE}/${GFX === 'auto' ? '' : `?gfx=${GFX}`}`, { waitUntil: 'load', timeout: 120000 });
  // Long enough for a first visit to settle either way: on the grid, or on a lobby it will not leave.
  const deadline = Date.now() + 20000 + 4000 * rate;
  let log;
  while (Date.now() < deadline) {
    log = await page.evaluate(() => window.__lowend);
    if (log.grid !== null) break;
    if (log.lobbyShown !== null && Date.now() > deadline - 12000) break;
    await sleep(200);
  }
  log = await page.evaluate(() => window.__lowend);
  // Blocked time: everything over 50 ms, before the grid (or in all, if the grid never came).
  const until = log.grid ?? Infinity;
  const blocked = log.longTasks.filter((l) => l.t < until);
  const beforeLoad = log.longTasks.filter((l) => l.t < (log.load ?? Infinity));
  const sum = (list) => list.reduce((s, l) => s + l.ms, 0);
  const out = {
    rate,
    gfx: GFX,
    mode: MODE,
    firstRace: log.grid !== null && log.lobbyShown === null,
    lobbyShown: log.lobbyShown !== null,
    loadS: log.load === null ? null : +(log.load / 1000).toFixed(2),
    gridS: log.grid === null ? null : +(log.grid / 1000).toFixed(2),
    blockedBeforeLoadS: +(sum(beforeLoad) / 1000).toFixed(2),
    blockedBeforeGridS: +(sum(blocked) / 1000).toFixed(2),
    longestTaskS: +(Math.max(0, ...blocked.map((l) => l.ms)) / 1000).toFixed(2),
  };
  if (!out.firstRace) failed = true;
  // --trace: every change of state and every long task, for finding where the time went.
  if (flags.includes('--trace')) console.log(JSON.stringify({ states: log.states, longTasks: log.longTasks }));

  if (RACE) {
    const click = (sel, which = 0) =>
      page.evaluate(
        (s, w) => {
          const all = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null);
          const n = w === 'last' ? all[all.length - 1] : all[w];
          if (!n) return false;
          n.click();
          return true;
        },
        sel,
        which,
      );
    const inRace = () => page.evaluate(() => ['countdown', 'racing'].includes(document.getElementById('ui')?.dataset.state));
    if (!(await inRace())) {
      // The lobby came up: walk in through the menus so the race can still be timed.
      await sleep(1500);
      await click('.attendance-close');
      await sleep(400);
      await click('.single-toggle');
      await sleep(1200);
      await page.evaluate(() => document.querySelector('.char-card:not(.locked)')?.click());
      await click('.panel-chars .next-btn');
      await sleep(1200);
      await click('.panel-tracks .actions button', 'last');
      await page.waitForFunction(() => ['countdown', 'racing'].includes(document.getElementById('ui')?.dataset.state), { timeout: 120000 }).catch(() => {});
    }
    if (await inRace()) {
      if (touch) await page.evaluate(() => document.querySelector('.coach-skip, .race-coach button')?.click());
      await page.keyboard.down('KeyW');
      await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'racing', { timeout: 90000 }).catch(() => {});
      await sleep(4000);
      const fps = (ms) =>
        page.evaluate(
          (ms) =>
            new Promise((res) => {
              const ts = [];
              const t0 = performance.now();
              const f = (t) => {
                ts.push(t);
                if (t - t0 < ms) return requestAnimationFrame(f);
                const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b);
                res({ fps: +((1000 * d.length) / (ts[ts.length - 1] - ts[0])).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1) });
              };
              requestAnimationFrame(f);
            }),
          ms,
        );
      out.raceA = await fps(6000);
      await page.keyboard.down('KeyA');
      await sleep(600);
      await page.keyboard.up('KeyA');
      out.raceB = await fps(6000);
      out.canvas = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? `${c.width}x${c.height}` : null;
      });
    }
  }
  if (errors.length) out.errors = errors.slice(0, 3);
  console.log(JSON.stringify(out));
  await browser.close();
}
process.exit(failed ? 1 : 0);
