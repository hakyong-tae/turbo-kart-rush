// Regression check: disposing a race while its shaders are still compiling must be harmless.
//
//   node tools/restart-during-load-check.mjs [http://localhost:5178]      exit 0 = pass
//
// Starts a race, and the moment that race has been built and its shader warm-up kicked off, asks
// for a second start — the first race is disposed mid-compile. This used to throw
// "Cannot read properties of undefined (reading 'isReady')" from a three.js timer, and left the
// item warm-up meshes in the scene. Nothing in the menus does this on its own (the start button is
// hidden by then); a capture script that clicked twice did, and an online room can (the host
// leaving, or a second START, while everyone is loading).
//
// Also runs one ordinary start, to show the warm-up still completes on its own rather than by the
// 8 s timeout.
import { createRequire } from 'node:module';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5178';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--mute-audio', '--disable-background-timer-throttling'],
});

async function run(restart) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('tkr.lang', 'en');
      localStorage.setItem('tkr.nudged', '1');
    } catch {}
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'));
  await sleep(600);
  await page.evaluate((restart) => {
    const game = window.__turboKartRush;
    const info = (window.__check = { starts: 0, warmed: 0, warmAt: 0, countdownAt: 0 });
    const start = game.startRace;
    game.startRace = function (...args) {
      info.starts++;
      return start.apply(this, args);
    };
    // warmShaders() runs right after a race is built: on return its compile is under way.
    const warm = game.warmShaders;
    game.warmShaders = function (...args) {
      const out = warm.apply(this, args);
      info.warmed++;
      info.warmAt = performance.now();
      if (restart && info.warmed === 1) queueMicrotask(() => document.querySelector('.panel-tracks .start').click());
      return out;
    };
    const countdown = game.enterCountdown;
    game.enterCountdown = function (...args) {
      info.countdownAt = performance.now();
      return countdown.apply(this, args);
    };
  }, restart);
  await page.evaluate(() => {
    document.querySelector('.single-toggle').click();
    const next = [...document.querySelectorAll('.panel-chars .actions button')].pop();
    next.click();
    document.querySelector('.panel-tracks .start').click();
  });
  await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'racing', { timeout: 60000 });
  await sleep(500);
  const info = await page.evaluate(() => ({
    ...window.__check,
    leftover: window.__turboKartRush.scene.children.filter((c) => c.name === 'item-warmup').length,
  }));
  await page.close();
  const loadMs = Math.round(info.countdownAt - info.warmAt);
  const problems = [];
  if (errors.length) problems.push(`page error: ${errors[0]}`);
  if (info.leftover) problems.push(`${info.leftover} warm-up group(s) left in the scene`);
  if (restart && (info.starts !== 2 || info.warmed !== 2)) problems.push(`expected 2 starts and 2 builds, saw ${info.starts} / ${info.warmed}`);
  if (!restart && loadMs > 6000) problems.push(`warm-up took ${loadMs} ms: it timed out instead of completing`);
  const label = restart ? 'second start while the first race is compiling' : 'ordinary start';
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${label}: starts ${info.starts}, builds ${info.warmed}, warm-up to countdown ${loadMs} ms${problems.length ? '  <- ' + problems.join('; ') : ''}`);
  return problems.length === 0;
}

let ok = true;
for (const restart of [false, true, true]) ok = (await run(restart)) && ok;
await browser.close();
process.exit(ok ? 0 : 1);
