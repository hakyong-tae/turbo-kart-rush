// The lobby's row of four small buttons: each says what it is, and the lobby still fits.
//
//   node tools/lobby-check.mjs [http://localhost:5178] [outDir=marketing/.audit/lobby] [--report]
//
// QA could not tell what the four icons under GARAGE and MISSIONS did (CGQA-39): they had no name
// on screen, only a browser tooltip that comes late and never comes on a touch screen, and the
// calendar was not the check-in. This opens the lobby (a served build or the dev server, either
// edition) in Korean and English at 1280x720, 907x510 and 821x462 (desktop) and 844x390, 800x450
// and 667x375 (touch), and checks that
//   * each of the four buttons shows a name under its icon, at 11 CSS px or more, not cut and
//     inside the button
//   * the name on screen is part of the button's full name (tooltip and aria-label), which is
//     what a screen reader and a hovering mouse get
//   * the check-in is the calendar and the daily challenge is not; no two of the six lobby
//     buttons with an icon share one; the "still to claim" dot is on the check-in button
//   * every lobby button is inside the window, none overlaps another, the lobby does not cover
//     the wordmark, and the page does not scroll
//   * the keyboard cursor reaches all four along the row and comes back up from it
//
// Exit code 1 when a check fails; --report prints without failing (for the "before" numbers of
// an older tree). A capture of every lobby goes to the out directory.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const REPORT = argv.includes('--report');
const [BASE = 'http://localhost:5178', OUT = 'marketing/.audit/lobby'] = argv.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_TEXT = 11;
const ROW = ['attendance-toggle', 'daily-toggle', 'records-toggle', 'settings-toggle'];

const SIZES = [
  { name: '1280x720-pc', width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: '907x510-pc', width: 907, height: 510, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: '821x462-pc', width: 821, height: 462, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: '844x390-touch', width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '800x450-touch', width: 800, height: 450, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  { name: '667x375-touch', width: 667, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

const launch = () =>
  puppeteer.launch({
    headless: 'new',
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
  });
let browser = await launch();
const failures = [];
const rows = [];

/** One lobby: open it, measure it, capture it. Throws when the page or the browser gives out. */
async function look(size, lang) {
    const page = await browser.newPage();
    await page.setViewport(size);
    await page.evaluateOnNewDocument((l) => {
      try {
        localStorage.clear();
        localStorage.setItem('tkr.lang', l);
      } catch {}
    }, lang);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?lobby`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'title', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    // The check-in window opens by itself on a first lobby; it is not what is being looked at.
    await page.waitForFunction(() => document.querySelector('.attendance-close, .lobby-icons'), { timeout: 15000 });
    await sleep(2500);
    await page.evaluate(() => document.querySelector('.attendance-close')?.click());
    await sleep(900);
    // The build badge goes with the first press; a capture is clearer without it.
    await page.mouse.move(5, 5);

    const m = await page.evaluate(
      (row, min) => {
        const shown = (e) => Boolean(e) && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
        const box = (e) => {
          const r = e.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
        };
        const iconOf = (b) => [...(b.querySelector('svg.icon')?.classList ?? [])].find((c) => c.startsWith('icon-'))?.slice(5) ?? null;
        const lobby = document.querySelector('.lobby');
        const buttons = [...lobby.querySelectorAll('.lobby-btn')].filter(shown);
        const four = row.map((cls) => {
          const b = lobby.querySelector(`.${cls}`);
          if (!shown(b)) return { cls, missing: true };
          const label = b.querySelector('.btn-label');
          const labelShown = shown(label) && label.getBoundingClientRect().width > 0;
          const range = document.createRange();
          if (label) range.selectNodeContents(label);
          const ink = label ? range.getBoundingClientRect() : null;
          const bb = box(b);
          const ic = b.querySelector('svg.icon')?.getBoundingClientRect();
          return {
            cls,
            icon: iconOf(b),
            text: labelShown ? label.textContent.trim() : '',
            px: labelShown ? parseFloat(getComputedStyle(label).fontSize) : 0,
            cut: labelShown ? label.scrollWidth > label.clientWidth + 1 || ink.width > bb.w - 2 : false,
            inside: labelShown ? ink.left >= bb.l - 0.5 && ink.right <= bb.r + 0.5 && ink.top >= bb.t - 0.5 && ink.bottom <= bb.b + 0.5 : false,
            under: labelShown && ic ? ink.top >= ic.bottom - 1 : false,
            full: b.getAttribute('aria-label') ?? '',
            tip: b.title ?? '',
            box: bb,
            dot: getComputedStyle(b, '::after').content !== 'none' && b.classList.contains('attn'),
          };
        });
        const all = buttons.map((b) => ({ cls: [...b.classList].find((c) => c.endsWith('-toggle')) ?? b.className, icon: iconOf(b), box: box(b) }));
        const overlaps = [];
        for (let i = 0; i < all.length; i++) {
          for (let k = i + 1; k < all.length; k++) {
            const a = all[i].box;
            const c = all[k].box;
            if (a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5) overlaps.push(`${all[i].cls} / ${all[k].cls}`);
          }
        }
        const lb = box(lobby);
        const logo = document.querySelector('.panel-title-screen .logo');
        const lg = shown(logo) ? box(logo) : null;
        const scroller = document.scrollingElement;
        return {
          four,
          all,
          overlaps,
          outside: all.filter((b) => b.box.l < -0.5 || b.box.t < -0.5 || b.box.r > innerWidth + 0.5 || b.box.b > innerHeight + 0.5).map((b) => b.cls),
          lobby: { top: Math.round(lb.t), bottom: Math.round(lb.b), h: Math.round(lb.h) },
          coversLogo: lg ? lb.l < lg.r - 0.5 && lg.l < lb.r - 0.5 && lb.t < lg.b - 0.5 && lg.t < lb.b - 0.5 : false,
          pageScroll: Math.max(0, scroller.scrollHeight - innerHeight),
          rowH: Math.round(four[0]?.box?.h ?? 0),
          min,
        };
      },
      ROW,
      MIN_TEXT,
    );

    // The keyboard: down from RACE to the row, along it, and back up.
    let reached = [];
    let back = false;
    if (!size.hasTouch) {
      const focused = () => page.evaluate(() => [...(document.querySelector('.lobby .lobby-btn.focused')?.classList ?? [])].find((c) => c.endsWith('-toggle')) ?? null);
      for (let i = 0; i < 4 && !ROW.includes(await focused()); i++) {
        await page.keyboard.press('ArrowDown');
        await sleep(90);
      }
      for (let i = 0; i < 5; i++) {
        reached.push(await focused());
        await page.keyboard.press('ArrowRight');
        await sleep(90);
      }
      reached = [...new Set(reached.filter((c) => ROW.includes(c)))];
      await page.keyboard.press('ArrowUp');
      await sleep(90);
      back = !ROW.includes(await focused());
    }

    const label = `${size.name} ${lang}`;
    const why = [];
    for (const b of m.four) {
      if (b.missing) {
        why.push(`${b.cls} is not shown`);
        continue;
      }
      if (!b.text) why.push(`${b.cls}: no name on screen`);
      else {
        if (b.px < MIN_TEXT) why.push(`${b.cls}: name at ${b.px}px`);
        if (b.cut) why.push(`${b.cls}: name "${b.text}" is cut`);
        if (!b.inside) why.push(`${b.cls}: name "${b.text}" leaves the button`);
        if (!b.under) why.push(`${b.cls}: name is not under the icon`);
        if (!b.full.toLowerCase().includes(b.text.toLowerCase())) why.push(`${b.cls}: "${b.text}" is not part of its full name "${b.full}"`);
      }
      if (!b.full || b.tip !== b.full) why.push(`${b.cls}: tooltip "${b.tip}" and aria-label "${b.full}" differ or are missing`);
    }
    const icons = m.all.map((b) => b.icon).filter(Boolean);
    const twice = icons.filter((n, i) => icons.indexOf(n) !== i);
    if (twice.length) why.push(`one icon on two buttons: ${[...new Set(twice)].join(', ')}`);
    const checkin = m.four.find((b) => b.cls === 'attendance-toggle');
    const daily = m.four.find((b) => b.cls === 'daily-toggle');
    if (checkin?.icon !== 'calendar') why.push(`the check-in is drawn as "${checkin?.icon}", not the calendar`);
    if (daily?.icon === 'calendar') why.push('the daily challenge is drawn as the calendar');
    if (!checkin?.dot) why.push('no "still to claim" dot on the check-in button of a new account');
    if (m.outside.length) why.push(`outside the window: ${m.outside.join(', ')}`);
    if (m.overlaps.length) why.push(`overlap: ${m.overlaps.join('; ')}`);
    if (m.coversLogo) why.push('the lobby covers the wordmark');
    if (m.pageScroll > 0) why.push(`the page scrolls ${m.pageScroll}px`);
    if (!size.hasTouch && (reached.length !== 4 || !back)) why.push(`keyboard reaches ${reached.length} of 4 on the row${back ? '' : ', and does not come back up'}`);
    if (errors.length) why.push(`page error: ${errors.join(' | ')}`);
    if (why.length) failures.push(`${label}: ${why.join('; ')}`);
    rows.push({
      label,
      names: m.four.map((b) => b.text || '-').join(' / '),
      px: m.four.map((b) => b.px || '-').join('/'),
      icons: m.four.map((b) => b.icon).join(' '),
      rowH: m.rowH,
      lobby: `${m.lobby.top}..${m.lobby.bottom}`,
      ok: why.length === 0,
    });
    await page.screenshot({ path: `${OUT}/${size.name}-${lang}.png` });
    await page.close();
}

for (const size of SIZES) {
  for (const lang of ['ko', 'en']) {
    // A browser on a machine that is busy with something else sometimes drops a page mid-load
    // ("Navigating frame was detached"). That says nothing about the lobby: look again.
    for (let attempt = 1; ; attempt++) {
      try {
        await look(size, lang);
        break;
      } catch (err) {
        if (attempt >= 3) {
          failures.push(`${size.name} ${lang}: could not be looked at (${err.message})`);
          break;
        }
        console.warn(`[retry] ${size.name} ${lang}: ${err.message}`);
        if (!browser.connected) browser = await launch();
        await sleep(2000);
      }
    }
  }
}

console.log('window          lang  row  lobby      icons                              names (px)');
for (const r of rows) {
  const [size, lang] = r.label.split(' ');
  console.log(`${size.padEnd(15)} ${lang}   ${String(r.rowH).padStart(3)}  ${r.lobby.padEnd(9)}  ${r.icons.padEnd(33)}  ${r.names}  (${r.px})${r.ok ? '' : '   <-- FAIL'}`);
}
writeFileSync(`${OUT}/log.json`, JSON.stringify({ failures, rows }, null, 1));
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${rows.length} lobbies, ${failures.length} failure${failures.length === 1 ? '' : 's'}${REPORT ? ' (report only)' : ''}`);
await browser.close();
process.exit(failures.length && !REPORT ? 1 : 0);
