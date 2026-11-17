// Screenshot every screen so layout overlaps can be eyeballed: a landscape phone (844x390, touch)
// and a desktop window (1280x720, keyboard), in Korean and English.
//
//   node tools/mobile-audit.mjs [http://localhost:5178] [--out <dir>] [--only phone|pc] [--lang ko|en] [--hud] [--no-flow] [--phone-fonts]
//
//   --out   where the PNGs go (default marketing/.audit). Use a folder per round to compare
//           before / after:  --out marketing/.audit/ui-poster/before
//   --hud   also capture the race HUD on a bright and a dark pair of circuits, plus a team race
//   --only  one of the two sizes
//   --lang  one of the two languages
//   --phone-fonts  render as a phone does: Impact and the other desktop-only display faces are
//           dropped from the font stack, so the web-font fallback (Anton / Black Han Sans) draws
//           the display type. The Mac this runs on has Impact; a phone does not, and that
//           difference once left the English UI in a thin system face that nobody saw here.
//
// Headless and muted. Selectors are the ones the game keeps stable for tooling:
// .single-toggle .settings-toggle .records-toggle .daily-toggle .garage-toggle .online-toggle.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = argv.find((a) => a.startsWith('http')) || 'http://localhost:5178';
const OUT = opt('--out', 'marketing/.audit');
const ONLY = opt('--only', '');
const LANG = opt('--lang', '');
const LANGS = ['ko', 'en'].filter((l) => !LANG || l === LANG);
const PHONE_FONTS = flag('--phone-fonts');
const DESKTOP_ONLY_FACES = ['impact', 'haettenschweiler', 'arial narrow bold', 'arial narrow', 'franklin gothic medium', 'arial black'];
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
/** Bright pair and dark pair: the HUD has to read on both. */
const HUD_TRACKS = ['SUNNY CIRCUIT', 'CORAL COAST', 'NEON NEXUS', 'MAGMA RIDGE'];

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--use-gl=angle',
    '--use-angle=metal',
    '--disable-background-timer-throttling',
    '--mute-audio',
  ],
});

async function open(size, lang, extraStorage = {}) {
  const page = await browser.newPage();
  await page.setViewport(SIZES[size]);
  await page.evaluateOnNewDocument(
    (l, extra) => {
      try {
        localStorage.setItem('tkr.lang', l);
        localStorage.setItem('tkr.nudged', '1');
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      } catch {}
    },
    lang,
    extraStorage,
  );
  page.on('pageerror', (e) => console.log(`  [pageerror ${size}/${lang}] ${e.message}`));
  await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
  if (PHONE_FONTS) {
    await page.waitForFunction(() => document.styleSheets.length > 0);
    await page.evaluate((gone) => {
      const root = document.documentElement;
      const kept = getComputedStyle(root)
        .getPropertyValue('--display')
        .split(',')
        .map((f) => f.trim())
        .filter((f) => !gone.includes(f.replace(/['"]/g, '').toLowerCase()));
      root.style.setProperty('--display', kept.join(', '), 'important');
    }, DESKTOP_ONLY_FACES);
  }
  await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'));
  // Web fonts swap in after first paint; wait for them so a capture never shows the fallback face.
  await page.evaluate(() => document.fonts.ready);
  await sleep(700);
  return page;
}

/** Click by selector; `which` picks among several matches ('last' or an index). Missing = skip. */
const click = (page, selector, which = 0) =>
  page.evaluate(
    (sel, w) => {
      const all = [...document.querySelectorAll(sel)];
      const node = w === 'last' ? all[all.length - 1] : all[w];
      if (!node) return false;
      node.click();
      return true;
    },
    selector,
    which,
  );

const waitState = (page, state, timeout = 60000) =>
  page.waitForFunction((s) => document.getElementById('ui').dataset.state === s, { timeout }, state);

async function flow(size, lang) {
  const page = await open(size, lang);
  const shot = (s) => page.screenshot({ path: `${OUT}/${size}-${lang}-${s}.png` });
  await shot('01-title');

  await click(page, '.settings-toggle');
  await sleep(200);
  await shot('02-settings');
  // Whatever is below the fold of the settings panel (the controls section lives there).
  await page.evaluate(() => {
    const p = document.querySelector('.settings-panel');
    if (p) p.scrollTop = p.scrollHeight;
  });
  await sleep(100);
  await shot('02b-settings-bottom');
  if (await click(page, '.settings-panel .settings-wide')) {
    await sleep(300);
    await shot('03-itemguide');
    await click(page, '.item-guide-panel .actions button', 'last');
  }
  await click(page, '.settings .actions button', 'last');

  await click(page, '.records-toggle');
  await sleep(200);
  await shot('04-records');
  await click(page, '.lb-panel .actions button', 'last');

  if (await click(page, '.online-toggle')) {
    await sleep(200);
    await shot('05-online');
    await click(page, '.online-panel > .actions button', 'last');
  }

  if (await click(page, '.daily-toggle')) {
    await sleep(400);
    await shot('06-daily');
    await click(page, '.daily-panel .actions button', 'last');
  }

  if (await click(page, '.garage-toggle')) {
    await sleep(900);
    await shot('07-garage-paint');
    await click(page, '.garage-tab', 1);
    await sleep(300);
    await shot('07b-garage-livery');
    await click(page, '.garage-close');
  }

  await click(page, '.single-toggle');
  await sleep(1000);
  await shot('08-chars');
  await page.evaluate(() => {
    const rosa = [...document.querySelectorAll('.char-card')][7];
    rosa.click();
    rosa.click();
  });
  await sleep(200);
  await shot('09-locksheet');
  await click(page, '.lock-panel button', 2);
  await click(page, '.char-card', 0);
  await click(page, '.panel-chars .actions button', 'last');
  await sleep(1000);
  await shot('10-tracks');

  await click(page, '.panel-tracks .actions button', 'last');
  await waitState(page, 'loading', 10000).catch(() => {});
  await sleep(350);
  await shot('11-loading');
  await waitState(page, 'racing');
  await sleep(2500);
  await shot('12-race');
  await page.evaluate(() => window.__turboKartRush.pause());
  await sleep(250);
  await shot('13-pause');
  await page.evaluate(() => window.__turboKartRush.resume());
  await page.evaluate(() => window.__turboKartRush.enterResults());
  await sleep(1400);
  await shot('14-results');

  // Keyboard focus must be visible everywhere a keyboard can go (desktop only).
  if (size === 'pc') {
    await page.keyboard.press('ArrowRight', { delay: 70 });
    await sleep(150);
    await shot('15-results-focus');
    await page.close();
    const p2 = await open(size, lang);
    const shot2 = (s) => p2.screenshot({ path: `${OUT}/${size}-${lang}-${s}.png` });
    await p2.keyboard.press('ArrowDown', { delay: 70 });
    await sleep(150);
    await shot2('16-title-focus');
    await p2.keyboard.press('ArrowUp', { delay: 70 });
    await p2.keyboard.press('Enter', { delay: 70 });
    await sleep(900);
    await p2.keyboard.press('ArrowRight', { delay: 70 });
    await sleep(150);
    await shot2('17-chars-focus');
    await p2.keyboard.press('Enter', { delay: 70 });
    await sleep(900);
    for (let row = 1; row <= 4; row++) {
      await p2.keyboard.press('ArrowDown', { delay: 70 });
      await sleep(120);
      await shot2(`18-tracks-focus-row${row}`);
    }
    await p2.close();
  } else {
    await page.close();
  }
  console.log(`${size}/${lang} done`);
}

/** Race HUD on named circuits; `team` switches the race mode to team points first. */
async function hud(size, lang, trackName, team = false) {
  const page = await open(size, lang);
  await click(page, '.single-toggle');
  await sleep(500);
  await click(page, '.char-card', 0);
  await click(page, '.panel-chars .actions button', 'last');
  await sleep(500);
  const picked = await page.evaluate((name) => {
    const cards = [...document.querySelectorAll('.track-card')];
    const card = cards.find((c) => c.querySelector('.card-name')?.textContent?.toUpperCase().includes(name));
    if (!card) return false;
    card.click();
    return true;
  }, trackName);
  if (!picked) console.log(`  track not found: ${trackName}`);
  if (team) await click(page, '.race-mode .seg', 1);
  await click(page, '.panel-tracks .actions button', 'last');
  await waitState(page, 'racing');
  await sleep(4500);
  const slug = trackName.toLowerCase().replace(/\s+/g, '-');
  await page.screenshot({ path: `${OUT}/${size}-${lang}-hud-${slug}${team ? '-team' : ''}.png` });
  await page.close();
  console.log(`${size}/${lang} hud ${slug}${team ? ' (team)' : ''} done`);
}

const sizes = Object.keys(SIZES).filter((s) => !ONLY || s === ONLY);
if (!flag('--no-flow')) {
  for (const size of sizes) for (const lang of LANGS) await flow(size, lang);
}
if (flag('--hud')) {
  for (const size of sizes) {
    if (LANGS.includes('ko')) {
      for (const name of HUD_TRACKS) await hud(size, 'ko', name);
      await hud(size, 'ko', HUD_TRACKS[0], true);
    }
    if (LANGS.includes('en')) {
      await hud(size, 'en', HUD_TRACKS[2]);
      await hud(size, 'en', HUD_TRACKS[0], true);
    }
  }
}
// Portrait gate check.
if (!flag('--no-flow') && (!ONLY || ONLY === 'phone') && LANGS.includes('ko')) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('tkr.lang', 'ko');
      localStorage.setItem('tkr.nudged', '1');
    } catch {}
  });
  await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__turboKartRush);
  await sleep(600);
  await page.screenshot({ path: `${OUT}/portrait-ko-gate.png` });
  await page.close();
}
await browser.close();
