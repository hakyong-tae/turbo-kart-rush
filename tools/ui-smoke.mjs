// UI regressions that unit tests cannot see: things that depend on real layout, real clicks and
// real stacking. Each one here is a bug QA found at least once.
//   node tools/ui-smoke.mjs [http://localhost:5178]
import { createRequire } from 'node:module';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv[2] || 'http://localhost:5178';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio'],
});

async function newPage(w = 1280, h = 800, lang = 'ko') {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  // `tkr.firstRace`: this device has been here before, so a fresh profile opens on the lobby
  // these checks drive instead of being sent straight into its first race.
  await page.evaluateOnNewDocument((l) => {
    localStorage.setItem('tkr.lang', l);
    localStorage.setItem('tkr.firstRace', '1');
  }, lang);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  // The check-in window opens by itself on a profile that has not claimed today, and sits over
  // everything these checks click. Close it: it is not what is being tested here.
  await page.evaluate(() => document.querySelector('.attendance-close')?.click());
  await sleep(200);
  return page;
}

/** A real mouse click at the element's centre — the only way to catch a layout shift mid-click. */
async function clickText(page, re) {
  const box = await page.evaluate((src) => {
    const rx = new RegExp(src);
    const el = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent || '') && b.offsetParent !== null);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, re);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}
const guideOpen = (page) => page.evaluate(() => {
  const g = document.querySelector('.screen.item-guide');
  return !!g && !g.classList.contains('hidden');
});

// 1 & 2 — the item guide opens on ONE click, before and after a language change.
// Regression: `.settings.kb` re-aligned the panel on blur, so mouseup landed on a different
// control and the click never reached the button.
{
  const page = await newPage();
  await page.click('.settings-toggle').catch(() => {});
  await sleep(600);
  await clickText(page, '아이템 설명서');
  await sleep(700);
  check('item guide opens on one click', await guideOpen(page));

  await clickText(page, '닫기'); await sleep(400);
  await clickText(page, '닫기'); await sleep(400);
  await page.click('.settings-toggle').catch(() => {});
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll('.seg')].find((x) => x.textContent === 'EN')?.click());
  await sleep(1000);
  await clickText(page, 'Settings|설정'); await sleep(600);
  await clickText(page, 'Item guide'); await sleep(700);
  check('item guide opens on one click after a language change', await guideOpen(page));
  await page.close();
}

// 3 — the records panel sits above the results screen it is opened from.
{
  const page = await newPage(844, 390);
  const r = await page.evaluate(async () => {
    const g = window.__turboKartRush;
    g.results.show([
      { kartId: 0, name: 'ME', racerName: 'ME', place: 1, time: 95.2, isPlayer: true, characterId: 'zippy', color: 0x44aaff, finishTime: 95.2, retired: false },
    ], 'solo', false);
    await new Promise((res) => setTimeout(res, 300));
    g.leaderboard.show('sunny_circuit', { submit: null });
    await new Promise((res) => setTimeout(res, 600));
    const lb = document.querySelector('.screen.lb');
    const panel = lb?.querySelector('.lb-panel') || lb?.querySelector('.panel');
    const box = panel?.getBoundingClientRect();
    const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
    return { onTop: hit ? !!hit.closest('.screen.lb') : false };
  });
  check('records panel is on top when opened from the results screen', r.onTop);
  await page.close();
}

// 4 — the build stamp is present, so a QA screenshot identifies the build.
{
  const page = await newPage();
  const line = await page.evaluate(() => document.querySelector('.version')?.textContent ?? '');
  check('lobby shows a build stamp', /\d{8}-/.test(line), line.split('·').pop()?.trim());
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
