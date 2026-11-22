// Graphics cost: how long a frame of a race takes to simulate and draw, and how much is drawn.
//
//   node tools/gfx-perf.mjs [pc|phone] [track,track] [tier,tier]
//
// Needs the dev server on :5178 (BASE overrides). The race is stepped by hand and after every frame
// one pixel is read back, which waits for the GPU, so the time is the whole cost of the frame (CPU and GPU, one after the
// other), not how fast the browser happens to present. That makes it a number for comparing two
// builds on this machine, not a frame rate anyone will see: the test machine's GPU is far faster
// than a phone's.
import { createRequire } from 'node:module';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const BASE = process.env.BASE || 'http://localhost:5178';
const [SIZE = 'pc', LIST = 'Sunny Circuit,Neon Nexus', TIERS = ''] = process.argv.slice(2);
const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  pc: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const STEP = 1000 / 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
try {
  for (const tier of TIERS ? TIERS.split(',') : ['']) {
    for (const track of LIST.split(',')) {
      const page = await browser.newPage();
      await page.setViewport(SIZES[SIZE]);
      await page.evaluateOnNewDocument(() => {
        let s = 0x2f6e2b1;
        Math.random = () => {
          s |= 0;
          s = (s + 0x6d2b79f5) | 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        try {
          localStorage.setItem('tkr.lang', 'en');
          localStorage.setItem('tkr.nudged', '1');
          localStorage.setItem('tkr.local.user', JSON.stringify({ coins: 300, xp: 120 }));
        } catch {}
      });
      page.on('pageerror', (e) => console.warn('  [pageerror]', e.message));
      await page.goto(`${BASE}/?auto=1&lobby${tier ? `&gfx=${tier}` : ''}`, { waitUntil: 'load', timeout: 90000 });
      await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'), { timeout: 60000 });
      await sleep(1000);
      const t0 = Date.now();
      await page.evaluate(async (name) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const byText = (sel, text) => [...document.querySelectorAll(sel)].find((n) => n.textContent.toLowerCase().includes(text.toLowerCase()));
        document.querySelector('.single-toggle').click();
        await wait(700);
        byText('.char-card', 'Zippy Nova')?.click();
        [...document.querySelectorAll('.panel-chars .actions button')].at(-1).click();
        await wait(700);
        byText('.track-card', name)?.click();
        await wait(250);
        [...document.querySelectorAll('.panel-tracks .actions button')].at(-1).click();
      }, track);
      const tClick = Date.now();
      await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'countdown', { timeout: 90000 });
      const load = (Date.now() - tClick) / 1000;
      await page.evaluate(() => {
        const g = window.__turboKartRush;
        window.__pending = null;
        window.__t = performance.now();
        window.requestAnimationFrame = (cb) => {
          window.__pending = cb;
          return 1;
        };
        window.__step = (dtMs, n = 1) => {
          for (let i = 0; i < n; i++) {
            const cb = window.__pending;
            window.__pending = null;
            window.__t += dtMs;
            if (cb) cb(window.__t);
            else g.loop(window.__t);
          }
        };
      });
      for (let i = 0; i < 400; i++) {
        await page.evaluate((dt) => window.__step(dt, 6), STEP);
        if ((await page.evaluate(() => document.getElementById('ui').dataset.state)) === 'racing') break;
      }
      await page.evaluate((dt) => window.__step(dt, 420), STEP);
      const out = await page.evaluate((dt) => {
        const r = window.__tkr.renderer;
        const gl = r.getContext();
        const times = [];
        const px = new Uint8Array(4);
        r.info.autoReset = false;
        let calls = 0;
        let tris = 0;
        for (let i = 0; i < 240; i++) {
          r.info.reset();
          const t0 = performance.now();
          window.__step(dt, 1);
          // Reading a pixel back is the one call that cannot return before the GPU has drawn the frame.
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          times.push(performance.now() - t0);
          calls += r.info.render.calls;
          tris += r.info.render.triangles;
        }
        r.info.autoReset = true;
        times.sort((a, b) => a - b);
        const size = { x: gl.drawingBufferWidth, y: gl.drawingBufferHeight };
        return {
          median: times[120],
          p95: times[228],
          calls: Math.round(calls / 240),
          tris: Math.round(tris / 240),
          buffer: `${size.x}x${size.y}`,
          programs: r.info.programs?.length ?? 0,
        };
      }, STEP);
      console.log(
        `${SIZE} ${tier || 'auto'} ${track}: ${out.median.toFixed(2)} ms median, ${out.p95.toFixed(2)} ms p95, ${out.calls} draw calls, ${(out.tris / 1000).toFixed(0)}k triangles, buffer ${out.buffer}, ${out.programs} programs, load ${load.toFixed(1)}s`,
      );
      void t0;
      await page.close();
    }
  }
} finally {
  await browser.close();
}
