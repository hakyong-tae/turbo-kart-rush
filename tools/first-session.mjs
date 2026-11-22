// First-session walk (CrazyGames relaunch): fresh storage, no ?auto, an AI at the player's wheel
// with rewards left on. It plays the first three races the way a new player meets them and checks
// what the relaunch spec promises (docs/superpowers/specs/2026-11-20-drift-kart-crazygames-relaunch.md, §6):
//
//   * the first race starts with no click on a menu
//   * the player is not retired in the first three races
//   * every race opens at least one thing ("NEW …" card)
//   * the primary button on the results screen goes to the next circuit
//   * on a phone the results screen fits without scrolling
//
//   node tools/first-session.mjs <base> <outDir> <pc|phone> <ko|en> [easy|normal|hard] [races]
//   node tools/first-session.mjs <base> <outDir> <pc|phone> <ko|en> legacy     # an old save: 16 circuits open, lobby first
//
// The driver argument is the AI put at the wheel: `easy` (the default) stands in for a new player,
// slower than the field would be on any picked difficulty. Needs the dev server (it reaches into
// `window.__tkr`, which a production build does not expose). Exit code 1 when a check fails.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE, OUT, SIZE = 'pc', LANG = 'en', DRIVER = 'easy', RACES = '3'] = process.argv.slice(2);
if (!BASE || !OUT) {
  console.error('usage: node tools/first-session.mjs <base> <outDir> <pc|phone> <ko|en> [easy|normal|hard|legacy] [races]');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const LEGACY = DRIVER === 'legacy';
const log = [];
const checks = [];
const t0 = Date.now();
const note = (k, v) => {
  log.push({ at: ((Date.now() - t0) / 1000).toFixed(1), k, v });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${k}`, typeof v === 'string' ? v.slice(0, 400) : JSON.stringify(v ?? '').slice(0, 400));
};
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport(SIZES[SIZE]);
await page.evaluateOnNewDocument(
  (l, legacy) => {
    try {
      if (!sessionStorage.getItem('audit.init')) {
        localStorage.clear();
        sessionStorage.setItem('audit.init', '1');
        // An account from before the ladder: coins and experience, no ladder record.
        if (legacy) localStorage.setItem('tkr.local.user', JSON.stringify({ coins: 300, xp: 120 }));
      }
      localStorage.setItem('tkr.lang', l);
      // The results screen would otherwise go on to the next race while this looks at it.
      localStorage.setItem('tkr.autoNext', '0');
    } catch {}
  },
  LANG,
  LEGACY,
);
page.on('pageerror', (e) => note('pageerror', e.message));

const tag = `${SIZE}-${LANG}${LEGACY ? '-legacy' : ''}`;
const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
const state = () => page.evaluate(() => document.getElementById('ui')?.dataset.state);
const waitState = (s, timeout = 60000) => page.waitForFunction((x) => document.getElementById('ui').dataset.state === x, { timeout }, s);
const visibleText = (sel) =>
  page.evaluate((s) => {
    const n = [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null);
    return n ? n.innerText.replace(/\n+/g, ' | ') : null;
  }, sel);
const visibleButtons = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => `${(b.innerText.trim() || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ')}<${b.className.split(' ').slice(0, 4).join('.')}>`),
  );
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
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('tkr.local.user') ?? 'null'));
const race = () =>
  page.evaluate(() => {
    const r = window.__tkr?.getRace?.();
    if (!r) return null;
    const s = r.karts[r.localKartId].state;
    return { trackId: r.settings.trackId, intro: Boolean(r.settings.intro), difficulty: r.settings.difficulty, place: s.place, finished: s.finished, finishTime: s.finishTime, lap: s.lap };
  });

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'));
await page.evaluate(() => document.fonts.ready);
note('boot');

// ---------------------------------------------------------------- an old save
if (LEGACY) {
  await sleep(5000);
  check('an old save opens on the lobby, not in a race', (await state()) === 'title', await state());
  await shot('01-lobby');
  note('attendance', await visibleText('.attendance-panel'));
  await click('.attendance-close');
  await sleep(300);
  await click('.single-toggle');
  await sleep(700);
  await click('.panel-chars .next-btn');
  await sleep(900);
  await shot('02-tracks');
  const cards = await page.evaluate(() => ({
    total: document.querySelectorAll('.track-card').length,
    locked: document.querySelectorAll('.track-card.locked').length,
  }));
  check('an old save has all sixteen circuits open', cards.total === 16 && cards.locked === 0, JSON.stringify(cards));
  note('save', await save());
  writeFileSync(`${OUT}/${tag}-log.json`, JSON.stringify({ checks, log }, null, 1));
  await browser.close();
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

// ---------------------------------------------------------------- first visit
// No click: the page is left alone until it is sitting on the grid.
let onGrid = false;
for (let i = 0; i < 100 && !onGrid; i++) {
  onGrid = (await state()) === 'countdown';
  if (!onGrid) await sleep(200);
}
const gridAt = ((Date.now() - t0) / 1000).toFixed(1);
check('first visit reaches the grid with no click', onGrid, `${gridAt}s, state ${await state()}`);
await sleep(700);
await shot('01-grid');
note('coach', await visibleText('.coach-card'));
note('race', await race());

async function drive() {
  // An AI takes the wheel, but the run stays ranked (playerAutoDriverBeforeFinish untouched).
  await page.evaluate(async (level) => {
    const { AIDriver } = await import('/src/ai/AIDriver.ts');
    const r = window.__tkr.getRace();
    r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], level, 0);
  }, DRIVER);
}

const visited = [];
async function raceOnce(n) {
  const tStart = Date.now();
  if (n === 1) {
    // The coach's first card holds the lights: press go the way the card says.
    if (SIZE === 'phone') await page.touchscreen.tap(560, 210);
    else {
      await page.keyboard.down('KeyW');
      await sleep(300);
      await page.keyboard.up('KeyW');
    }
    await sleep(900);
    await shot('02-coach-next');
  }
  await waitState('racing', 90000);
  const started = await race();
  visited.push(started.trackId);
  note(`race-${n}-start`, { ...started, toGo: (Date.now() - tStart) / 1000 });
  await drive();
  await sleep(15000);
  await shot(`3${n}-race-15s`);
  note(`hud-${n}`, { hints: await visibleText('.hud-hint:not(.hidden)'), feed: await visibleText('.hud-feed'), stick: await page.evaluate(() => getComputedStyle(document.querySelector('.touch-controls')).display) });
  await sleep(30000);
  await shot(`3${n}-race-45s`);
  await waitState('results', 400000);
  await sleep(1500);
  const end = await race();
  check(`race ${n}: the player is not retired`, end.finishTime > 0, `place ${end.place}, ${end.finishTime > 0 ? end.finishTime.toFixed(1) + 's' : 'DNF'}, intro ${end.intro}`);
  // The settlement reply fills in the cards a moment after the screen opens.
  await page.waitForFunction(() => document.querySelector('.reward-paid, .reward-failed'), { timeout: 15000 }).catch(() => {});
  await sleep(1800);
  await shot(`4${n}-results`);
  const results = await page.evaluate(() => {
    const text = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).map((e) => e.innerText.replace(/\n+/g, ' · '));
    const panel = document.querySelector('.results-panel');
    const box = panel.getBoundingClientRect();
    const buttons = [...panel.querySelectorAll('.actions .btn')].filter((b) => b.offsetParent !== null);
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5;
    };
    const scrollers = [panel, ...panel.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    return {
      opened: text('.unlock-card'),
      next: text('.results-next'),
      tomorrow: text('.results-tomorrow'),
      reward: text('.results-rewards'),
      rows: text('.standing-row').length,
      primary: buttons[0]?.innerText.trim(),
      buttons: buttons.map((b) => b.innerText.trim() || b.getAttribute('aria-label')),
      fits: box.top >= 0 && box.bottom <= innerHeight + 0.5 && buttons.every(inView) && [...panel.querySelectorAll('.results-main > *')].filter((e) => e.offsetParent !== null).every(inView),
      scrolls: scrollers.map((e) => e.className),
      panel: { top: Math.round(box.top), bottom: Math.round(box.bottom), h: innerHeight },
    };
  });
  note(`results-${n}`, results);
  check(`race ${n}: something new opened`, results.opened.length > 0, results.opened.join(' / '));
  if (SIZE === 'phone') check(`race ${n}: the phone results screen fits without scrolling`, results.fits && results.scrolls.length === 0, JSON.stringify({ panel: results.panel, scrolls: results.scrolls }));
  note(`save-${n}`, await save());
  return results;
}

const total = Math.max(1, Number(RACES) || 3);
for (let n = 1; n <= total; n++) {
  await raceOnce(n);
  if (n === total) break;
  // The primary button: on to the next circuit.
  const before = visited[visited.length - 1];
  const pressed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.results-panel .actions .btn.primary')].filter((x) => x.offsetParent !== null)[0];
    if (b) b.click();
    return b ? b.innerText.trim() : null;
  });
  note('primary', pressed);
  await page.waitForFunction(() => ['loading', 'countdown', 'racing'].includes(document.getElementById('ui').dataset.state), { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => window.__tkr?.getRace?.() && ['countdown', 'racing'].includes(document.getElementById('ui').dataset.state), { timeout: 90000 });
  const next = await race();
  check(`after race ${n}: the primary button goes to another circuit`, next.trackId !== before, `${before} -> ${next.trackId} via "${pressed}"`);
}
check('three different circuits in three races', new Set(visited).size === visited.length, visited.join(' -> '));

// ---------------------------------------------------------------- back in the lobby
const lobby = await page.evaluate(() => {
  const bs = [...document.querySelectorAll('.results-panel .actions .btn')].filter((x) => x.offsetParent !== null);
  const b = bs.find((x) => /lobby|로비/i.test(x.innerText));
  if (b) b.click();
  return b ? b.innerText.trim() : null;
});
note('clicked-lobby', lobby);
await sleep(2500);
await shot('50-lobby-checkin');
note('attendance', await visibleText('.attendance-panel'));
check('the check-in window opens on the first return to the lobby', Boolean(await visibleText('.attendance-panel')));
if (await click('.attendance-claim')) {
  await sleep(1500);
  await shot('51-checkin-claimed');
  note('attendance-after-claim', await visibleText('.attendance-panel'));
  note('tomorrow', await visibleText('.attendance-tomorrow'));
}
await click('.attendance-close');
await sleep(500);
await shot('52-lobby');
note('profile', await visibleText('.lobby-profile'));
note('buttons@lobby', await visibleButtons());
await click('.missions-toggle');
await sleep(500);
await shot('53-missions');
note('missions', await visibleText('.missions-panel'));
await click('.missions-panel .actions button', 'last');
await sleep(300);
if (await click('.garage-toggle')) {
  await sleep(1200);
  await shot('54-garage');
  await click('.garage-tab', 1);
  await sleep(500);
  await shot('55-garage-livery');
  note('garage', (await visibleText('.garage-panel'))?.slice(0, 900));
  await click('.garage-close');
  await sleep(400);
}
await click('.single-toggle');
await sleep(700);
await click('.panel-chars .next-btn');
await sleep(900);
await shot('56-tracks');
const cards = await page.evaluate(() => ({
  total: document.querySelectorAll('.track-card').length,
  locked: document.querySelectorAll('.track-card.locked').length,
  chips: [...document.querySelectorAll('.track-lock:not(.hidden)')].slice(0, 3).map((e) => e.innerText),
}));
note('tracks', cards);
check('a new save has opened one circuit per finished race on top of four', cards.total - cards.locked === 4 + total, JSON.stringify(cards));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ` — failed: ${failed.map((c) => c.name).join('; ')}` : ''}`);
writeFileSync(`${OUT}/${tag}-log.json`, JSON.stringify({ checks, log }, null, 1));
await browser.close();
process.exit(failed.length ? 1 : 0);
