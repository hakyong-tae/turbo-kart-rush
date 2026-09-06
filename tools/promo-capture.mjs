// Marketing assets for Drift Dash GP (Verse8 / ONE store).
//
//   node tools/promo-capture.mjs [http://localhost:5178]      # needs `npm run dev` running
//
// Outputs into marketing/:
//   drift-dash-gp-15s-1x1.mp4   1080 × 1080, 30 fps, 15 s, with the game's own procedural race
//                               music rendered offline (Web Audio OfflineAudioContext) and muxed in
//   thumbnail-1x1.png           1024 × 1024 gameplay frame with the logo overlay
//
// Frames are STEPPED, not recorded: requestAnimationFrame is stubbed once the race is up so every
// captured frame advances the game by exactly 1/30 s. The result is smooth regardless of how slow
// headless screenshots are, and `?auto=1` lets the AI drive the player for a clean lap.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';

const PUPPETEER_DIR = process.env.PUPPETEER_DIR || '/Users/hytae/Downloads/cryzen-downloader';
const puppeteer = createRequire(`file://${PUPPETEER_DIR}/`)('puppeteer');

const BASE = process.argv[2] || 'http://localhost:5178';
const OUT = 'marketing';
const FRAMES_DIR = `${OUT}/.frames`;
const FPS = 30;
const SECONDS = 15;
const STEP_MS = 1000 / FPS;
const CHARACTER_INDEX = 0; // Zippy Nova (cyan / pink)
const TRACK_INDEX = 1; // Coral Coast

mkdirSync(OUT, { recursive: true });
rmSync(FRAMES_DIR, { recursive: true, force: true });
mkdirSync(FRAMES_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openRace(page, size, { lang = 'en' } = {}) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((l) => {
    try {
      localStorage.setItem('tkr.lang', l);
      localStorage.setItem('tkr.nudged', '1');
    } catch {}
  }, lang);
  await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'), { timeout: 30000 });
  await sleep(500);
  // Menu: title → character → track → start (through the game's own DOM).
  await page.evaluate(
    (ci, ti) => {
      document.querySelector('.panel-title-screen').click();
      const cards = [...document.querySelectorAll('.char-card')];
      cards[ci].click();
      [...document.querySelectorAll('.panel-chars .actions button')][1].click();
      const tracks = [...document.querySelectorAll('.track-card')];
      tracks[ti].click();
      [...document.querySelectorAll('.panel-tracks .actions button')][1].click();
    },
    CHARACTER_INDEX,
    TRACK_INDEX,
  );
  // Let the real rAF loop build the track and warm shaders, until the countdown begins.
  await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'countdown', { timeout: 60000 });
}

/** Stub rAF so the game only advances when we step it. */
async function takeControlOfTime(page) {
  await page.evaluate(() => {
    const g = window.__turboKartRush;
    window.__pending = null;
    window.__t = performance.now();
    window.requestAnimationFrame = (cb) => {
      window.__pending = cb;
      return 1;
    };
    // The running loop has a real rAF queued; when it fires it re-registers through our stub.
    window.__step = (dtMs) => {
      const cb = window.__pending;
      window.__pending = null;
      window.__t += dtMs;
      if (cb) cb(window.__t);
      else g.loop(window.__t);
    };
  });
  await sleep(150);
}

async function captureTrailer(browser) {
  const page = await browser.newPage();
  await openRace(page, 1080);
  await takeControlOfTime(page);
  const total = FPS * SECONDS;
  for (let i = 0; i < total; i++) {
    await page.evaluate((dt) => window.__step(dt), STEP_MS);
    await page.screenshot({ path: `${FRAMES_DIR}/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (i % 60 === 0) console.log(`  frame ${i}/${total}`);
  }
  // Render 15 s of the race song offline with the game's own sequencer.
  let wavPath = null;
  try {
    const b64 = await page.evaluate(async (seconds) => {
      const music = await import('/src/audio/music.ts');
      const sr = 44100;
      const ctx = new OfflineAudioContext(2, sr * seconds, sr);
      let fakeNow = 0;
      Object.defineProperty(ctx, 'currentTime', { get: () => fakeNow });
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      const seq = new music.Sequencer(ctx, comp, music.buildRaceSong(false));
      seq.start(0.05, 0.3);
      // Drive the lookahead scheduler across the whole duration.
      for (fakeNow = 0; fakeNow < seconds + 1; fakeNow += 0.05) seq.tick();
      if (seq.timer) clearInterval(seq.timer);
      const buf = await ctx.startRendering();
      // Encode 16-bit PCM WAV.
      const n = buf.length;
      const out = new ArrayBuffer(44 + n * 4);
      const v = new DataView(out);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
      v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      let o = 44;
      for (let i = 0; i < n; i++) {
        v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); o += 2;
        v.setInt16(o, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 2;
      }
      const bytes = new Uint8Array(out);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }, SECONDS);
    wavPath = `${OUT}/.race-music.wav`;
    writeFileSync(wavPath, Buffer.from(b64, 'base64'));
    console.log('  music rendered offline');
  } catch (err) {
    console.warn('  music render failed, trailer will be silent:', err.message);
  }
  await page.close();

  const mp4 = `${OUT}/drift-dash-gp-15s-1x1.mp4`;
  const args = ['-y', '-framerate', String(FPS), '-i', `${FRAMES_DIR}/f%04d.jpg`];
  if (wavPath) args.push('-i', wavPath);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', String(FPS), '-movflags', '+faststart');
  if (wavPath) args.push('-c:a', 'aac', '-b:a', '160k', '-af', `afade=t=in:d=0.5,afade=t=out:st=${SECONDS - 1.2}:d=1.2`, '-shortest');
  args.push(mp4);
  execFileSync('ffmpeg', args, { stdio: 'ignore' });
  console.log(`wrote ${mp4}`);
}

async function captureThumbnail(browser) {
  const page = await browser.newPage();
  await openRace(page, 1024);
  await takeControlOfTime(page);
  // Skip the countdown + a few seconds so the pack has spread out, then freeze a frame.
  for (let i = 0; i < FPS * 6.5; i++) await page.evaluate((dt) => window.__step(dt), STEP_MS);
  await page.evaluate(() => {
    const ui = document.getElementById('ui');
    for (const sel of ['.hud', '.touch-controls', '.mute-indicator']) ui.querySelectorAll(sel).forEach((n) => (n.style.display = 'none'));
    const wrap = document.createElement('div');
    wrap.className = 'promo-overlay';
    wrap.innerHTML = `
      <style>
        .promo-overlay { position:absolute; inset:0; pointer-events:none; display:flex; flex-direction:column; justify-content:space-between; align-items:center; padding:56px 40px; background: linear-gradient(180deg, rgba(5,5,20,.55) 0%, rgba(5,5,20,0) 32%, rgba(5,5,20,0) 62%, rgba(5,5,20,.7) 100%); }
        .promo-overlay .logo { transform: scale(1.15); }
        .promo-tag { font-family: var(--display); font-size: 40px; letter-spacing: .14em; color:#fff; text-shadow: 0 4px 24px rgba(0,0,0,.6); text-align:center; line-height:1.25; }
        .promo-tag small { display:block; font-size: 26px; color: rgba(255,255,255,.82); letter-spacing:.22em; margin-top:6px; }
      </style>
      <div class="logo">
        <span class="logo-word logo-word-0" data-text="DRIFT">DRIFT</span>
        <span class="logo-word logo-word-1" data-text="DASH">DASH</span>
        <span class="logo-word logo-word-2" data-text="GP">GP</span>
      </div>
      <div class="promo-tag">온라인 카트 레이싱<small>ONLINE KART RACING · 8 RACERS · 6 TRACKS</small></div>`;
    ui.appendChild(wrap);
  });
  await page.evaluate((dt) => window.__step(dt), STEP_MS);
  await sleep(200);
  const png = `${OUT}/thumbnail-1x1.png`;
  await page.screenshot({ path: png, type: 'png' });
  console.log(`wrote ${png}`);
  await page.close();
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // Headless Chrome only exposes WebGL2 here through the Metal ANGLE backend (SwiftShader
    // reports no WebGL2 and the game shows its "WEBGL2 REQUIRED" screen).
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--use-gl=angle',
    '--use-angle=metal',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  await captureThumbnail(browser);
  await captureTrailer(browser);
} finally {
  await browser.close();
}
if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true, force: true });
