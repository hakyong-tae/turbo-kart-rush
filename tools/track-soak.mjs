// Runs a whole race on a circuit with eight AI karts (the player's kart is AI-driven too), fast,
// and reports whether the field gets round: finishers, times, respawns, spins. Optional close-up
// screenshots of chosen points of the lap, to look at a ramp or a tram crossing.
//
//   node tools/track-soak.mjs [http://localhost:5178] [--track <id>|all] [--difficulty hard]
//                             [--shots 0.31,0.52] [--out marketing/.audit/soak]
//
// A circuit is healthy when every kart finishes or is retired only by the 10 s rule, nobody is
// respawned over and over at the same spot, and the winner's time is in the usual range.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = argv.find((a) => a.startsWith('http')) || 'http://localhost:5178';
const TRACK = opt('--track', 'all');
const DIFFICULTY = opt('--difficulty', 'normal');
const SHOTS = opt('--shots', '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const OUT = opt('--out', 'marketing/.audit/soak');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-gl=angle', '--use-angle=metal', '--mute-audio', '--disable-background-timer-throttling'],
});

async function open(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('tkr.lang', 'en');
      localStorage.setItem('tkr.nudged', '1');
      localStorage.setItem('tkr.seenControls', '1');
    } catch {}
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.goto(`${BASE}/?auto=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__turboKartRush && document.querySelector('.panel-title-screen'));
  await sleep(500);
  return { page, errors };
}

const start = (page, trackId, difficulty) =>
  page.evaluate(
    (trackId, difficulty) => {
      const g = window.__turboKartRush;
      const def = g.mainMenu.tracks.find((t) => t.id === trackId);
      g.startRace({ characterId: 'max', trackId, difficulty, mode: 'solo', laps: def ? def.laps : 3 });
    },
    trackId,
    difficulty,
  );

const waitState = (page, state) => page.waitForFunction((s) => document.getElementById('ui').dataset.state === s, { timeout: 90000 }, state);

async function soak(trackId) {
  const { page, errors } = await open(640, 360);
  await start(page, trackId, DIFFICULTY);
  await waitState(page, 'racing');
  const r = await page.evaluate(async () => {
    const g = window.__turboKartRush;
    const race = g.race;
    const rm = race.raceManager;
    // Nobody is watching: skip the drawing, which is most of the cost of a frame. Everything else
    // in the frame still runs (the results timer lives there).
    const noop = () => {};
    g.renderer.render = noop;
    for (const part of [g.postfx, g.rearView]) {
      if (!part) continue;
      for (const name of ['render', 'renderInto', 'draw']) if (typeof part[name] === 'function') part[name] = noop;
    }
    const spins = new Array(race.karts.length).fill(0);
    let moverHits = 0;
    const wasSpinning = new Array(race.karts.length).fill(false);
    const airMax = new Array(race.karts.length).fill(0);
    let t = performance.now();
    let steps = 0;
    while (document.getElementById('ui').dataset.state !== 'results' && steps < 14000) {
      t += 50;
      g.loop(t);
      steps++;
      for (let i = 0; i < race.karts.length; i++) {
        const s = race.karts[i].state;
        if (s.isSpinning && !wasSpinning[i]) {
          spins[i]++;
          // Spun right beside a moving obstacle: that one was the boulder / tram, not an item.
          for (const o of race.track.obstacles ?? []) {
            if (!o.hit) continue;
            if (Math.hypot(o.position.x - s.position.x, o.position.z - s.position.z) < o.radius + 3) {
              moverHits++;
              break;
            }
          }
        }
        wasSpinning[i] = s.isSpinning;
        if (s.airTime > airMax[i]) airMax[i] = s.airTime;
      }
      if (steps % 300 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const standings = rm.getStandings();
    const respawns = rm.trackers.map((tr) => tr.respawnCount);
    return {
      done: document.getElementById('ui').dataset.state === 'results',
      simSeconds: steps * 0.05,
      length: Math.round(race.track.length),
      times: standings.map((s) => s.finishTime),
      respawns,
      spins,
      moverHits,
      airMax: Math.max(...airMax),
      laps: race.karts.map((k) => k.state.lap),
    };
  });
  await page.close();
  const finished = r.times.filter((x) => x > 0);
  const total = (a) => a.reduce((x, y) => x + y, 0);
  const flag = !r.done || finished.length < 5 || Math.max(...r.respawns) > 4 || errors.length ? '  <-- CHECK' : '';
  console.log(
    `${trackId.padEnd(16)} ${String(r.length).padStart(5)} m  finished ${finished.length}/8  win ${finished.length ? Math.min(...finished).toFixed(1) : '   -'} s  last ${
      finished.length ? Math.max(...finished).toFixed(1) : '   -'
    } s  respawns ${total(r.respawns)} (max ${Math.max(...r.respawns)})  spins ${total(r.spins)} (${r.moverHits} by movers)  longest air ${r.airMax.toFixed(2)} s${
      errors.length ? `  errors: ${errors[0]}` : ''
    }${flag}`,
  );
}

/** Put the camera kart `back` metres before each t, let it run a moment, and take a picture. */
async function shots(trackId) {
  const { page } = await open(1280, 720);
  await start(page, trackId, DIFFICULTY);
  await waitState(page, 'racing');
  // Let the start banners clear and the field spread out, and keep centre messages off the picture.
  await page.addStyleTag({ content: '.hud-center, .hud-wrongway { display: none !important; }' });
  await page.evaluate(() => {
    const g = window.__turboKartRush;
    let t = performance.now();
    for (let i = 0; i < 120; i++) {
      t += 50;
      g.loop(t);
    }
  });
  for (const at of SHOTS) {
    await page.evaluate(async (at) => {
      const g = window.__turboKartRush;
      const race = g.race;
      const kart = race.karts[race.localKartId];
      const back = 26 / race.track.length;
      const s = race.track.sample((((at - back) % 1) + 1) % 1);
      const heading = Math.atan2(-s.tangent.x, -s.tangent.z);
      const q = kart.state.quaternion.clone().setFromAxisAngle({ x: 0, y: 1, z: 0 }, heading);
      const pos = s.position.clone();
      pos.y += 0.3;
      kart.resetTo(pos, q);
      // The closest-point search starts from the kart's last lap position; tell it where it is now,
      // or a parallel stretch of road nearby can be picked instead.
      kart.state.trackT = (((at - back) % 1) + 1) % 1;
      kart.state.speed = 16;
      // Park the other karts out of the frame so the gimmick is what the picture shows.
      let t = performance.now();
      for (let i = 0; i < 24; i++) {
        t += 33;
        g.loop(t);
      }
    }, at);
    await sleep(150);
    const where = await page.evaluate(() => {
      const race = window.__turboKartRush.race;
      return race.karts[race.localKartId].state.trackT;
    });
    if (Math.abs(where - at) > 0.06) console.log(`  note: wanted t=${at}, the kart is at t=${where.toFixed(3)}`);
    await page.screenshot({ path: `${OUT}/${trackId}-t${String(at).replace('.', '_')}.png` });
  }
  await page.close();
  console.log(`${trackId}: ${SHOTS.length} shot(s) in ${OUT}`);
}

const { page: probe } = await open(320, 200);
const ids = await probe.evaluate(() => window.__turboKartRush.mainMenu.tracks.map((t) => t.id));
await probe.close();
const list = TRACK === 'all' ? ids : TRACK.split(',');
for (const id of list) {
  if (!ids.includes(id)) {
    console.log(`unknown track: ${id}`);
    continue;
  }
  if (SHOTS.length) await shots(id);
  else await soak(id);
}
await browser.close();
