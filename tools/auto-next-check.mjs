// The results screen going on to the next race by itself (second-pass spec, P2-1), in a real game.
//
//   node tools/auto-next-check.mjs [http://localhost:5178] [outDir=marketing/.audit/auto-next]
//
// Needs the dev server (it puts an AI at the player's wheel through the dev-only `__tkr` hook).
// Three races from a fresh save, about seven minutes:
//   1. a key is pressed during the race, so a person was there: the primary button fills, shows the
//      seconds left, and the next race starts on another circuit without a click
//   2. nobody touches anything: it still goes on (one idle race is not yet "walked away")
//   3. nobody touches anything again: the screen now stays where it is
// And once more with the setting off: no countdown at all.
//
// Exit code 1 when a check fails.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE = 'http://localhost:5178', OUT = 'marketing/.audit/auto-next'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});

async function open(setup) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument((setup) => {
    try {
      if (!sessionStorage.getItem('audit.init')) {
        localStorage.clear();
        sessionStorage.setItem('audit.init', '1');
        for (const [k, v] of Object.entries(setup)) localStorage.setItem(k, v);
      }
      localStorage.setItem('tkr.lang', 'en');
    } catch {}
  }, setup);
  page.on('pageerror', (e) => check('no page error', false, e.message));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  return page;
}
const state = (page) => page.evaluate(() => document.getElementById('ui')?.dataset.state);
const trackId = (page) => page.evaluate(() => window.__tkr?.getRace()?.trackDef.id);
/** An AI drives the player's kart to the flag; the run stays an ordinary, ranked one. */
async function driveToResults(page, { touchKey }) {
  await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'countdown' && window.__tkr?.getRace(), { timeout: 60000 });
  await page.evaluate(async () => {
    const { AIDriver } = await import('/src/ai/AIDriver.ts');
    const r = window.__tkr.getRace();
    r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], 'hard', 0);
    document.querySelector('.coach-skip')?.click();
  });
  // The first race waits on the coach's card for a press of the throttle.
  if (await page.evaluate(() => Boolean(document.querySelector('.coach-card')))) {
    await page.keyboard.down('KeyW');
    await sleep(300);
    await page.keyboard.up('KeyW');
  }
  await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'racing', { timeout: 60000 });
  if (touchKey) {
    await sleep(3000);
    await page.keyboard.down('KeyA');
    await sleep(250);
    await page.keyboard.up('KeyA');
  }
  await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'results', { timeout: 300000 });
  return Date.now();
}
/** Watches the results screen: did a countdown show, and did the game leave it without a click? */
async function watch(page, name, seconds) {
  const from = await trackId(page);
  let sawFill = false;
  let firstCount = null;
  let leftAt = null;
  const t0 = Date.now();
  let shot = false;
  while (Date.now() - t0 < seconds * 1000) {
    const s = await page.evaluate(() => {
      const b = document.querySelector('.results-next-btn');
      return { state: document.getElementById('ui')?.dataset.state, auto: b?.classList.contains('auto'), count: b?.querySelector('.auto-count')?.textContent ?? null, label: b?.textContent ?? '' };
    });
    if (s.state !== 'results') {
      leftAt = (Date.now() - t0) / 1000;
      break;
    }
    if (s.auto) {
      sawFill = true;
      if (firstCount === null) firstCount = s.count;
      if (!shot && Number(s.count) <= 5) {
        shot = true;
        await page.screenshot({ path: `${OUT}/${name}.png` });
      }
    }
    await sleep(200);
  }
  if (!shot) await page.screenshot({ path: `${OUT}/${name}.png` });
  let to = from;
  if (leftAt !== null) {
    await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'countdown' && window.__tkr?.getRace(), { timeout: 60000 });
    to = await trackId(page);
  }
  return { sawFill, firstCount, leftAt, from, to };
}

// ---- on (the default) ---------------------------------------------------------------------
{
  const page = await open({});
  await driveToResults(page, { touchKey: true });
  const a = await watch(page, '1-played', 40);
  check('race 1 (a key was pressed): the primary button fills and counts down', a.sawFill && a.firstCount === '8', `first count ${a.firstCount}`);
  check('race 1: the next race starts by itself, on another circuit', a.leftAt !== null && a.to !== a.from, `after ${a.leftAt?.toFixed(1)}s, ${a.from} -> ${a.to}`);
  await driveToResults(page, { touchKey: false });
  const b = await watch(page, '2-idle-once', 40);
  check('race 2 (no input): one idle race still goes on', b.leftAt !== null && b.to !== b.from, `after ${b.leftAt?.toFixed(1)}s, ${b.from} -> ${b.to}`);
  await driveToResults(page, { touchKey: false });
  const c = await watch(page, '3-idle-twice', 25);
  check('race 3 (no input again): the screen stays', !c.sawFill && c.leftAt === null && (await state(page)) === 'results');
  await page.close();
}
// ---- off --------------------------------------------------------------------------------
{
  const page = await open({ 'tkr.autoNext': '0' });
  await driveToResults(page, { touchKey: true });
  const a = await watch(page, '4-setting-off', 25);
  check('with the setting off: no countdown, the screen stays', !a.sawFill && a.leftAt === null);
  await page.close();
}
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
