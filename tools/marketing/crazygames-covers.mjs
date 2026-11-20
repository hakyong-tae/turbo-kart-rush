// CrazyGames covers for Drift Kart: 1920×1080, 800×1200 and 800×800 from one piece of key art.
//
//   WORK=<dir> OUT=marketing/crazygames node tools/marketing/crazygames-covers.mjs <keyart.jpg>
//
// Key art: a frame of a real race, re-shot from a camera beside the player kart
// (crazygames-capture.mjs hero). The only text added is the game's own wordmark
// (crazygames-logo.mjs, trimmed to $WORK/logo-trim.png). No border, no icons.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib.mjs';
const WORK = process.env.WORK;
const OUT = process.env.OUT;
const KEY = process.argv[2];
mkdirSync(OUT, { recursive: true });
const SRC = { w: 2880, h: 1620 };
const FLIP = process.env.FLIP === '1';
// focus = the kart in the (mirrored) key art, as fractions; at = where it lands in the cover.
const FOCUS = (process.env.FOCUS || '0.4875,0.52').split(',').map(Number);
const FORMATS = {
  // Zoomed until the start gantry is above the frame: the camera sees its sign from behind.
  landscape: { W: 1920, H: 1080, zoom: 1.36, at: [0.4, 0.36], logo: { right: 56, bottom: 44, width: 860 },
    scrim: 'linear-gradient(-20deg, rgba(10,8,20,.82) 0%, rgba(10,8,20,.5) 22%, rgba(10,8,20,0) 46%)' },
  portrait: { W: 800, H: 1200, zoom: 1.0, at: [0.5, 0.6], logo: { centre: true, top: 46, width: 700 },
    scrim: 'linear-gradient(180deg, rgba(10,8,20,.78) 0%, rgba(10,8,20,.45) 20%, rgba(10,8,20,0) 36%)' },
  square: { W: 800, H: 800, zoom: 1.22, at: [0.5, 0.63], logo: { centre: true, top: 30, width: 640 },
    scrim: 'linear-gradient(180deg, rgba(10,8,20,.8) 0%, rgba(10,8,20,.45) 24%, rgba(10,8,20,0) 42%)' },
};
const b64 = (f, type) => `data:image/${type};base64,${readFileSync(f).toString('base64')}`;
const key = b64(KEY, 'jpeg');
const logo = b64(`${WORK}/logo-trim.png`, 'png');

const browser = await launch();
try {
  for (const [name, F] of Object.entries(FORMATS)) {
    const fit = Math.max(F.W / SRC.w, F.H / SRC.h) * F.zoom;
    const bw = SRC.w * fit, bh = SRC.h * fit;
    const clamp = (v, lo) => Math.min(0, Math.max(lo, v));
    const bx = clamp(F.at[0] * F.W - FOCUS[0] * bw, F.W - bw);
    const by = clamp(F.at[1] * F.H - FOCUS[1] * bh, F.H - bh);
    const L = F.logo;
    const pos = L.centre ? `left:50%; transform:translateX(-50%); top:${L.top}px;` : `${L.right != null ? `right:${L.right}px` : `left:${L.left}px`}; bottom:${L.bottom}px;`;
    const ctx = await browser.newContext({ viewport: { width: F.W, height: F.H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      * { margin: 0; box-sizing: border-box; }
      html, body { width: ${F.W}px; height: ${F.H}px; overflow: hidden; background: #111; }
      .bg { position: absolute; left: ${bx}px; top: ${by}px; width: ${bw}px; height: ${bh}px; ${FLIP ? 'transform: scaleX(-1);' : ''}
            filter: saturate(1.12) contrast(1.04); }
      .scrim { position: absolute; inset: 0; background: ${F.scrim}; }
      .logo { position: absolute; ${pos} width: ${L.width}px; height: auto;
              filter: drop-shadow(0 6px 0 rgba(0,0,0,.55)) drop-shadow(0 14px 26px rgba(0,0,0,.55)); }
    </style></head><body>
      <img class="bg" src="${key}"><div class="scrim"></div><img class="logo" src="${logo}">
    </body></html>`);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const file = `${OUT}/cover_${name}_${F.W}x${F.H}.png`;
    writeFileSync(file, await page.screenshot({ type: 'png' }));
    console.log('wrote', file);
    // The videos open on their cover: the portrait one needs it at 1080×1620.
    if (name === 'portrait') {
      const big = await browser.newContext({ viewport: { width: F.W, height: F.H }, deviceScaleFactor: 1.35 });
      const p2 = await big.newPage();
      await p2.setContent(await page.content());
      await p2.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      writeFileSync(`${WORK}/cover_portrait_1080x1620.png`, await p2.screenshot({ type: 'png' }));
      await big.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
