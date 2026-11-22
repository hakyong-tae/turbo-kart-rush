// Text too small to read in a portal's iframe: a first session walked at a small window, every
// piece of visible text measured.
//
//   node tools/small-text-check.mjs <base> [outDir=marketing/.audit/small-text] [w=821] [h=462] [pc|touch] [min=11]
//
// CrazyGames asks that text be legible at 907x510 and 821x462 (desktop iframe) and 800x450
// (mobile), at a device pixel ratio of 1. This walks the grid, the coach, the race HUD, the
// results screen, the lobby, check-in, missions, the garage, settings, the racer and circuit
// pickers, and lists every text node drawn smaller than `min` CSS pixels, anything cut off with
// an ellipsis, and anything outside the window. An AI drives the one race it needs (dev server
// only: it uses the `__tkr` hook). About three minutes.
//
// Exit code 1 when any text is under the minimum.
// (Grew out of the coordinating session's r2-audit/sizes.mjs.)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE, OUT = 'marketing/.audit/small-text', W = '821', H = '462', MODE = 'pc', MIN = '11'] = process.argv.slice(2);
if (!BASE) {
  console.error('usage: node tools/small-text-check.mjs <base> [outDir] [w] [h] [pc|touch] [min]');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const tag = `${W}x${H}-${MODE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const found = { small: new Map(), clipped: new Map(), off: new Map() };

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1, isMobile: MODE === 'touch', hasTouch: MODE === 'touch' });
await page.evaluateOnNewDocument((lang) => {
  try {
    if (!sessionStorage.getItem('audit.init')) {
      localStorage.clear();
      sessionStorage.setItem('audit.init', '1');
    }
    localStorage.setItem('tkr.lang', lang);
    // The results screen would otherwise go on to the next race while this looks at it.
    localStorage.setItem('tkr.autoNext', '0');
  } catch {}
}, process.env.LANG_UI || 'en');
page.on('pageerror', (e) => console.warn('[pageerror]', e.message));
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

async function look(name) {
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const a = await page.evaluate((min) => {
    const out = { small: [], clipped: [], off: [] };
    for (const e of document.querySelectorAll('#ui *')) {
      if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') continue;
      const own = [...e.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim())
        .join(' ');
      if (!own) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cls = e.className.toString().split(' ').filter(Boolean).slice(0, 2).join('.');
      const size = parseFloat(cs.fontSize);
      if (size < min) out.small.push([`.${cls}`, `${size.toFixed(1)}px "${own.slice(0, 40)}"`]);
      if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow === 'ellipsis') out.clipped.push([`.${cls}`, `"${own.slice(0, 40)}"`]);
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) out.off.push([`.${cls}`, `"${own.slice(0, 30)}" at ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`]);
    }
    return out;
  }, +MIN);
  for (const kind of ['small', 'clipped', 'off']) {
    for (const [cls, what] of a[kind]) if (!found[kind].has(cls)) found[kind].set(cls, `${what} (${name})`);
  }
}

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => ['countdown', 'racing'].includes(document.getElementById('ui')?.dataset.state), { timeout: 60000 });
await sleep(1200);
await look('01-grid-coach');
if (MODE === 'touch') await page.touchscreen.tap(+W - 80, +H - 80);
else {
  await page.keyboard.down('KeyW');
  await sleep(400);
  await page.keyboard.up('KeyW');
}
await sleep(800);
await look('02-coach');
await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'racing', { timeout: 60000 }).catch(() => {});
await page.evaluate(async () => {
  const { AIDriver } = await import('/src/ai/AIDriver.ts');
  const r = window.__tkr.getRace();
  r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], 'hard', 0);
});
await sleep(9000);
await look('03-hud');
await sleep(25000);
await look('04-hud-later');
await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'results', { timeout: 420000 });
await page.waitForFunction(() => document.querySelector('.reward-paid, .reward-failed'), { timeout: 15000 }).catch(() => {});
await sleep(3500);
await look('05-results');
const scroll = await page.evaluate(() => {
  const p = document.querySelector('.results-panel');
  return p ? p.scrollHeight - p.clientHeight : 0;
});
await click('.results-panel .actions .btn.ghost');
await sleep(2500);
await look('06-lobby-checkin');
await click('.attendance-claim');
await sleep(1200);
await look('07-checkin-claimed');
await click('.attendance-close');
await sleep(500);
await look('08-lobby');
await click('.missions-toggle');
await look('09-missions');
await click('.missions-panel .actions button', 'last');
if (await click('.garage-toggle')) {
  await sleep(1000);
  const tabs = await page.evaluate(() => document.querySelectorAll('.garage-tab').length);
  for (let i = 0; i < tabs; i++) {
    await click('.garage-tab', i);
    await look(`10-garage-${i}`);
  }
  await click('.garage-close');
  await sleep(300);
}
await click('.settings-toggle');
await look('11-settings');
await page.keyboard.press('Escape');
await sleep(300);
await click('.records-toggle');
await sleep(600);
await look('12-records');
await page.keyboard.press('Escape');
await sleep(300);
await click('.single-toggle');
await sleep(1500);
await look('13-racers');
await page.evaluate(() => document.querySelector('.char-card:not(.locked)')?.click());
await click('.panel-chars .next-btn');
await sleep(900);
await look('14-circuits');

const list = (m) => [...m.entries()].map(([cls, what]) => `${cls}  ${what}`);
writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({ small: list(found.small), clipped: list(found.clipped), off: list(found.off), resultsScroll: scroll }, null, 1));
console.log(`${tag}: ${found.small.size} kinds of text under ${MIN}px, ${found.clipped.size} cut off, ${found.off.size} outside the window, results panel scrolls ${scroll}px`);
for (const line of list(found.small)) console.log(`  small    ${line}`);
for (const line of list(found.clipped)) console.log(`  cut off  ${line}`);
for (const line of list(found.off)) console.log(`  outside  ${line}`);
await browser.close();
process.exit(found.small.size ? 1 : 0);
