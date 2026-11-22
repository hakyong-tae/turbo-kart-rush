// CrazyGames edition check: walks a built `dist-crazygames/` and reads every word it shows.
//
//   npm run build:crazygames
//   npx vite preview --mode crazygames --outDir dist-crazygames --port 5180
//   node tools/crazygames-check.mjs [http://localhost:5180] [outDir] [ko|en] [--no-race]
//
// What it checks (relaunch spec §4.8 and §6):
//   * the built files are under 20 MB and contain none of "VX", "WATCH AD", "Drift Dash"
//   * the first screen (the grid of the first race) is up in under 10 seconds
//   * the page title and the wordmark say Drift Kart
//   * no screen shows wording that belongs to the Verse8 edition: the lobby, missions, check-in,
//     settings, records, every garage tab, the locked-kart sheet, the circuit picker and — unless
//     --no-race — a results screen (reached by sitting through one race untouched, about 3 minutes)
//   * a bare translation key never reaches the screen (a removed line that was reachable after all)
//   * every request of the whole walk goes to the build's own host — no font, script or beacon
//     from anywhere else — and the three fonts load from the build
//
// Exit code 1 when a check fails.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [BASE = 'http://localhost:5180', OUT = 'marketing/.audit/crazygames', LANG = 'en'] = argv.filter((a) => !a.startsWith('--'));
const RACE = !flags.includes('--no-race');
const DIST = 'dist-crazygames';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** Wording of the other edition, and the shape of a translation key printed bare. */
const FORBIDDEN = /\bVX\b|WATCH AD|Drift Dash|DRIFT DASH|Verse8|광고/;
const BARE_KEY = /\b(v8|garage|att|mis|rewards|buy|lobby|results|settings|lb|hint|feed|coach|ladder|track|tomorrow|earn|menu|cos)\.[a-zA-Z0-9.@]+\b/;

// ---------------------------------------------------------------- the files
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const files = walk(DIST);
const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
check('the build is under 20 MB', bytes < 20 * 1024 * 1024, `${(bytes / 1024 / 1024).toFixed(2)} MB in ${files.length} files`);
for (const word of ['VX', 'WATCH AD', 'Drift Dash', 'DRIFT DASH']) {
  const hits = files.filter((f) => /\.(js|css|html)$/.test(f) && readFileSync(f, 'utf8').includes(word));
  check(`no "${word}" in the built files`, hits.length === 0, hits.join(', '));
}

// ---------------------------------------------------------------- the screens
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.evaluateOnNewDocument((l) => {
  try {
    if (!sessionStorage.getItem('audit.init')) {
      localStorage.clear();
      sessionStorage.setItem('audit.init', '1');
    }
    localStorage.setItem('tkr.lang', l);
    // The results screen would otherwise go on to the next race while this looks at it.
    localStorage.setItem('tkr.autoNext', '0');
  } catch {}
}, LANG);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const requests = [];
page.on('request', (r) => requests.push(r.url()));

const state = () => page.evaluate(() => document.getElementById('ui')?.dataset.state);
const shot = (name) => page.screenshot({ path: `${OUT}/${LANG}-${name}.png` });
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
/** Everything a player can read right now: text, tooltips and the names of icon buttons. */
const words = () =>
  page.evaluate(() => {
    const seen = [];
    const visible = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
    for (const e of document.querySelectorAll('#ui *, .v8-mock *')) {
      if (!visible(e)) continue;
      for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) seen.push(n.textContent.trim());
      for (const attr of ['title', 'aria-label', 'placeholder']) if (e.getAttribute(attr)) seen.push(e.getAttribute(attr));
    }
    return seen;
  });
const seenText = [];
async function read(screen) {
  await sleep(350);
  const list = await words();
  seenText.push({ screen, list });
  const bad = list.filter((w) => FORBIDDEN.test(w));
  const bare = list.filter((w) => BARE_KEY.test(w) && !/\s/.test(w));
  check(`${screen}: nothing from the other edition`, bad.length === 0, bad.join(' | '));
  check(`${screen}: no bare translation key`, bare.length === 0, bare.join(' | '));
  await shot(screen);
}

const t0 = Date.now();
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'countdown', { timeout: 30000 }).catch(() => {});
const firstScreen = (Date.now() - t0) / 1000;
check('the first race is on screen in under 10 seconds', (await state()) === 'countdown' && firstScreen < 10, `${firstScreen.toFixed(1)}s, state ${await state()}`);
check('the page title is Drift Kart', (await page.title()) === 'Drift Kart', await page.title());
await read('first-race-grid');

if (RACE) {
  // Start it and leave it alone: the field finishes, the player is waited for and then retired,
  // and the results screen comes up with whatever a retirement pays.
  await page.keyboard.down('KeyW');
  await sleep(300);
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'racing', { timeout: 30000 });
  await sleep(8000);
  await read('first-race-hud');
  await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'results', { timeout: 420000 });
  await page.waitForFunction(() => document.querySelector('.reward-paid, .reward-failed'), { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  await read('results');
  await click('.results-panel .actions .btn.ghost');
  await sleep(2000);
} else {
  // A second visit opens on the lobby (the first-visit decision is made once per device).
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'title', { timeout: 30000 });
  await sleep(2500);
}

const logo = await page.evaluate(() => document.querySelector('.panel-title-screen .logo')?.getAttribute('aria-label'));
check('the wordmark says DRIFT KART', logo === 'DRIFT KART', logo);
await read('lobby-checkin');
if (await click('.attendance-claim')) await read('checkin-claimed');
await click('.attendance-close');
await read('lobby');
await click('.missions-toggle');
await read('missions');
await click('.missions-panel .actions button', 'last');
await click('.attendance-toggle');
await read('checkin');
await click('.attendance-close');
await click('.daily-toggle');
await read('daily');
await page.keyboard.press('Escape');
await click('.records-toggle');
await sleep(800);
await read('records');
await page.keyboard.press('Escape');
await click('.settings-toggle');
await read('settings');
await page.keyboard.press('Escape');
await sleep(300);
if (await click('.garage-toggle')) {
  await sleep(900);
  const tabs = await page.evaluate(() => document.querySelectorAll('.garage-tab').length);
  for (let i = 0; i < tabs; i++) {
    await click('.garage-tab', i);
    await read(`garage-tab-${i}`);
  }
  // Something locked on the kart: the till, and what it offers.
  await click('.garage-tab', 1);
  await click('.garage-option.locked');
  await read('garage-trying-on');
  if (await click('.garage-unlock')) await read('garage-purchase-sheet');
  await click('.buy-close');
  await click('.garage-close');
  await sleep(300);
}
await click('.single-toggle');
await sleep(700);
await read('racers');
// A premium kart: the sheet that offers it.
await page.evaluate(() => {
  const card = document.querySelector('.char-card.locked');
  card?.click();
  card?.click();
});
await sleep(500);
await read('locked-kart-sheet');
const sheet = await page.evaluate(() => [...document.querySelectorAll('.lock-panel .btn')].filter((b) => b.offsetParent !== null).length);
check('the locked-kart sheet offers coins and a way back, nothing else', sheet === 2, `${sheet} buttons`);
await page.keyboard.press('Escape');
await sleep(300);
await page.evaluate(() => document.querySelector('.char-card:not(.locked)')?.click());
await click('.panel-chars .next-btn');
await sleep(800);
await read('circuits');

// The fonts come with the build (src/assets/fonts): each of the three has to load from here.
const fonts = await page.evaluate(async () => {
  const out = {};
  for (const family of ['Anton', 'Black Han Sans', 'Noto Sans KR']) {
    const sample = family === 'Anton' ? 'DRIFT' : '\uB808\uC774\uC2A4';
    const faces = await document.fonts.load(`20px "${family}"`, sample).catch(() => []);
    out[family] = faces.length > 0 && faces.every((f) => f.status === 'loaded');
  }
  return out;
});
for (const [family, loaded] of Object.entries(fonts)) check(`${family} loads from the build`, loaded);
await sleep(500);

// Every request the walk made, by host. `data:` and `blob:` URLs never leave the page.
const hosts = {};
for (const u of requests) {
  if (/^(data|blob):/.test(u)) continue;
  const host = new URL(u).host;
  hosts[host] = (hosts[host] ?? 0) + 1;
}
const own = new URL(BASE).host;
const external = Object.keys(hosts).filter((h) => h !== own);
console.log('requests by host:', JSON.stringify(hosts));
check('no page error', errors.length === 0, errors.join(' | '));
check('every request goes to the build itself', external.length === 0, external.join(', ') || `${hosts[own]} requests, all to ${own}`);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ` — failed: ${failed.map((c) => c.name).join('; ')}` : ''}`);
writeFileSync(`${OUT}/${LANG}-log.json`, JSON.stringify({ checks, firstScreen, hosts, external, seenText }, null, 1));
await browser.close();
process.exit(failed.length ? 1 : 0);
