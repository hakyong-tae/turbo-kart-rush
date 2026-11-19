// First-session walk: fresh storage, no ?auto, an AI drives the player so the run still earns.
//   node first-session.mjs <base> <outDir> <pc|phone> <ko|en>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE, OUT, SIZE = 'pc', LANG = 'en'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const log = [];
const t0 = Date.now();
const note = (k, v) => {
  log.push({ at: ((Date.now() - t0) / 1000).toFixed(1), k, v });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${k}`, typeof v === 'string' ? v.slice(0, 400) : JSON.stringify(v ?? '').slice(0, 400));
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport(SIZES[SIZE]);
await page.evaluateOnNewDocument((l) => {
  try {
    if (!sessionStorage.getItem('audit.init')) {
      localStorage.clear();
      sessionStorage.setItem('audit.init', '1');
    }
    localStorage.setItem('tkr.lang', l);
  } catch {}
}, LANG);
page.on('pageerror', (e) => note('pageerror', e.message));

const shot = (name) => page.screenshot({ path: `${OUT}/${SIZE}-${LANG}-${name}.png` });
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
      .map((b) => `${b.innerText.trim().replace(/\s+/g, ' ')}<${b.className.split(' ').slice(0, 4).join('.')}>`),
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
const save = () => page.evaluate(() => localStorage.getItem('tkr.local.user'));

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'));
await page.evaluate(() => document.fonts.ready);
note('title-ready');
await sleep(2500);
await shot('01-first-open');
note('buttons@open', await visibleButtons());
note('attendance', await visibleText('.attendance-panel'));
if (await click('.attendance-claim')) {
  await sleep(1500);
  await shot('02-after-claim');
  note('attendance-after-claim', await visibleText('.attendance-panel'));
  await click('.attendance-close');
  await sleep(500);
}
await shot('03-lobby');
note('profile', await visibleText('.lobby-profile'));
note('buttons@lobby', await visibleButtons());

// mission panel
const missionBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /mission/i.test(x.className));
  if (b) b.click();
  return b ? b.className : null;
});
note('mission-button', missionBtn);
await sleep(500);
await shot('04-missions');
note('missions', await visibleText('.missions-panel'));
await click('.missions-panel .actions button', 'last');
await sleep(300);

async function raceOnce(n, first) {
  const tStart = Date.now();
  if (first) {
    await click('.single-toggle');
    await sleep(900);
    await shot(`1${n}-chars`);
    note('chars-buttons', await visibleButtons());
    await click('.panel-chars .actions button', 'last');
    await sleep(900);
    await shot(`1${n}-tracks`);
    note('tracks-buttons', await visibleButtons());
    await click('.panel-tracks .actions button', 'last');
  }
  await waitState('loading', 10000).catch(() => {});
  await sleep(400);
  await shot(`2${n}-loading`);
  note(`loading-text-${n}`, await visibleText('.loading, .screen.loading, .loading-panel'));
  await waitState('racing', 90000);
  note(`race-${n}-start`, `menu-to-go ${(Date.now() - tStart) / 1000}s`);
  // An AI takes the wheel, but the run stays ranked (playerAutoDriverBeforeFinish untouched).
  await page.evaluate(async () => {
    const { AIDriver } = await import('/src/ai/AIDriver.ts');
    const r = window.__tkr.getRace();
    r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], 'hard', 0);
  });
  await sleep(15000);
  await shot(`3${n}-race-15s`);
  await sleep(30000);
  await shot(`3${n}-race-45s`);
  const tRace = Date.now();
  await waitState('results', 400000);
  note(`race-${n}-results`, `race took ~${(Date.now() - tRace + 45000) / 1000}s wall`);
  await sleep(1200);
  await shot(`4${n}-results-a`);
  await sleep(4500);
  await shot(`4${n}-results-b`);
  note(`results-${n}`, await visibleText('.results-panel'));
  note(`results-buttons-${n}`, await visibleButtons());
  note(`toasts-${n}`, await visibleText('.toast, .toasts'));
  note(`save-${n}`, await save());
}

await raceOnce(1, true);
// "race again": the first visible button in the results footer
const again = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.results-panel button.primary')].filter((x) => x.offsetParent !== null)[0];
  if (b) b.click();
  return b ? b.innerText : null;
});
note('clicked-after-results', again);
await sleep(600);
note('state-after-again', await state());
await raceOnce(2, false);

// back to lobby
const lobby = await page.evaluate(() => {
  const bs = [...document.querySelectorAll('.results-panel button')].filter((x) => x.offsetParent !== null);
  const b = bs.find((x) => /lobby|로비/i.test(x.innerText)) || bs[bs.length - 1];
  if (b) b.click();
  return b ? b.innerText : null;
});
note('clicked-lobby', lobby);
await sleep(2500);
await shot('50-lobby-after');
note('profile-after', await visibleText('.lobby-profile'));
note('attendance-after', await visibleText('.attendance-panel'));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /mission/i.test(x.className));
  if (b) b.click();
});
await sleep(500);
await shot('51-missions-after');
note('missions-after', await visibleText('.missions-panel'));
await click('.missions-panel .actions button', 'last');
await sleep(300);
if (await click('.garage-toggle')) {
  await sleep(1200);
  await shot('52-garage');
  await click('.garage-tab', 1);
  await sleep(500);
  await shot('53-garage-livery');
  note('garage', (await visibleText('.garage, .garage-panel'))?.slice(0, 900));
}
writeFileSync(`${OUT}/${SIZE}-${LANG}-log.json`, JSON.stringify(log, null, 1));
await browser.close();
