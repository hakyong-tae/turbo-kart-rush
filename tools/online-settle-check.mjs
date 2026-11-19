// What an online race pays, checked with two real browsers: a host and a mirrored client.
//
// Online play needs the agent8 room relay, which only exists inside the Verse8 host, and the
// in-page loopback demo only ever makes this browser the host. So this tool stands in for the
// relay: it serves a replacement for src/net/transport.ts whose room lives in this Node process,
// serves src/core/constants.ts with ONLINE_ENABLED flipped on, and drives the real lobby UI.
// Each page has its own browser context, so each has its own local wallet (tkr.local.user).
//
//   npx vite --port 5181 --strictPort          (a dev server: the tool rewrites dev modules)
//   node tools/online-settle-check.mjs <scenario> [laps=2] [http://localhost:5181]
//
//   finish   both karts are driven by the AI; the client finishes and is paid for its place
//   retire   the client never moves and is retired (DNF): retire pay, not a refusal
//   migrate  the host's page is closed 15 s in; the client is promoted and paid at the line
//
// Read the last lines: GUEST reward view, GUEST race stats (the mission counters, next to the
// server's mission progress) and the wallets before and after. A race must run 30 s or the
// server refuses it, so keep laps at 2 or more on the short circuits.
import { createRequire } from 'node:module';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');
const BASE = process.argv[4] || 'http://localhost:5181';
const SCENARIO = process.argv[2] || 'finish';
const LAPS = Number(process.argv[3] || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// Replacement for src/net/transport.ts: same exports, the room lives in this Node process.
const FAKE_TRANSPORT = `
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
export function wrapForRelay(p) {
  if (!(p instanceof ArrayBuffer) && !ArrayBuffer.isView(p)) return p;
  const bytes = p instanceof ArrayBuffer ? new Uint8Array(p) : new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
  return { __b64: b64(bytes) };
}
export function unwrapFromRelay(p) {
  if (!p || typeof p !== 'object' || typeof p.__b64 !== 'string') return p;
  const bin = atob(p.__b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export function makeAgent8Transport() {
  const account = window.__netAccount;
  let msgH = () => {}; let stateH = () => {};
  window.__netDeliver = (kind, a, b, c) => { if (kind === 'msg') msgH(a, unwrapFromRelay(b), c); else stateH(a); };
  const t = {
    account, status: 'offline',
    async connect() { t.status = 'online'; return 'online'; },
    listRooms: () => window.__netCall('listRooms'),
    joinRoom: () => window.__netCall('joinRoom', account),
    createRoom: () => window.__netCall('joinRoom', account),
    async touchRoom() {},
    leaveRoom: () => window.__netCall('leaveRoom', account),
    getRoomState: () => window.__netCall('getRoomState'),
    updateRoomState: (patch) => window.__netCall('updateRoomState', patch),
    send(event, payload) { void window.__netCall('send', account, event, wrapForRelay(payload)); },
    onMessage(h) { msgH = h; }, onRoomState(h) { stateH = h; },
    async ping() { return 20; },
  };
  return t;
}
`;

const CONSTANTS_ONLINE = (await (await fetch(BASE + '/src/core/constants.ts')).text()).replace('ONLINE_ENABLED = false', 'ONLINE_ENABLED = true');
if (!CONSTANTS_ONLINE.includes('ONLINE_ENABLED = true')) throw new Error('could not flip ONLINE_ENABLED');
const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--no-sandbox', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ],
});

// ── the room ────────────────────────────────────────────────────────────────
let roomState = {};
const members = new Map(); // account → page
const deliver = (page, ...args) => page.evaluate((a) => window.__netDeliver?.(...a), args).catch(() => {});
const hub = {
  listRooms: () => (members.size ? [{ key: 'LOOP', count: members.size, trackId: roomState.trackId ?? '', started: !!roomState.started }] : []),
  joinRoom: (account) => 'LOOP',
  leaveRoom: (account) => { members.delete(account); },
  getRoomState: () => ({ ...roomState }),
  updateRoomState: (patch) => {
    const next = { ...roomState };
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
    roomState = next;
    for (const page of members.values()) void deliver(page, 'state', { ...roomState });
  },
  send: (account, event, payload) => {
    if (!members.has(account)) return;
    for (const page of members.values()) void deliver(page, 'msg', event, payload, account);
  },
};

async function open(account) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => log(`[${account} pageerror]`, e.message));
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') log(`[${account} ${m.type()}]`, m.text().slice(0, 240)); });
  await page.exposeFunction('__netCall', (op, ...args) => {
    if (op === 'joinRoom') members.set(args[0], page);
    return hub[op](...args) ?? null;
  });
  // `tkr.firstRace`: open on the lobby, not in a fresh profile's first race.
  await page.evaluateOnNewDocument((acct) => { window.__netAccount = acct; localStorage.setItem('tkr.lang', 'ko'); localStorage.setItem('tkr.firstRace', '1'); }, account);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (path === '/src/net/transport.ts') void req.respond({ contentType: 'application/javascript', body: FAKE_TRANSPORT });
    else if (path === '/src/core/constants.ts') void req.respond({ contentType: 'application/javascript', body: CONSTANTS_ONLINE });
    else void req.continue();
  });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  // The check-in window opens by itself on the first visit of the day.
  await page.evaluate(() => document.querySelector('.attendance-claim')?.click());
  await sleep(600);
  await page.evaluate(() => document.querySelector('.attendance-close')?.click());
  return page;
}

const wallet = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tkr.local.user') || '{}');
  return { coins: s.coins ?? 0, xp: s.xp ?? 0, race: s.race ? 'open' : null, races: s.eco?.races ?? 0 };
});
const snap = (page) => page.evaluate(() => {
  const g = window.__tkr?.game; const r = window.__tkr?.getRace?.();
  if (!g) return null;
  const me = r?.karts?.[r.localKartId]?.state;
  return {
    state: g.state, role: r?.online?.role ?? null, kart: r?.localKartId ?? null,
    lap: me?.lap ?? null, place: me?.place ?? null, finished: me?.finished ?? null, finishTime: me?.finishTime ?? null,
    rmTime: r ? +r.raceManager.raceTime.toFixed(2) : null,
    csTime: g.online?.clientSession ? +g.online.clientSession.raceTime.toFixed(2) : null,
    settled: r?.settled ?? null, reward: g.reward ?? null, stats: r?.stats?.stats ?? null,
  };
}).catch(() => null);
const autodrive = (page) => page.evaluate(async () => {
  const { AIDriver } = await import('/src/ai/AIDriver.ts');
  const r = window.__tkr.getRace();
  r.playerAutoDriver = new AIDriver(r.karts[r.localKartId], 'hard', 0);
});

// ── lobby ───────────────────────────────────────────────────────────────────
const host = await open('host-acct');
const guest = await open('guest-acct');
log('wallets before:', JSON.stringify({ host: await wallet(host), guest: await wallet(guest) }));

const clickText = (page, text) => page.evaluate((txt) => {
  const b = [...document.querySelectorAll('.screen.online button, .online button, button')].find((x) => (x.textContent || '').trim() === txt && x.getBoundingClientRect().width > 0);
  if (!b) return false; b.click(); return true;
}, text);
log('host opens online:', await host.evaluate(() => { const b = document.querySelector('.online-toggle'); b?.click(); return !!b; }));
await sleep(500);
log('host creates room:', await clickText(host, '방 만들기'));
await sleep(800);
hub.updateRoomState({ laps: LAPS });
log('guest opens online:', await guest.evaluate(() => { const b = document.querySelector('.online-toggle'); b?.click(); return !!b; }));
await sleep(500);
await guest.evaluate(() => { const i = document.querySelector('.online-code'); i.value = 'LOOP'; i.dispatchEvent(new Event('input', { bubbles: true })); });
log('guest joins:', await clickText(guest, '입장'));
await sleep(800);
log('guest ready:', await clickText(guest, '준비!'));
await sleep(800);
log('room:', JSON.stringify(roomState));
log('host starts:', await clickText(host, '레이스 시작'));
log('START sent');

// ── race ────────────────────────────────────────────────────────────────────
let driving = { host: false, guest: false };
let hostClosed = false;
let lastLine = '';
for (let i = 0; i < 400; i++) {
  await sleep(1000);
  const h = hostClosed ? null : await snap(host);
  const g = await snap(guest);
  if (h?.state === 'racing' && !driving.host) { await autodrive(host); driving.host = true; log('host: AI takes the wheel'); }
  if (g?.state === 'racing' && !driving.guest && SCENARIO !== 'retire') { await autodrive(guest); driving.guest = true; log('guest: AI takes the wheel'); }
  if (SCENARIO === 'migrate' && !hostClosed && (h?.rmTime ?? 0) > 15) {
    hostClosed = true; members.delete('host-acct'); await host.close(); log('HOST PAGE CLOSED (no LEAVE sent)');
  }
  const line = `host ${h ? `${h.state} lap${h.lap} p${h.place} t${h.rmTime}` : '—'} | guest ${g ? `${g.state} role=${g.role} lap${g.lap} p${g.place} fin=${g.finished}/${g.finishTime} rm=${g.rmTime} cs=${g.csTime} settled=${g.settled} reward=${g.reward?.state ?? '-'}` : '—'}`;
  if (line !== lastLine && i % 5 === 0) { log(line); lastLine = line; }
  const guestDone = g?.state === 'results' && g.reward && g.reward.state !== 'pending';
  const hostDone = hostClosed || (h?.state === 'results' && h.reward && h.reward.state !== 'pending');
  if (guestDone && hostDone) { log(line); break; }
}
await sleep(1500);
const gEnd = await snap(guest);
log('GUEST reward view:', JSON.stringify(gEnd?.reward));
log('GUEST race stats:', JSON.stringify(gEnd?.stats), '| missions:', await guest.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('tkr.local.user') || '{}').mis)));
if (!hostClosed) log('HOST race stats:', JSON.stringify((await snap(host))?.stats));
log('GUEST results text:', await guest.evaluate(() => document.querySelector('.screen.results')?.innerText.replace(/\s+/g, ' ').slice(0, 500)));
if (!hostClosed) log('HOST reward view:', JSON.stringify((await snap(host))?.reward));
log('wallets after:', JSON.stringify({ host: hostClosed ? null : await wallet(host), guest: await wallet(guest) }));
await browser.close();
