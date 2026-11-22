// The CrazyGames SDK integration, checked against a stand-in SDK that writes down what it is told.
//
//   npx vite --mode crazygames --port 5182 --strictPort      # dev server, CrazyGames edition
//   node tools/crazygames-sdk-check.mjs [http://localhost:5182] [outDir=marketing/.audit/crazygames-sdk]
//
// The real SDK only behaves on crazygames.com. Here every request for its script is answered with
// a small fake of the same shape (`window.CrazyGames.SDK`: init, environment, game, data, user),
// so the game's side can be watched: which events it sends and when, what it saves, what it does
// with the portal's mute switch, device type and locale, and what happens when the SDK is slow,
// broken or missing. Needs the dev server in crazygames mode (the AI at the wheel comes from the
// dev-only `__tkr` hook). About ten minutes.
//
// Scenarios:
//   A. normal: loading and gameplay events in order; pause and resume; a pause caused by losing
//      focus is not reported; the record is saved to the data module; a win calls happytime
//   B. the account already has a record further along than this (empty) browser: it is taken,
//      and the player is not sent into the first-visit race
//   C. the portal says mute, mobile, Korean: audio is muted, touch controls are on, the UI is Korean
//   D. the SDK takes 6 s to initialise: the first race does not wait for it beyond its bound (0.4 s)
//   E. the SDK script fails to load: the game plays as if there were none
//   F. the SDK reports itself disabled (a foreign host): no calls are made
//   G. the data module is switched off: one refused read, no writes tried, the game plays on
//   H. the SDK takes 6 s and the account is further along: the record is replaced while the first
//      race is under way, and that race is still paid, into the account's record
//
// Exit code 1 when a check fails.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const [BASE = 'http://localhost:5182', OUT = 'marketing/.audit/crazygames-sdk'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** The stand-in. `opts` is baked in: init delay, environment, what the account already holds, settings. */
const fakeSdk = (opts) => `
(() => {
  const opts = ${JSON.stringify(opts)};
  const log = (window.__cg = window.__cg || { calls: [], data: Object.assign({}, opts.data || {}), listeners: [] });
  const say = (name, arg) => log.calls.push({ t: Math.round(performance.now()), name, arg });
  let ready = false;
  // The data module switched off for the game (it is an option on the submission form).
  const refuse = () => { if (opts.dataOff) { say('data.refused'); const e = new Error('Data module is disabled'); e.code = 'dataModuleDisabled'; throw e; } };
  const need = (name) => { if (!ready) throw new Error(name + ' before init'); if (opts.environment === 'disabled') throw new Error('SDK disabled on this domain'); };
  window.CrazyGames = { SDK: {
    environment: opts.environment || 'crazygames',
    init: () => new Promise((resolve) => setTimeout(() => { ready = true; say('init'); resolve(); }, opts.initDelay || 30)),
    game: {
      settings: { muteAudio: Boolean(opts.muteAudio), disableChat: false },
      loadingStart() { need('loadingStart'); say('loadingStart'); },
      loadingStop() { need('loadingStop'); say('loadingStop'); },
      gameplayStart() { need('gameplayStart'); say('gameplayStart'); },
      gameplayStop() { need('gameplayStop'); say('gameplayStop'); },
      happytime() { need('happytime'); say('happytime'); },
      addSettingsChangeListener(fn) { need('addSettingsChangeListener'); log.listeners.push(fn); },
      removeSettingsChangeListener() {},
    },
    data: {
      getItem(k) { need('data.getItem'); refuse(); say('data.getItem', k); return k in log.data ? log.data[k] : null; },
      setItem(k, v) { need('data.setItem'); refuse(); say('data.setItem', k); log.data[k] = String(v); },
      removeItem(k) { need('data.removeItem'); delete log.data[k]; },
      clear() { log.data = {}; },
    },
    user: {
      isUserAccountAvailable: true,
      systemInfo: { countryCode: opts.country || 'US', locale: opts.locale || 'en-US', device: { type: opts.device || 'desktop' }, os: { name: 'x', version: '1' }, browser: { name: 'x', version: '1' }, applicationType: 'web' },
    },
  } };
})();`;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});

async function open(name, sdk, { storage = {}, lang = 'en' } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setRequestInterception(true);
  let sdkRequests = 0;
  const others = new Set();
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('sdk.crazygames.com')) {
      sdkRequests++;
      if (sdk === 'blocked') return void req.abort('failed');
      return void req.respond({ status: 200, contentType: 'text/javascript', body: fakeSdk(sdk) });
    }
    if (!/^(data|blob):/.test(url) && new URL(url).host !== new URL(BASE).host) others.add(new URL(url).host);
    void req.continue();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(
    (storage, lang) => {
      try {
        if (!sessionStorage.getItem('audit.init')) {
          localStorage.clear();
          sessionStorage.setItem('audit.init', '1');
          for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
        }
        if (lang) localStorage.setItem('tkr.lang', lang);
        localStorage.setItem('tkr.autoNext', '0');
      } catch {}
      window.__states = [];
      const watch = () => {
        const ui = document.getElementById('ui');
        if (!ui) return requestAnimationFrame(watch);
        const read = () => {
          const s = ui.dataset.state;
          if (window.__states.at(-1)?.s !== s) window.__states.push({ t: Math.round(performance.now()), s });
        };
        read();
        new MutationObserver(read).observe(ui, { attributes: true });
      };
      document.addEventListener('DOMContentLoaded', watch);
    },
    storage,
    lang,
  );
  const t0 = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  return { page, errors, name, t0, sdkRequests: () => sdkRequests, others };
}
const calls = (page) => page.evaluate(() => (window.__cg?.calls ?? []).map((c) => c.name));
const state = (page) => page.evaluate(() => document.getElementById('ui')?.dataset.state);
const waitState = (page, s, timeout = 60000) => page.waitForFunction((s) => document.getElementById('ui')?.dataset.state === s, { timeout }, s);
async function aiDrives(page) {
  await page.waitForFunction(() => window.__tkr?.getRace(), { timeout: 60000 });
  await page.evaluate(async () => {
    const { AIDriver } = await import('/src/ai/AIDriver.ts');
    const r = window.__tkr.getRace();
    r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], 'hard', 0);
  });
  if (await page.evaluate(() => Boolean(document.querySelector('.coach-card')))) {
    await page.keyboard.down('KeyW');
    await sleep(300);
    await page.keyboard.up('KeyW');
  }
}
const only = (list, names) => list.filter((n) => names.includes(n));

// ---------------------------------------------------------------- A. normal
{
  const { page, errors, sdkRequests, others } = await open('A', {});
  await waitState(page, 'countdown');
  const gridMs = await page.evaluate(() => window.__states.find((x) => x.s === 'countdown')?.t);
  await aiDrives(page);
  await waitState(page, 'racing');
  await sleep(2500);
  let seen = await calls(page);
  const order = only(seen, ['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop']);
  check('A: one request for the SDK script, nothing else off-site', sdkRequests() === 1 && others.size === 0, `${sdkRequests()} SDK, others: ${[...others].join(', ') || 'none'}`);
  check('A: init, loadingStart, loadingStop, gameplayStart, in that order', order.join(' ') === 'init loadingStart loadingStop gameplayStart', order.join(' '));
  check('A: the first race is on its grid without waiting on the SDK', gridMs < 4000, `${gridMs} ms`);

  // The player pauses, then resumes.
  await page.keyboard.press('Escape');
  await waitState(page, 'paused');
  await sleep(300);
  seen = await calls(page);
  check('A: pausing sends gameplayStop', only(seen, ['gameplayStart', 'gameplayStop']).join(' ') === 'gameplayStart gameplayStop');
  await page.keyboard.press('Escape');
  await waitState(page, 'racing');
  await sleep(300);
  seen = await calls(page);
  check('A: resuming sends gameplayStart', only(seen, ['gameplayStart', 'gameplayStop']).join(' ') === 'gameplayStart gameplayStop gameplayStart');

  // The window loses focus: the game pauses itself, and says nothing to the portal.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitState(page, 'paused');
  await sleep(300);
  seen = await calls(page);
  check('A: a pause from losing focus is not reported', only(seen, ['gameplayStart', 'gameplayStop']).length === 3, only(seen, ['gameplayStart', 'gameplayStop']).join(' '));
  await page.keyboard.press('Escape');
  await waitState(page, 'racing');

  await waitState(page, 'results', 300000);
  await page.waitForFunction(() => document.querySelector('.reward-paid, .reward-failed'), { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  seen = await calls(page);
  const place = await page.evaluate(() => document.querySelector('.results-plate')?.textContent);
  check('A: the results screen sends gameplayStop', only(seen, ['gameplayStart', 'gameplayStop']).at(-1) === 'gameplayStop');
  check('A: happytime is called for a win and only then', (place === '1') === seen.includes('happytime') && seen.filter((n) => n === 'happytime').length <= 1, `place ${place}, happytime x${seen.filter((n) => n === 'happytime').length}`);
  const saved = await page.evaluate(() => ({ remote: window.__cg.data['tkr.local.user'] ?? null, local: localStorage.getItem('tkr.local.user') }));
  check('A: the record is saved to the data module, the same as the local copy', saved.remote !== null && saved.remote === saved.local, `${saved.remote?.length ?? 0} bytes`);
  await page.screenshot({ path: `${OUT}/A-results.png` });

  // On to the next race: gameplay again.
  await page.evaluate(() => document.querySelector('.results-next-btn')?.click());
  await waitState(page, 'countdown');
  await sleep(500);
  seen = await calls(page);
  check('A: the next race sends gameplayStart again', only(seen, ['gameplayStart', 'gameplayStop']).at(-1) === 'gameplayStart');
  check('A: loading is reported once', seen.filter((n) => n === 'loadingStart').length === 1 && seen.filter((n) => n === 'loadingStop').length === 1);
  check('A: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- B. the account is further along
{
  const remote = JSON.stringify({ lad: { all: false, day: '2026-11-01', r: 7, f: 6, p: 3, w: 1, d: 4 }, coins: 740, xp: 510 });
  const { page, errors } = await open('B', { data: { 'tkr.local.user': remote } });
  await page.waitForFunction(() => window.__states.some((x) => x.s === 'title'), { timeout: 30000 });
  await sleep(4000);
  const s = await state(page);
  const local = await page.evaluate(() => localStorage.getItem('tkr.local.user'));
  const coins = await page.evaluate(() => document.querySelector('.profile-coins, .lobby-profile')?.textContent ?? '');
  check('B: the account record replaces the empty local one', local !== null && JSON.parse(local).coins === 740, `local coins ${local ? JSON.parse(local).coins : 'none'}`);
  check('B: a returning player lands on the lobby, not in the first-visit race', s === 'title', s);
  check('B: the lobby shows the account balance', /740/.test(coins), coins.replace(/\s+/g, ' ').slice(0, 60));
  await page.screenshot({ path: `${OUT}/B-lobby.png` });
  check('B: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- C. mute, mobile, Korean
{
  const { page, errors } = await open('C', { muteAudio: true, device: 'mobile', locale: 'ko-KR' }, { lang: '' });
  await waitState(page, 'countdown');
  await sleep(1500);
  const got = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    touch: document.getElementById('ui').classList.contains('touch'),
    muted: window.__turboKartRush.audio.muted,
    indicator: document.querySelector('.mute-indicator')?.classList.contains('visible'),
  }));
  check('C: the portal locale (ko-KR) sets the language when the player has not chosen one', got.lang === 'ko', got.lang);
  check('C: a device the portal calls mobile gets touch controls', got.touch === true);
  check('C: the portal mute switch mutes the game', got.muted === true && got.indicator === true, JSON.stringify(got));
  // The player's own key cannot switch sound back on over the portal.
  await page.keyboard.press('KeyM');
  await sleep(200);
  check('C: the M key does not unmute over the portal', (await page.evaluate(() => window.__turboKartRush.audio.muted)) === true);
  // The portal lets go.
  await page.evaluate(() => window.__cg.listeners.forEach((fn) => fn({ muteAudio: false })));
  await sleep(200);
  const after = await page.evaluate(() => window.__turboKartRush.audio.muted);
  check('C: when the portal unmutes, the player setting is what is left', after === true, 'the M key was pressed once, so still muted');
  await page.keyboard.press('KeyM');
  await sleep(200);
  check('C: and the M key works again', (await page.evaluate(() => window.__turboKartRush.audio.muted)) === false);
  await page.screenshot({ path: `${OUT}/C-mobile-ko.png` });
  check('C: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- D. a slow SDK
{
  const { page, errors } = await open('D', { initDelay: 6000 });
  await waitState(page, 'countdown');
  const gridMs = await page.evaluate(() => window.__states.find((x) => x.s === 'countdown')?.t);
  check('D: with a 6 s init the grid is up after the short record wait, not after the SDK', gridMs < 3200, `${gridMs} ms`);
  await aiDrives(page);
  await page.waitForFunction(() => (window.__cg?.calls ?? []).some((c) => c.name === 'init'), { timeout: 20000 });
  await sleep(600);
  const seen = only(await calls(page), ['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop']);
  check('D: when it does arrive it is told where the game is: gameplay under way, loading not', seen.join(' ') === 'init gameplayStart', seen.join(' '));
  check('D: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- E. no SDK
{
  const { page, errors } = await open('E', 'blocked');
  await waitState(page, 'countdown');
  const gridMs = await page.evaluate(() => window.__states.find((x) => x.s === 'countdown')?.t);
  check('E: with the SDK script blocked the first race still starts, promptly', gridMs < 4000, `${gridMs} ms`);
  check('E: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- F. disabled
{
  const { page, errors } = await open('F', { environment: 'disabled' });
  await waitState(page, 'countdown');
  await sleep(1500);
  const seen = await calls(page);
  check('F: an SDK that says it is disabled is left alone after init', seen.join(' ') === 'init', seen.join(' '));
  check('F: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- G. data module off
{
  const { page, errors } = await open('G', { dataOff: true });
  await waitState(page, 'countdown');
  await sleep(2500);
  const seen = await calls(page);
  const local = await page.evaluate(() => localStorage.getItem('tkr.local.user'));
  check('G: a refused read is not followed by writes', seen.filter((n) => n === 'data.refused').length === 1, `refused x${seen.filter((n) => n === 'data.refused').length}`);
  check('G: the record is kept locally all the same', local !== null && local.length > 10, `${local?.length ?? 0} bytes`);
  check('G: the events still go out', seen.includes('gameplayStart'));
  check('G: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- H. a late SDK with an account further along
{
  const remote = JSON.stringify({ lad: { all: false, day: '2026-11-01', r: 7, f: 6, p: 3, w: 1, d: 4 }, coins: 740, xp: 510 });
  const { page, errors } = await open('H', { initDelay: 6000, data: { 'tkr.local.user': remote } });
  await waitState(page, 'countdown');
  await aiDrives(page);
  await page.waitForFunction(() => (window.__cg?.calls ?? []).some((c) => c.name === 'init'), { timeout: 20000 });
  await sleep(800);
  const mid = await page.evaluate(() => ({ local: JSON.parse(localStorage.getItem('tkr.local.user') ?? 'null'), remote: JSON.parse(window.__cg.data['tkr.local.user'] ?? 'null'), state: document.getElementById('ui').dataset.state }));
  check('H: the account record takes over while the race is under way', mid.local?.coins === 740 && ['countdown', 'racing'].includes(mid.state), `coins ${mid.local?.coins}, ${mid.state}`);
  check('H: the race in flight is carried into it, on both sides', Boolean(mid.local?.race?.id) && mid.remote?.race?.id === mid.local?.race?.id, `race ${mid.local?.race?.id ?? 'none'}`);
  await waitState(page, 'results', 300000);
  await page.waitForFunction(() => document.querySelector('.reward-paid, .reward-failed'), { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const end = await page.evaluate(() => ({
    paid: Boolean(document.querySelector('.reward-paid')),
    local: JSON.parse(localStorage.getItem('tkr.local.user') ?? 'null'),
    same: window.__cg.data['tkr.local.user'] === localStorage.getItem('tkr.local.user'),
  }));
  check('H: that race is paid, on top of the account balance', end.paid && end.local?.coins > 740, `paid ${end.paid}, coins ${end.local?.coins}`);
  check('H: both copies agree afterwards', end.same);
  await page.screenshot({ path: `${OUT}/H-late-account.png` });
  check('H: no page error', errors.length === 0, errors.join(' | '));
  await page.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
