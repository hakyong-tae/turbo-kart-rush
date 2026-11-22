// Unlock cards on the results screen: every name they can carry, in both languages, measured.
//
//   node tools/unlock-card-check.mjs [http://localhost:5178] [outDir] [pc|phone]
//
// Needs the dev server (it reaches into the running game through the dev-only `__tkr` hook). It
// opens the first race, puts the results screen up over it and feeds it every ladder entry and
// every circuit name, two cards at a time and then the fullest hand a race can deal (a circuit and
// the three longest entries). For each card it checks that
//   * the name is not cut: no ellipsis, nothing wider than its box, and the slant of the last
//     italic letter has room before the card's edge
//   * the card stays inside the column
//   * the results panel does not scroll
//
// Exit code 1 when a check fails. A capture of every hand goes to the out directory.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE = 'http://localhost:5178', OUT = 'marketing/.audit/unlock-cards', SIZE = 'pc'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = {
  phone: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const failures = [];
let checked = 0;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport(SIZES[SIZE]);
await page.evaluateOnNewDocument(() => {
  try {
    if (!sessionStorage.getItem('audit.init')) {
      localStorage.clear();
      sessionStorage.setItem('audit.init', '1');
    }
    localStorage.setItem('tkr.lang', 'en');
    // The results screen would otherwise go on to the next race while this looks at it.
    localStorage.setItem('tkr.autoNext', '0');
  } catch {}
});
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('ui')?.dataset.state === 'countdown', { timeout: 30000 });
await page.waitForFunction(() => window.__tkr?.getRace(), { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);

/** Every name a card can carry, in the language the page is in now. */
const names = () =>
  page.evaluate(async () => {
    const { LADDER } = await import('/src/core/economy.ts');
    const { tokenFullName } = await import('/src/ui/progression/text.ts');
    const { TRACKS_BY_DIFFICULTY } = await import('/src/track/tracks/index.ts');
    return { items: LADDER.map((s) => tokenFullName(s.token)), tracks: TRACKS_BY_DIFFICULTY.map((d) => d.name) };
  });

/** Puts the results screen up with these cards and measures them. */
async function deal(lang, label, cards) {
  await page.evaluate(
    async (l, list) => {
      const { setLang } = await import('/src/core/i18n.ts');
      setLang(l);
      const g = window.__tkr.game;
      const r = window.__tkr.getRace();
      r.hud.hide();
      g.results.show(r.raceManager.getStandings(), 'solo', false);
      g.results.setNextTrack('Frostbite Falls');
      g.setState('results');
      // A full reward block, so the cards sit where a real race puts them.
      g.results.showRewards({
        state: 'paid',
        coins: 60,
        balance: 100,
        rate: 100,
        races: 1,
        xp: { earned: 80, after: { level: 1, into: 80, need: 100 }, levelUps: 0, levelCoins: 0 },
        missions: [{ title: l === 'ko' ? '아이템 8개 사용' : 'Use 8 items', coins: 40 }],
        missionCount: { done: 1, total: 3 },
        canDouble: false,
        opened: list,
        nextUnlock: { text: l === 'ko' ? '레이스 2판 완주' : 'Finish 2 races', value: 1, target: 2, reward: l === 'ko' ? '스포크 글로우 휠 효과' : 'Spoke Glow wheel effect' },
      });
      document.querySelectorAll('.unlock-card').forEach((n) => (n.style.animation = 'none'));
      await document.fonts.ready;
    },
    lang,
    cards,
  );
  await sleep(250);
  const report = await page.evaluate(() => {
    const column = document.querySelector('.results-opened').getBoundingClientRect();
    const panel = document.querySelector('.results-panel');
    const scrollers = [panel, ...panel.querySelectorAll('*')].filter((n) => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1);
    return {
      scrolls: scrollers.map((n) => n.className),
      cards: [...document.querySelectorAll('.unlock-card')].map((card) => {
        const name = card.querySelector('.unlock-name');
        const style = getComputedStyle(name);
        const range = document.createRange();
        range.selectNodeContents(name);
        const ink = range.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        const size = parseFloat(style.fontSize);
        return {
          text: name.textContent,
          lines: Math.round(ink.height / parseFloat(style.lineHeight)),
          wider: name.scrollWidth > name.clientWidth + 1,
          ellipsis: style.textOverflow === 'ellipsis' && style.overflowX !== 'visible',
          // An italic capital leans about a fifth of its size past its own box.
          slantRoom: (style.overflowX === 'visible' ? box.right : name.getBoundingClientRect().right) - ink.right,
          slantNeed: size * 0.18,
          outside: box.right > column.right + 0.5 || box.left < column.left - 0.5,
        };
      }),
    };
  });
  for (const c of report.cards) {
    checked++;
    const why = [];
    if (c.wider) why.push('wider than its box');
    if (c.ellipsis) why.push('can be cut with an ellipsis');
    if (c.slantRoom < c.slantNeed) why.push(`${c.slantRoom.toFixed(1)}px for the slant, needs ${c.slantNeed.toFixed(1)}`);
    if (c.outside) why.push('card outside the column');
    if (why.length) failures.push(`${SIZE} ${lang} "${c.text}": ${why.join('; ')}`);
  }
  if (report.scrolls.length) failures.push(`${SIZE} ${lang} ${label}: scrolls (${report.scrolls.join(', ')})`);
  await page.screenshot({ path: `${OUT}/${SIZE}-${lang}-${label}.png` });
  return report;
}

const log = {};
for (const lang of ['en', 'ko']) {
  await page.evaluate(async (l) => (await import('/src/core/i18n.ts')).setLang(l), lang);
  const { items, tracks } = await names();
  const longest = [...items].sort((a, b) => b.length - a.length);
  log[lang] = [];
  // Two cards, as most races deal them: a circuit and one entry. Every name gets a turn.
  for (let i = 0; i < Math.max(items.length, tracks.length); i++) {
    const hand = [{ kind: 'track', name: tracks[i % tracks.length] }, { kind: 'item', name: items[i % items.length] }];
    log[lang].push(await deal(lang, `pair-${String(i + 1).padStart(2, '0')}`, hand));
  }
  // The fullest hand: a first race that is also a win.
  const full = [{ kind: 'track', name: [...tracks].sort((a, b) => b.length - a.length)[0] }, ...longest.slice(0, 3).map((name) => ({ kind: 'item', name }))];
  log[lang].push(await deal(lang, 'full-hand', full));
  // And one entry alone, the longest.
  log[lang].push(await deal(lang, 'single', [{ kind: 'item', name: longest[0] }]));
}

writeFileSync(`${OUT}/${SIZE}-log.json`, JSON.stringify({ failures, log }, null, 1));
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${SIZE}: ${checked} cards measured, ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
