// ONE store feature graphic (대표 이미지) for Drift Kart: exactly 1024×578.
//
//   node tools/marketing/graphic.mjs [keyart.png]
//
// Background: a real race frame with the HUD hidden, written by shots.mjs to
// marketing/onestore-kit/_work/keyart/ (pass one explicitly, or KEYART=<file>; default = the
// highest-scored one; ZOOM / FOCUS / AT frame the action). Title: the game's own DRIFT KART logo, cut out of the lobby with a
// transparent background, plus a small Korean kicker and a one-line Korean tagline.
// Needs the dev server on :4941 (for the logo).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { KIT, WORK, launch, openGame, sleep } from './lib.mjs';

const OUT = `${KIT}/graphic_1024x578.png`;
const KICKER = '드리프트 카트';
const TAGLINE = '드리프트 한 방으로 뒤집는 8인 카트 레이스';

const keyDir = `${WORK}/keyart`;
const pickKeyart = () => {
  const files = readdirSync(keyDir).filter((f) => f.endsWith('.png'));
  const scoreOf = (f) => Number(f.replace(/\.png$/, '').split('_').at(-1)) || 0;
  files.sort((a, b) => scoreOf(b) - scoreOf(a));
  return `${keyDir}/${files[0]}`;
};
const keyart = process.argv[2] || process.env.KEYART || pickKeyart();
// Push in on the action: ZOOM over the cover-fit frame, with the source point FOCUS (fractions of
// the frame) landing at AT (fractions of the banner), right of the title block.
const ZOOM = Number(process.env.ZOOM || 1.5);
const [fx, fy] = (process.env.FOCUS || '0.552,0.481').split(',').map(Number);
const [ax, ay] = (process.env.AT || '0.66,0.52').split(',').map(Number);
const bw = 1024 * ZOOM;
const bh = bw * (1080 / 1920);
const clamp = (v, lo) => Math.min(0, Math.max(lo, v));
const bx = clamp(ax * 1024 - fx * bw, 1024 - bw);
const by = clamp(ay * 578 - fy * bh, 578 - bh);
console.log('keyart:', keyart, { ZOOM, bx, by });

const browser = await launch();
try {
  // 1) The lobby logo on a transparent background (DPR 2 for a crisp downscale).
  const page = await openGame(browser, { width: 1280, height: 720, dpr: 2 });
  await sleep(1500);
  // Lift the logo out of the lobby onto an empty, transparent page (its CSS is global).
  await page.evaluate(() => {
    const logo = document.querySelector('.panel-title-screen .logo');
    const holder = document.createElement('div');
    holder.id = '__logo';
    holder.style.cssText = 'position:fixed;left:0;top:0;padding:24px 28px;';
    holder.appendChild(logo);
    document.body.appendChild(holder);
    for (const n of [...document.body.children]) if (n !== holder) n.style.display = 'none';
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  });
  await sleep(400);
  const logo = await page.locator('#__logo').screenshot({ omitBackground: true });
  writeFileSync(`${WORK}/logo.png`, logo);
  await page.context().close();

  // 2) Compose.
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 578 }, deviceScaleFactor: 1 });
  const g = await ctx.newPage();
  const b64 = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  await g.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    html, body { width: 1024px; height: 578px; overflow: hidden; background: #0b0d1a; }
    .bg { position: absolute; inset: 0; background: url(${b64(keyart)}) ${bx}px ${by}px / ${bw}px ${bh}px no-repeat;
          filter: saturate(1.15) contrast(1.05); }
    .shade { position: absolute; inset: 0;
      background:
        linear-gradient(90deg, rgba(8,8,26,.88) 0%, rgba(8,8,26,.62) 30%, rgba(8,8,26,0) 58%),
        linear-gradient(0deg, rgba(8,8,26,.55) 0%, rgba(8,8,26,0) 30%); }
    .title { position: absolute; left: 44px; top: 50%; transform: translateY(-50%); width: 420px;
             display: flex; flex-direction: column; align-items: flex-start; }
    .kicker { font: 800 21px/1 'Apple SD Gothic Neo', system-ui, sans-serif; letter-spacing: .14em;
              color: #fff; opacity: .92; margin: 0 0 12px 6px; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
    .logo { width: 330px; height: auto; margin: -16px 0 -14px -30px; filter: drop-shadow(0 8px 22px rgba(0,0,0,.55)); }
    .tag { margin: 18px 0 0 6px; font: 800 23px/1.35 'Apple SD Gothic Neo', system-ui, sans-serif;
           color: #fff; white-space: nowrap; text-shadow: 0 2px 12px rgba(0,0,0,.75);
           padding: 8px 16px; border-radius: 999px;
           background: linear-gradient(90deg, rgba(58,123,255,.9), rgba(255,59,160,.9)); }
  </style></head><body>
    <div class="bg"></div><div class="shade"></div>
    <div class="title">
      <div class="kicker">${KICKER}</div>
      <img class="logo" src="${b64(`${WORK}/logo.png`)}">
      <div class="tag">${TAGLINE}</div>
    </div>
  </body></html>`);
  await sleep(400);
  await g.screenshot({ path: OUT, type: 'png' });
  console.log(`wrote ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
  await ctx.close();
} finally {
  await browser.close();
}
