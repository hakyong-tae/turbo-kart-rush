// The results screen with as much on it as a race can put there, at the window sizes that matter.
//
//   node tools/results-fit-check.mjs [http://localhost:5178] [outDir=marketing/.audit/results-fit] [--report]
//
// A results screen that scrolls on a phone was found by luck: the AI at the wheel happened to
// finish second, which added a level-up line to a screen that already held three unlock cards and
// tomorrow's check-in. This does not wait for luck. It puts the screen up over a running race
// (dev server only: it uses the `__tkr` hook) and deals it four hands, in English and Korean:
//
//   second-race    what was found: 3 cards (one with a two-line name), a level-up, a mission,
//                  tomorrow's check-in, the next unlock, the double-coins offer
//   first-win      a first race that is also a win: 4 cards (circuit, first finish, podium, win)
//   first-win-5    the same with the tenth drift boost in it: 5 cards
//   most           the most one race can deal: the day's second race, with the first podium, the
//                  first win and the tenth drift boost all in it and a level that awards an entry
//                  (6 cards), all three missions and their bonus, a level-up, tomorrow's check-in
//   cup-race       the second-race hand in a Grand Prix, where the cup's table sits under the race's
//
// at 844x390 and 800x450 (touch), 667x375 and 740x360 (small phones), 821x462, 907x510 and 1280x720
// (desktop).
// For each it checks that
//   * nothing scrolls (the panel, or the table inside it), the panel is inside the window with
//     every button and block in view, nothing sticks out of its column sideways, and the
//     double-coins offer is not cut short
//   * no text is drawn under 11 CSS px
//   * no unlock card's name is cut (an ellipsis, or wider than its box), and none leaves its column
//   * nothing the race did is missing: every card is there, the coins, the level-up, the missions
// and reports which fallback layout was needed (`dense`: 0 = the ordinary layout, `a` = the blocks
// about what comes next moved under the table) and what, if anything, was folded away to make room.
//
// Exit code 1 when a check fails. --report measures and prints without failing (to get the
// "before" numbers from an older tree). A capture of every screen goes to the out directory.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const REPORT = argv.includes('--report');
const [BASE = 'http://localhost:5178', OUT = 'marketing/.audit/results-fit'] = argv.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_TEXT = 11;

const SIZES = [
  { name: '844x390-touch', width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '800x450-touch', width: 800, height: 450, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  { name: '667x375-touch', width: 667, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '740x360-touch', width: 740, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '821x462-pc', width: 821, height: 462, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: '907x510-pc', width: 907, height: 510, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: '1280x720-pc', width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

/** The hands. Tokens are ladder and level entries (src/core/economy.ts); names come from the game. */
const HANDS = [
  { id: 'second-race', track: 'frostbite_falls', tokens: ['w:1', 'u:1'], levelUp: true, missions: 1, bonus: false, tomorrow: true },
  { id: 'first-win', track: 'dune_drift', tokens: ['p:b', 'u:1', 'p:u'], levelUp: false, missions: 1, bonus: false, tomorrow: false },
  { id: 'first-win-5', track: 'dune_drift', tokens: ['p:b', 'u:1', 'p:u', 'f:1'], levelUp: true, missions: 2, bonus: false, tomorrow: false },
  { id: 'most', track: 'frostbite_falls', tokens: ['w:1', 'u:1', 'p:u', 'f:1', 'g:9'], levelUp: true, missions: 3, bonus: true, tomorrow: true },
  { id: 'cup-race', track: 'frostbite_falls', tokens: ['w:1', 'u:1'], levelUp: true, missions: 1, bonus: false, tomorrow: true, cup: true },
];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio'],
});
const failures = [];
const rows = [];

for (const size of SIZES) {
  const page = await browser.newPage();
  await page.setViewport(size);
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
  page.on('pageerror', (e) => failures.push(`${size.name}: pageerror: ${e.message}`));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => ['countdown', 'racing'].includes(document.getElementById('ui')?.dataset.state), { timeout: 60000 });
  await page.waitForFunction(() => window.__tkr?.getRace(), { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);

  for (const lang of ['en', 'ko']) {
    for (const hand of HANDS) {
      await page.evaluate(
        async (l, hand) => {
          const { setLang, t } = await import('/src/core/i18n.ts');
          const { tokenFullName } = await import('/src/ui/progression/text.ts');
          const { TRACKS } = await import('/src/track/tracks/index.ts');
          setLang(l);
          const g = window.__tkr.game;
          const r = window.__tkr.getRace();
          r.hud.hide();
          const ko = l === 'ko';
          const track = TRACKS.find((d) => d.id === hand.track);
          // A stand-in picture: the boxes that hold one have a fixed size whatever is in them.
          const picture = () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          const missions = [
            { title: ko ? '아이템 8개 사용' : 'Use 8 items', coins: 40 },
            { title: ko ? '레이스 2판 완주' : 'Finish 2 races', coins: 40 },
            { title: ko ? '드리프트 부스트 6회' : 'Drift boost 6 times', coins: 60 },
          ].slice(0, hand.missions);
          const standings = r.raceManager.getStandings();
          const cup = hand.cup
            ? { table: standings.map((st, i) => ({ kartId: st.kartId, name: st.name, points: 30 - i * 3, isPlayer: st.isPlayer })), raceIndex: 1, raceCount: 4, isFinal: false }
            : undefined;
          g.results.show(standings, 'solo', false, cup);
          g.results.setNextTrack(track.name);
          g.setState('results');
          g.results.showRewards({
            state: 'paid',
            coins: 60,
            balance: 1245,
            rate: 100,
            races: hand.tomorrow ? 2 : 1,
            xp: { earned: 120, after: { level: hand.levelUp ? 5 : 1, into: 30, need: 250 }, levelUps: hand.levelUp ? 1 : 0, levelCoins: hand.levelUp ? 100 : 0 },
            missions,
            bonus: hand.bonus ? 100 : undefined,
            missionCount: { done: hand.missions, total: 3 },
            canDouble: true,
            opened: [{ kind: 'track', name: track.name }, ...hand.tokens.map((token) => ({ kind: 'item', name: tokenFullName(token), image: picture(token) }))],
            nextUnlock: { text: ko ? '레이스 3판 완주' : 'Finish 3 races', value: 2, target: 3, reward: tokenFullName('t:2') },
            tomorrow: hand.tomorrow ? { coins: 60, gift: tokenFullName('u:5'), image: picture('u:5') } : null,
          });
          window.__expect = { cards: 1 + hand.tokens.length, notes: (hand.levelUp ? 1 : 0) + hand.missions + (hand.bonus ? 1 : 0) + 1, tomorrow: hand.tomorrow, t: t('rewards.missions', { done: hand.missions, n: 3 }) };
          document.querySelectorAll('.unlock-card, .standing-row, .cup-standing').forEach((n) => (n.style.animation = 'none'));
          await document.fonts.ready;
        },
        lang,
        hand,
      );
      await sleep(350);
      const m = await page.evaluate((min) => {
        const panel = document.querySelector('.results-panel');
        const box = panel.getBoundingClientRect();
        const shown = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
        const inView = (e) => {
          const r = e.getBoundingClientRect();
          return r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5;
        };
        const scrollers = [panel, ...panel.querySelectorAll('*')].filter((n) => /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1);
        const small = [];
        for (const e of panel.querySelectorAll('*')) {
          if (!shown(e)) continue;
          const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
          if (!own) continue;
          const px = parseFloat(getComputedStyle(e).fontSize);
          if (px < min) small.push(`${e.className.toString().split(' ')[0]} ${px}px`);
        }
        const column = document.querySelector('.results-opened').getBoundingClientRect();
        const cards = [...document.querySelectorAll('.unlock-card')].filter(shown).map((card) => {
          const name = card.querySelector('.unlock-name');
          const style = getComputedStyle(name);
          const b = card.getBoundingClientRect();
          return {
            text: name.textContent,
            cut: name.scrollWidth > name.clientWidth + 1 || (style.textOverflow === 'ellipsis' && style.overflowX !== 'visible' && name.scrollWidth > name.clientWidth),
            outside: b.right > column.right + 0.5 || b.left < column.left - 0.5,
          };
        });
        const blocks = [...panel.querySelectorAll('.results-main > *, .results-side > *, .results-foot .btn')].filter(shown);
        // Nothing may stick out of its column sideways (a button too wide for the reward line did).
        const poking = [];
        for (const col of panel.querySelectorAll('.results-main, .results-side')) {
          const edge = col.getBoundingClientRect();
          for (const e of col.querySelectorAll('*')) {
            if (!shown(e)) continue;
            const r = e.getBoundingClientRect();
            if (r.width > 0 && (r.right > edge.right + 1 || r.left < edge.left - 1)) poking.push(e.className.toString().split(' ').slice(0, 2).join('.'));
          }
        }
        const folded = ['.results-sub', '.results-next', '.results-tomorrow', '.tomorrow-in', '.unlock-label', '.reward-xp', '.results-side']
          .filter((sel) => [...panel.querySelectorAll(sel)].some((e) => e.childNodes.length > 0) && ![...panel.querySelectorAll(sel)].some(shown));
        return {
          dense: `${panel.dataset.dense ?? 0}${panel.hasAttribute('data-aside') ? 'a' : ''}`,
          tableOver: (() => { const tb = panel.querySelector('.standings'); return tb.scrollHeight - tb.clientHeight; })(),
          over: panel.scrollHeight - panel.clientHeight,
          panel: { top: Math.round(box.top), bottom: Math.round(box.bottom), h: innerHeight },
          scrolls: scrollers.map((n) => n.className.toString().split(' ').slice(0, 2).join('.')),
          outOfView: blocks.filter((e) => !inView(e)).map((e) => e.className.toString().split(' ').slice(0, 2).join('.')),
          poking: [...new Set(poking)],
          offerCut: [...panel.querySelectorAll('.reward-double .btn-label')].some((e) => shown(e) && e.scrollWidth > e.clientWidth + 1),
          small: [...new Set(small)],
          cards,
          notes: [...panel.querySelectorAll('.reward-notes .reward-note')].filter(shown).length,
          coins: shown(panel.querySelector('.reward-amount')),
          tomorrow: [...panel.querySelectorAll('.results-tomorrow')].some((e) => shown(e) && e.childNodes.length > 0),
          rows: [...panel.querySelectorAll('.standing-row')].filter(shown).length,
          folded,
          expect: window.__expect,
        };
      }, MIN_TEXT);
      const why = [];
      // A Grand Prix on a desktop shows two tables of eight, and the race's scrolls: that is its design.
      const scrolls = hand.cup && !size.hasTouch ? m.scrolls.filter((c) => c !== 'standings') : m.scrolls;
      if (scrolls.length) why.push(`scrolls (${scrolls.join(', ')}; panel content ${m.over}px taller than the panel)`);
      if (m.panel.top < 0 || m.panel.bottom > m.panel.h) why.push(`panel ${m.panel.top}..${m.panel.bottom} of ${m.panel.h}`);
      if (m.outOfView.length) why.push(`out of view: ${m.outOfView.join(', ')}`);
      if (m.poking.length) why.push(`sticks out of its column: ${m.poking.join(', ')}`);
      if (m.offerCut) why.push('the double-coins offer is cut short');
      if (m.small.length) why.push(`text under ${MIN_TEXT}px: ${m.small.join(', ')}`);
      if (m.cards.length !== m.expect.cards) why.push(`${m.cards.length} of ${m.expect.cards} cards shown`);
      for (const c of m.cards) if (c.cut || c.outside) why.push(`card "${c.text}" ${c.cut ? 'cut' : 'outside its column'}`);
      if (!m.coins) why.push('the coins are not shown');
      if (m.notes !== m.expect.notes) why.push(`${m.notes} of ${m.expect.notes} reward notes shown`);
      if (m.rows < 3) why.push(`only ${m.rows} rows of the table`);
      const label = `${size.name} ${lang} ${hand.id}`;
      if (why.length) failures.push(`${label}: ${why.join('; ')}`);
      rows.push({ label, dense: m.dense, over: m.over, tableOver: m.tableOver, panel: `${m.panel.top}..${m.panel.bottom}/${m.panel.h}`, folded: m.folded.join(' ') || '-', ok: why.length === 0 });
      await page.screenshot({ path: `${OUT}/${size.name}-${lang}-${hand.id}.png` });
    }
  }
  await page.close();
}

console.log('window          lang hand          dense  overflow  panel         folded away');
for (const r of rows) {
  const [size, lang, hand] = r.label.split(' ');
  console.log(`${size.padEnd(15)} ${lang}   ${hand.padEnd(13)} ${String(r.dense).padStart(3)}  ${(r.over > 0 ? `+${r.over}px` : 'none').padStart(8)}  ${r.panel.padEnd(12)}  ${r.folded}${r.tableOver > 1 ? `   (table scrolls ${r.tableOver}px)` : ''}${r.ok ? '' : '   <-- FAIL'}`);
}
writeFileSync(`${OUT}/log.json`, JSON.stringify({ failures, rows }, null, 1));
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(`\n${rows.length} screens, ${failures.length} failure${failures.length === 1 ? '' : 's'}${REPORT ? ' (report only)' : ''}`);
await browser.close();
process.exit(failures.length && !REPORT ? 1 : 0);
