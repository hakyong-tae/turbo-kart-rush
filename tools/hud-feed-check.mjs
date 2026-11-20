// The event feed and the place flash must not land on each other.
//
//   node tools/hud-feed-check.mjs [http://localhost:5178] [outDir]
//
// Needs the dev server (dev-only `__tkr` hook). In the first race it fires what an overtake at the
// end of a drift fires — a drift boost, a mission count, a hit and a place change in the same
// moment — and follows every feed line and the flash through their animations, frame by frame, on
// a PC screen and a landscape phone, in both languages. Exit code 1 if two of them ever overlap.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE = 'http://localhost:5178', OUT = 'marketing/.audit/hud-feed'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
let failed = 0;

for (const size of ['pc', 'phone']) {
  for (const lang of ['en', 'ko']) {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
    });
    const page = await browser.newPage();
    await page.setViewport(SIZES[size]);
    await page.evaluateOnNewDocument((l) => {
      try {
        if (!sessionStorage.getItem('audit.init')) {
          localStorage.clear();
          sessionStorage.setItem('audit.init', '1');
          // Not the very first race: its coach card is a different question.
          localStorage.setItem('tkr.coach', '1');
        }
        localStorage.setItem('tkr.lang', l);
      } catch {}
    }, lang);
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'countdown', { timeout: 30000 });
    if (size === 'phone') await page.touchscreen.tap(600, 200);
    else await page.keyboard.press('KeyW');
    await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'racing', { timeout: 40000 });
    await sleep(2500);
    // Everything at once, then every frame until it has all faded.
    const worst = await page.evaluate(async () => {
      const { events, getRace } = window.__tkr;
      const r = getRace();
      const me = r.localKartId;
      events.emit('kart:driftEnd', { kartId: me, boostStage: 2 });
      r.hud.feedMission('Drift', 3, 10);
      events.emit('item:hit', { kartId: (me + 1) % 8, item: 'shell', position: r.karts[me].position, sourceKartId: me, isPlayer: false });
      events.emit('race:positionChange', { kartId: me, from: 3, to: 2, isPlayer: true });
      let overlap = 0;
      let most = 0;
      const until = performance.now() + 2200;
      while (performance.now() < until) {
        await new Promise((f) => requestAnimationFrame(f));
        const flash = document.querySelector('.hud-posflash')?.getBoundingClientRect();
        const lines = [...document.querySelectorAll('.feed-line')].filter((n) => n.offsetParent !== null).map((n) => n.getBoundingClientRect());
        most = Math.max(most, lines.length);
        if (!flash) continue;
        for (const l of lines) {
          const x = Math.min(l.right, flash.right) - Math.max(l.left, flash.left);
          const y = Math.min(l.bottom, flash.bottom) - Math.max(l.top, flash.top);
          if (x > 0 && y > 0) overlap = Math.max(overlap, y);
        }
      }
      return { overlap, most };
    });
    // And a still of the moment itself.
    await page.evaluate(() => {
      const { events, getRace } = window.__tkr;
      const r = getRace();
      events.emit('kart:driftEnd', { kartId: r.localKartId, boostStage: 2 });
      r.hud.feedMission('Drift', 4, 10);
      events.emit('race:positionChange', { kartId: r.localKartId, from: 3, to: 2, isPlayer: true });
    });
    await sleep(350);
    await page.screenshot({ path: `${OUT}/${size}-${lang}-overtake.png` });
    const pass = worst.overlap === 0 && worst.most >= 2;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${size} ${lang}: feed and place flash overlap by ${worst.overlap.toFixed(1)}px at worst (${worst.most} feed lines up)`);
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
