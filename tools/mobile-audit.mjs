// Screenshot every screen at phone sizes (portrait + landscape) so layout overlaps can be eyeballed.
//   node tools/mobile-audit.mjs [http://localhost:5178]  → marketing/.audit/<size>-<screen>.png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv[2] || 'http://localhost:5178';
const OUT = 'marketing/.audit';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizes = { portrait: [390, 844], landscape: [844, 390] };
const browser = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling'] });
for (const [name, [w, h]] of Object.entries(sizes)) {
  for (const lang of ['ko', 'en']) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('tkr.lang', l); localStorage.setItem('tkr.nudged', '1'); } catch {} }, lang);
    await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'));
    await sleep(600);
    const shot = (s) => page.screenshot({ path: `${OUT}/${name}-${lang}-${s}.png` });
    await shot('1-title');
    await page.evaluate(() => document.querySelector('.settings-toggle').click()); await sleep(150); await shot('2-settings');
    await page.evaluate(() => [...document.querySelectorAll('.settings .actions button')].pop().click());
    await page.evaluate(() => document.querySelector('.records-toggle').click()); await sleep(150); await shot('3-records');
    await page.evaluate(() => [...document.querySelectorAll('.lb-panel .actions button')].pop().click());
    await page.evaluate(() => document.querySelector('.online-toggle').click()); await sleep(150); await shot('4-online');
    await page.evaluate(() => [...document.querySelectorAll('.online-panel > .actions button')].pop().click());
    await page.evaluate(() => document.querySelector('.panel-title-screen').click()); await sleep(900); await shot("5-chars");
    await page.evaluate(() => { const rosa = [...document.querySelectorAll('.char-card')][7]; rosa.click(); rosa.click(); }); await sleep(150); await shot('6-locksheet');
    await page.evaluate(() => { [...document.querySelectorAll('.lock-panel button')][2].click(); [...document.querySelectorAll('.char-card')][0].click(); });
    await page.evaluate(() => [...document.querySelectorAll('.panel-chars .actions button')][1].click()); await sleep(900); await shot("7-tracks");
    await page.evaluate(() => [...document.querySelectorAll('.panel-tracks .actions button')][1].click());
    await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'racing', { timeout: 60000 });
    await sleep(2500); await shot('8-race');
    await page.evaluate(() => window.__turboKartRush.pause()); await sleep(150); await shot('9-pause');
    await page.evaluate(() => window.__turboKartRush.resume());
    await page.evaluate(() => window.__turboKartRush.enterResults()); await sleep(400); await shot('10-results');
    await page.close();
    console.log(`${name}/${lang} done`);
  }
}
await browser.close();
