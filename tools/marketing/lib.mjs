// Shared helpers for the ONE store marketing kit (tools/marketing/*.mjs).
//
// Headless Chromium through Playwright, WebGL2 through the Metal ANGLE backend (~30 ms a frame).
// SWIFTSHADER=1 switches to SwiftShader: it works, but a 1920×1080 frame takes ~15 s.
// Needs the dev server (`npx vite --port 4941 --strictPort`): the capture uses the dev-only
// `?auto=1` autopilot (an AI drives the player kart) and `window.__tkr.events`.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const PW = process.env.PLAYWRIGHT || '/Users/hytae/Downloads/pocket-aces/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

export const BASE = process.env.BASE || 'http://localhost:4941';
export const KIT = 'marketing/onestore-kit';
export const WORK = `${KIT}/_work`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME =
  process.env.CHROME ||
  `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function launch() {
  const gl = process.env.SWIFTSHADER ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist'];
  return chromium.launch({
    headless: true,
    executablePath: existsSync(CHROME) ? CHROME : undefined,
    args: [
      '--mute-audio',
      ...gl,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
}

/**
 * What must never show in a store capture: the build badge (fixed div from src/buildTag.ts,
 * text "build …"), the lobby version line (carries the build stamp), toasts and dev overlays.
 * The real game HUD stays. `hud: false` hides it too (key art frames only).
 */
export async function hideChrome(page, { hud = true } = {}) {
  await page.evaluate((hud) => {
    let st = document.getElementById('__mk_style');
    if (!st) {
      st = document.createElement('style');
      st.id = '__mk_style';
      document.head.appendChild(st);
    }
    st.textContent = `
      .version, .toast-host, .toast, #vite-error-overlay, vite-error-overlay { display: none !important; }
      ${hud ? '' : '.hud, .touch-controls { display: none !important; }'}
    `;
    for (const n of document.body.querySelectorAll(':scope > div')) {
      if ((n.textContent || '').startsWith('build ')) n.remove();
    }
  }, hud);
}

/**
 * New page, language fixed, first-run nudges marked as seen.
 * `phone: true` = touch phone emulation (isMobile + hasTouch) so the touch controls show.
 */
export async function openGame(browser, { width, height, dpr = 1, phone = false, lang = 'ko', query = '' }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    isMobile: phone,
    hasTouch: phone,
    userAgent: phone
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
      : undefined,
  });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('tkr.lang', l);
      localStorage.setItem('tkr.nudged', '1');
    } catch {}
  }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn('  [pageerror]', e.message));
  await page.goto(`${BASE}/?lang=${lang}${query}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'), null, { timeout: 60000 });
  await sleep(1200);
  await hideChrome(page);
  return page;
}

/** Title → 싱글 레이스 → racer `ci` → 다음 → track `ti` → 레이스 시작, until the countdown. */
export async function startRace(page, { ci = 0, ti = 1 } = {}) {
  await page.evaluate(
    ([ci, ti]) => {
      document.querySelector('.single-toggle').click();
      [...document.querySelectorAll('.char-card')][ci].click();
      [...document.querySelectorAll('.panel-chars .actions button')].at(-1).click();
      [...document.querySelectorAll('.track-card')][ti].click();
      [...document.querySelectorAll('.panel-tracks .actions button')].at(-1).click();
    },
    [ci, ti],
  );
  await page.waitForFunction(() => document.getElementById('ui').dataset.state === 'countdown', null, { timeout: 90000 });
}

/** Stub rAF so the game only advances when we step it (deterministic 30 fps however slow a capture is). */
export async function takeControlOfTime(page) {
  await page.evaluate(() => {
    const g = window.__turboKartRush;
    window.__pending = null;
    window.__t = performance.now();
    window.__realRaf = window.__realRaf || window.requestAnimationFrame.bind(window);
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
  await sleep(200);
}

/** Hand time back to the browser (menus and the results screen animate on their own). */
export async function releaseTime(page) {
  await page.evaluate(() => {
    window.requestAnimationFrame = window.__realRaf;
    const cb = window.__pending;
    window.__pending = null;
    if (cb) window.__realRaf(cb);
  });
}

/**
 * Action log from the dev event bus (window.__tkr.events, set when a race starts in dev).
 * Hits are stored with the victim's position so a frame can tell whether the camera saw them.
 */
export async function attachActionLog(page) {
  await page.evaluate(() => {
    const ev = window.__tkr.events;
    const race = () => window.__tkr.getRace();
    window.__hits = [];
    const kartPos = (id) => race()?.karts?.[id]?.state?.position;
    const hit = (kind) => (e) => {
      const p = e?.position || kartPos(e?.kartId);
      window.__hits.push({ t: window.__t, kind, x: p?.x ?? 0, z: p?.z ?? 0 });
    };
    ev.on('item:hit', hit('hit'));
    ev.on('kart:spin', hit('spin'));
    ev.on('item:explosion', hit('explosion'));
    ev.on('item:lightning', () => {
      const p = race()?.karts?.find((k) => k.state.isPlayer)?.state.position;
      window.__hits.push({ t: window.__t, kind: 'lightning', x: p?.x ?? 0, z: p?.z ?? 0 });
    });
  });
}

/** What the camera sees right now, scored for the store-shot categories. */
export async function sampleAction(page) {
  return page.evaluate(() => {
    const r = window.__tkr.getRace();
    const ks = r?.karts ?? [];
    const me = ks.find((k) => k.state.isPlayer);
    if (!me) return null;
    const s = me.state;
    const fwd = { x: -Math.sin(s.heading), z: -Math.cos(s.heading) }; // Kart.ts: forward = (-sin h, -cos h)
    const ahead = (p) => {
      const dx = p.x - s.position.x;
      const dz = p.z - s.position.z;
      const d = Math.hypot(dx, dz);
      return { d, front: (dx * fwd.x + dz * fwd.z) / (d || 1) };
    };
    let pack = 0;
    for (const k of ks) {
      if (k === me) continue;
      const a = ahead(k.state.position);
      if (a.d < 18 && a.front > 0.2) pack++;
    }
    const now = window.__t;
    let hit = 0;
    for (const h of window.__hits) {
      const age = now - h.t;
      if (age < 0 || age > 700) continue;
      const a = ahead({ x: h.x, z: h.z });
      if (h.kind === 'lightning') hit = Math.max(hit, 2);
      else if (a.d < 30 && a.front > 0.3) hit = Math.max(hit, 3 - a.d / 12);
    }
    return {
      drift: s.isDrifting ? s.driftStage : 0,
      boost: s.isBoosting ? 1 : 0,
      spin: s.isSpinning ? 1 : 0,
      star: s.isInvincible ? 1 : 0,
      air: s.isAirborne ? 1 : 0,
      speed: s.speed,
      pack,
      hit,
      place: s.place,
      lap: s.lap,
      state: document.getElementById('ui').dataset.state,
    };
  });
}

/** PNG if it fits the store's 1.3 MB cap, else a high-quality JPG with the same stem. */
export async function saveCapped(page, stem, { clip, capBytes = 1.3 * 1024 * 1024 } = {}) {
  const { writeFileSync, rmSync } = await import('node:fs');
  const png = await page.screenshot({ type: 'png', clip });
  rmSync(`${stem}.png`, { force: true });
  rmSync(`${stem}.jpg`, { force: true });
  if (png.length <= capBytes) {
    writeFileSync(`${stem}.png`, png);
    return `${stem}.png`;
  }
  for (const q of [95, 92, 90, 86, 82]) {
    const jpg = await page.screenshot({ type: 'jpeg', quality: q, clip });
    if (jpg.length <= capBytes) {
      writeFileSync(`${stem}.jpg`, jpg);
      return `${stem}.jpg`;
    }
  }
  throw new Error(`${stem}: no encoding fits under the cap`);
}
