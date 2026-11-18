// Agent8 GameServer functions (Turbo Kart Rush).
//
// Root server.js is the platform's convention: a bare `class Server` — not exported —
// whose methods become remoteFunction endpoints, with $global and $sender injected.
// Plain JS, no build step: this file IS the deployment.
//
// Endpoints:
//   submitTime(trackId, timeMs, characterId, difficulty) — best per (account, track)
//   getTopTimes(trackId, limit)                          — top N + caller rank/best
//   getMyEntitlements()                                  — { premium, premiumRaces, nickname, cos }
//   grantPremiumRaces()                                  — +3 (cap 9, 10 grants/day) after a rewarded ad
//   consumePremiumRace(characterId)                      — -1 when starting a race with a premium kart
//   setNickname(name)                                    — stored on user state, renames my rows
//   setCosmetics(packed)                                 — garage look, stored on user state + my rows
//   setCupProgress({cupId: place})                       — best Grand Prix placing per cup
//   submitDaily(timeMs, characterId)                     — one attempt per UTC day, own board
//   getDailyTop(limit)                                   — today's board + my attempt state
//   $onItemPurchased({productId})                        — VXShop "premium-garage" → premium
//   beginRace(trackId, characterId, difficulty, mode)    — stamps the start of a race, returns { raceId }
//   finishRace(raceId, report)                           — pays coins for it, from the server's own tables
//   buyCosmetic(token) / buyKart(characterId)            — spends coins on one garage item / one premium kart
//   doubleRaceCoins(raceId)                              — pays the last race's coins again (5/day, after an ad)
//   claimAttendance(recover)                             — daily check-in, seven-day coin cycle
//   swapMission(index)                                   — trades one unfinished mission (1/day, after an ad)
//
// Economy: docs/superpowers/specs/2026-11-18-progression-server-design.md. Coins are computed here and
// only here; the client reports what happened in a race and never an amount.
//
// All purchase / ticket state lives in $global user state (server-authoritative).

const RANKING_ID = 'tkr_times';
// Mirror of src/track/tracks/index.ts. A track missing here has its times rejected on submit.
const TRACKS = new Set([
  'sunny_circuit',
  'coral_coast',
  'dune_drift',
  'frostbite_falls',
  'neon_nexus',
  'magma_ridge',
  'switchback_pass',
  'prism_skyway',
  // second wave (2026-11)
  'windmill_way',
  'tidal_run',
  'stunt_park',
  'tram_town',
  'canyon_rally',
  'glacier_gap',
  'ashfall_run',
  'skyline_loop',
]);
const CHARACTERS = new Set([
  'zippy', 'pixel', 'fennec', 'max', 'juno', 'kai', 'bram', 'rosa',
  // second wave (2026-11)
  'tubby', 'coco', 'rusty', 'zorp', 'vera', 'lou', 'dot', 'brine',
]);
const PREMIUM = new Set(['fennec', 'bram', 'rosa', 'coco', 'zorp', 'vera', 'brine']);
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const MIN_TIME_MS = 30000;
const MAX_TIME_MS = 1200000;
const GRANT_SIZE = 3;
const GRANT_CAP = 9;
const GRANTS_PER_DAY = 10;
/**
 * Packed cosmetics string (see src/core/cosmetics.ts). Stored opaque: the client sanitizes what
 * it renders, so the only job here is to keep a hostile payload small and free of surprises.
 */
const COS_MAX = 160;
const COS_RE = /^[a-z0-9:,]*$/;

/** Grand Prix cups (mirror of src/core/cups.ts) and the placing range a cup result may claim. */
const CUPS = new Set(['rookie', 'pro', 'championship', 'stunt', 'extreme']);
const MAX_PLACE = 8;

/**
 * Daily challenge board. A separate collection from `tkr_times` on purpose: the daily runs a
 * seeded rule set (lap count, difficulty, kart class) that a normal track record must not be
 * compared against, and `submitTime` validates trackId against the fixed circuit list anyway.
 */
const DAILY_ID = 'tkr_daily';
const DAILY_KEEP_DAYS = 3;

// ── Economy tables ────────────────────────────────────────────────────────────
// Mirror of src/core/economy.ts. src/verse8/serverEconomy.test.ts reads these out of this file and
// holds them equal to the client's copy, so a price shown in the garage is the price charged here.

/** Coins by finishing place (1st..8th), and what a retirement pays whatever the place. */
const RACE_COINS = [60, 45, 35, 28, 22, 18, 14, 10];
const RETIRE_COINS = 5;
/** Difficulty multiplier on race coins, in percent so the sum stays in integers. */
const DIFF_PCT = { easy: 80, normal: 100, hard: 130 };
const MODES = new Set(['solo', 'teamPoints', 'teamFirst']);
/** Per UTC day: this many races at full rate, then REDUCED_PCT, then nothing from RACE_CAP on. */
const FULL_RACES = 10;
const REDUCED_PCT = 30;
const RACE_CAP = 60;
/** A paid race must have lasted this long, and the server's own clock must agree it did. */
const MIN_RACE_MS = 30000;
const RACE_CLOCK_SLACK = 0.95;
const KART_PRICE = 2500;
/** Rewarded-ad doublings of a race's coins, and mission swaps, per UTC day. */
const DOUBLES_PER_DAY = 5;
const SWAPS_PER_DAY = 1;

/** Experience by finishing place; a retirement earns RETIRE_XP. Not scaled by difficulty. */
const RACE_XP = [60, 50, 40, 30, 30, 30, 30, 30];
const RETIRE_XP = 10;
/** Level curve: LEVEL_BASE to reach level 2, LEVEL_STEP more for each level after, up to MAX_LEVEL. */
const LEVEL_BASE = 100;
const LEVEL_STEP = 50;
const MAX_LEVEL = 30;
const LEVEL_COINS = 100;
function levelOf(xp) {
  let level = 1;
  let need = LEVEL_BASE;
  let left = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  while (level < MAX_LEVEL && left >= need) {
    left -= need;
    level += 1;
    need += LEVEL_STEP;
  }
  return level;
}

/** Check-in coins for day 1..7 of the cycle; the eighth day in a row is day 1 again. */
const STREAK_COINS = [50, 60, 80, 100, 120, 150, 300];

const run = (n, price) => new Array(n).fill(price);
/**
 * Coin price of every garage entry, by packed key and catalogue index (src/core/cosmetics.ts).
 * 0 = free, -1 = not for sale (earned by level or by check-ins). Catalogue arrays are append-only,
 * so an index is a permanent id. The entries after the gap in each row are the earn-only ones.
 */
const COS_PRICES = {
  // none · stripes · racing + geometric · organic · fades · special
  p: [0, ...run(5, 400), ...run(11, 500), ...run(6, 600), ...run(5, 700), ...run(5, 1000)],
  u: [0, ...run(6, 500)],
  t: [0, ...run(10, 600), /* comet, confetti, snow, meteor */ -1, -1, -1, 2000],
  f: [0, ...run(8, 700), /* aurora, dawn, inferno, supernova */ -1, -1, 2000, 2500],
  w: [0, ...run(4, 400), /* goldRim, neonRim */ -1, 1500],
  e: [0, ...run(5, 800)],
  g: [0, ...run(8, 300), /* medal, laurel, sun, trophy */ -1, -1, -1, 1500],
};
/** Level reached -> entry it awards. */
const LEVEL_REWARDS = { 5: 'g:9', 10: 'w:5', 15: 't:b', 20: 'f:9', 25: 't:c', 30: 'g:a' };
/** Total days checked in (not the current run) -> entry it awards. */
const STREAK_REWARDS = { 7: 'g:b', 14: 'f:a', 30: 't:d' };
/** Coin-only shelf: for sale, but like the rewards above not covered by the 100 VX pass. */
const SHOWCASE = ['w:6', 'g:c', 'f:b', 't:e', 'f:c'];
/** Everything the pass does not open. */
const EARN_ONLY = new Set([...Object.values(LEVEL_REWARDS), ...Object.values(STREAK_REWARDS), ...SHOWCASE]);

// ── Daily missions ────────────────────────────────────────────────────────────
// Three a day, one per tier, picked from the date so every player gets the same set. A mission
// with `stat` adds up a counter the client reports (clamped by STAT_CAP); one without counts races
// that met its condition. `track` and `class` carry a parameter in their key: `track:coral_coast`.
const MISSIONS = [
  { id: 'finish', tier: 0, target: 3 },
  { id: 'items', tier: 0, target: 8, stat: 'items' },
  { id: 'start', tier: 0, target: 2, stat: 'start' },
  { id: 'track', tier: 0, target: 1 },
  { id: 'class', tier: 0, target: 1 },
  { id: 'podium', tier: 1, target: 2 },
  { id: 'drift', tier: 1, target: 10, stat: 'drift' },
  { id: 'draft', tier: 1, target: 3, stat: 'draft' },
  { id: 'hits', tier: 1, target: 3, stat: 'hits' },
  { id: 'tricks', tier: 1, target: 5, stat: 'tricks' },
  { id: 'clean', tier: 1, target: 1 },
  { id: 'daily', tier: 1, target: 1 },
  { id: 'win', tier: 2, target: 1 },
  { id: 'hardPodium', tier: 2, target: 1 },
  { id: 'team', tier: 2, target: 1 },
  { id: 'cup', tier: 2, target: 1 },
];
/** Reward by tier (easy, normal, hard), and the bonus for finishing all three. */
const MISSION_COINS = [40, 70, 120];
const MISSION_XP = [20, 35, 60];
const MISSION_BONUS = 100;
/** Most of each counter one race may report. */
const STAT_CAP = { items: 30, start: 1, drift: 60, draft: 30, hits: 30, tricks: 40, walls: 999 };
/** A "clean" finish allows this many wall or obstacle hits. */
const CLEAN_WALLS = 3;
/** Mirror of each racer's weight class in src/kart/roster.ts. */
const CLASS_OF = {
  zippy: 'light', pixel: 'light', fennec: 'light', max: 'medium', juno: 'medium', kai: 'medium', bram: 'heavy', rosa: 'heavy',
  tubby: 'light', coco: 'light', rusty: 'medium', zorp: 'medium', vera: 'medium', lou: 'heavy', dot: 'heavy', brine: 'heavy',
};
const CLASSES = ['light', 'medium', 'heavy'];

/** FNV-1a, the same hash as src/core/daily.ts `seedOf`. */
function seedOf(day) {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const missionDef = (key) => MISSIONS.find((m) => m.id === String(key).split(':')[0]);
/** The stored key of a mission: its id, plus the day's circuit or class where it needs one. */
function missionKey(def, seed) {
  if (def.id === 'track') {
    const tracks = [...TRACKS];
    return 'track:' + tracks[(seed >>> 3) % tracks.length];
  }
  if (def.id === 'class') return 'class:' + CLASSES[(seed >>> 7) % CLASSES.length];
  return def.id;
}
/** Today's three keys, easy to hard. */
function missionsFor(day) {
  const seed = seedOf(day);
  return [0, 1, 2].map((tier) => {
    const pool = MISSIONS.filter((m) => m.tier === tier);
    return missionKey(pool[(seed >>> (tier * 5)) % pool.length], seed);
  });
}
function dayBefore(day, n) {
  return new Date(Date.parse(day + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
}
const TOKEN_RE = /^([a-z]):([a-z0-9]+)$/;

/** `p:0f` → `p:f`; null for anything that is not a known garage entry. */
function cosToken(raw) {
  const m = typeof raw === 'string' ? TOKEN_RE.exec(raw) : null;
  if (!m || !COS_PRICES[m[1]]) return null;
  const index = Number.parseInt(m[2], 36);
  if (!Number.isFinite(index) || COS_PRICES[m[1]][index] === undefined) return null;
  return `${m[1]}:${index.toString(36)}`;
}
function cosPrice(token) {
  const m = TOKEN_RE.exec(token);
  return m && COS_PRICES[m[1]] ? COS_PRICES[m[1]][Number.parseInt(m[2], 36)] : undefined;
}

const ROOMS_ID = 'tkr_rooms';
const ROOM_CAP = 8;
const ROOM_STALE_MS = 90000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Mirror of src/verse8/nickname.ts — keep in sync.
const BLOCKED = ['nigger', 'faggot', 'retard', '씨발', '시발', '병신', '좆'];
function normalizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^A-Za-z0-9가-힣 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12)
    .trim();
  const low = cleaned.toLowerCase();
  if (BLOCKED.some((w) => low.includes(w))) return '';
  return cleaned;
}
function defaultNickname(account) {
  const tail = String(account || '')
    .replace(/^0x/i, '')
    .slice(-4)
    .toUpperCase();
  return tail ? `RACER-${tail}` : 'RACER';
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

class Server {
  async ping() {
    return 'pong';
  }

  async _state() {
    const s = await $global.getUserState($sender.account);
    return s || {};
  }

  _cos(state) {
    const c = state && typeof state.cos === 'string' ? state.cos : '';
    return c.length <= COS_MAX && COS_RE.test(c) ? c : '';
  }

  /** Best placing per cup, kept clean of unknown ids and impossible places. */
  _cups(state) {
    const raw = state && state.cups;
    const out = {};
    if (raw && typeof raw === 'object') {
      for (const id of CUPS) {
        const v = raw[id];
        if (Number.isFinite(v) && v >= 1 && v <= MAX_PLACE) out[id] = Math.floor(v);
      }
    }
    return out;
  }

  /** Both names are read: `adsRemoved` is what the retired remove-ads product wrote. */
  _premium(state) {
    return !!(state && (state.premium || state.adsRemoved));
  }

  _nickname(state) {
    const n = normalizeNickname(state && state.nickname);
    return n || defaultNickname($sender.account);
  }

  // ── Economy helpers ──────────────────────────────────────────────────────

  _coins(state) {
    return state && Number.isFinite(state.coins) ? Math.max(0, Math.floor(state.coins)) : 0;
  }

  _xp(state) {
    return state && Number.isFinite(state.xp) ? Math.max(0, Math.floor(state.xp)) : 0;
  }

  /**
   * Everything the account owns item by item: what it bought with coins (garage tokens `p:f`,
   * karts `k:rosa`) and what its level and check-in total have earned. The earned ones are worked
   * out here every time rather than stored, so a reward can never fail to arrive.
   */
  _ownSet(state) {
    const out = this._boughtSet(state);
    const level = levelOf(this._xp(state));
    for (const at of Object.keys(LEVEL_REWARDS)) if (level >= Number(at)) out.add(LEVEL_REWARDS[at]);
    const total = this._streak(state).total;
    for (const at of Object.keys(STREAK_REWARDS)) if (total >= Number(at)) out.add(STREAK_REWARDS[at]);
    return out;
  }

  /** The stored half of `_ownSet`: only what was paid for. This is what gets written back. */
  _boughtSet(state) {
    const out = new Set();
    const raw = state && typeof state.own === 'string' && COS_RE.test(state.own) ? state.own : '';
    for (const part of raw.split(',')) {
      const m = TOKEN_RE.exec(part);
      if (!m) continue;
      if (m[1] === 'k') {
        if (PREMIUM.has(m[2])) out.add(part);
      } else {
        const token = cosToken(part);
        if (token) out.add(token);
      }
    }
    return out;
  }

  /** The one ownership rule: free, owned, or covered by the 100 VX pass (which skips EARN_ONLY). */
  _owns(state, token, own) {
    const price = cosPrice(token);
    if (price === undefined) return false;
    if (price === 0) return true;
    if ((own || this._ownSet(state)).has(token)) return true;
    return this._premium(state) && !EARN_ONLY.has(token);
  }

  /** A packed look with every entry the account does not own taken out. Colours always stay. */
  _ownedCos(state, packed) {
    const own = this._ownSet(state);
    const keep = [];
    for (const part of packed.split(',')) {
      const colon = part.indexOf(':');
      if (colon <= 0) continue;
      if (!COS_PRICES[part.slice(0, colon)]) {
        keep.push(part);
        continue;
      }
      const token = cosToken(part);
      if (token && this._owns(state, token, own)) keep.push(token);
    }
    return keep.join(',');
  }

  /** Today's ledger. A stored one from another UTC day reads as a fresh day. */
  _eco(state) {
    const day = todayKey();
    const e = state && state.eco && state.eco.day === day ? state.eco : null;
    const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    return { day, races: e ? n(e.races) : 0, doubles: e ? n(e.doubles) : 0, swaps: e ? n(e.swaps) : 0 };
  }

  /** Check-in record: last day claimed, length of the current run, days claimed in total. */
  _streak(state) {
    const st = state && state.streak;
    const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const last = st && typeof st.last === 'string' && /^\d{4}-\d\d-\d\d$/.test(st.last) ? st.last : '';
    return last ? { last, n: Math.max(1, n(st.n)), total: Math.max(1, n(st.total)) } : { last: '', n: 0, total: 0 };
  }

  /**
   * The check-in record as the client needs it: can today be claimed, which day of the cycle
   * would it be, and is the run broken by exactly one missed day (the only break an ad can mend).
   */
  _streakView(state) {
    const st = this._streak(state);
    const today = todayKey();
    const claimed = st.last === today;
    const canRecover = !claimed && st.n > 0 && st.last === dayBefore(today, 2);
    const next = claimed ? st.n : st.last === dayBefore(today, 1) ? st.n + 1 : 1;
    return { last: st.last, n: st.n, total: st.total, claimed, canRecover, next };
  }

  /** Today's missions. A stored set from another UTC day (or a malformed one) reads as a new day. */
  _mis(state) {
    const day = todayKey();
    const m = state && state.mis;
    if (m && m.day === day && Array.isArray(m.ids) && m.ids.length === 3 && m.ids.every((k) => missionDef(k))) {
      const p = [0, 1, 2].map((i) => (Array.isArray(m.p) && Number.isFinite(m.p[i]) && m.p[i] > 0 ? Math.floor(m.p[i]) : 0));
      const done = [0, 1, 2].map((i) => !!(Array.isArray(m.done) && m.done[i]));
      return { day, ids: m.ids.slice(), p, done, bonus: !!m.bonus };
    }
    return { day, ids: missionsFor(day), p: [0, 0, 0], done: [false, false, false], bonus: false };
  }

  _misView(mis, eco) {
    return {
      day: mis.day,
      list: mis.ids.map((key, i) => {
        const def = missionDef(key);
        return {
          key,
          tier: def.tier,
          target: def.target,
          progress: Math.min(def.target, mis.p[i]),
          done: mis.done[i],
          coins: MISSION_COINS[def.tier],
          xp: MISSION_XP[def.tier],
        };
      }),
      bonus: mis.bonus,
      bonusCoins: MISSION_BONUS,
      swapsLeft: Math.max(0, SWAPS_PER_DAY - eco.swaps),
    };
  }

  /** How far one race moves one mission. `race` is what beginRace stored, `rep` the finish report. */
  _missionGain(key, race, rep, place, retired) {
    const def = missionDef(key);
    const param = String(key).split(':')[1];
    const finished = !retired;
    const stats = rep.stats && typeof rep.stats === 'object' ? rep.stats : {};
    const stat = (name) => {
      const v = Math.floor(Number(stats[name]));
      return Number.isFinite(v) && v > 0 ? Math.min(STAT_CAP[name], v) : 0;
    };
    if (def.stat) return stat(def.stat);
    switch (def.id) {
      case 'finish':
        return finished ? 1 : 0;
      case 'track':
        return finished && race.trackId === param ? 1 : 0;
      case 'class':
        return finished && CLASS_OF[race.characterId] === param ? 1 : 0;
      case 'podium':
        return finished && place <= 3 ? 1 : 0;
      case 'clean':
        // No report of wall hits is not a clean race: the claim has to be made.
        return finished && Number.isFinite(Number(stats.walls)) && stat('walls') <= CLEAN_WALLS ? 1 : 0;
      case 'daily':
        return finished && rep.daily === true ? 1 : 0;
      case 'win':
        return finished && place === 1 ? 1 : 0;
      case 'hardPodium':
        return finished && race.difficulty === 'hard' && place <= 3 ? 1 : 0;
      case 'team':
        return race.mode !== 'solo' && rep.teamWon === true ? 1 : 0;
      case 'cup':
        return finished && rep.cupDone === true ? 1 : 0;
      default:
        return 0;
    }
  }

  // ── Race rewards ─────────────────────────────────────────────────────────

  /**
   * Stamps the start of a race with this server's clock. `finishRace` pays against the stamp, so a
   * reward costs at least as much real time as the race it claims to be for.
   */
  async beginRace(trackId, characterId, difficulty, mode) {
    if (!TRACKS.has(trackId)) throw new Error('Unknown track.');
    if (!CHARACTERS.has(characterId)) throw new Error('Unknown character.');
    if (!DIFFICULTIES.has(difficulty)) throw new Error('Unknown difficulty.');
    const id = Date.now().toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36);
    const race = { id, at: Date.now(), trackId, characterId, difficulty, mode: MODES.has(mode) ? mode : 'solo' };
    await $global.updateUserState($sender.account, { race });
    return { raceId: id };
  }

  /**
   * Pays for the race `beginRace` opened. The report says where the player finished; every number
   * that follows from it is worked out here. Refusals are answers, not errors, so the client can
   * tell the player which it was.
   */
  async finishRace(raceId, report) {
    const s = await this._state();
    const coins = this._coins(s);
    const eco = this._eco(s);
    const refuse = (reason) => ({ ok: false, reason, coins, races: eco.races });
    const race = s.race;
    if (!race || typeof raceId !== 'string' || race.id !== raceId) return refuse('no-race');
    const rep = report && typeof report === 'object' ? report : {};
    const timeMs = Math.min(MAX_TIME_MS, Number(rep.timeMs));
    if (!Number.isFinite(timeMs) || timeMs < MIN_RACE_MS) return refuse('bad-time');
    if (Date.now() - race.at < timeMs * RACE_CLOCK_SLACK) return refuse('too-fast');
    const retired = !!rep.retired;
    const place = Math.floor(Number(rep.place));
    if (!(place >= 1 && place <= MAX_PLACE)) return refuse('bad-place');

    const rate = eco.races < FULL_RACES ? 100 : eco.races < RACE_CAP ? REDUCED_PCT : 0;
    const raceCoins = Math.round(((retired ? RETIRE_COINS : RACE_COINS[place - 1]) * DIFF_PCT[race.difficulty] * rate) / 10000);
    const raceXp = Math.round(((retired ? RETIRE_XP : RACE_XP[place - 1]) * rate) / 100);

    // Missions: every unfinished one moves by what this race did; a finished one pays at once.
    const mis = this._mis(s);
    let missionCoins = 0;
    let missionXp = 0;
    const completed = [];
    for (let i = 0; i < 3; i++) {
      if (mis.done[i]) continue;
      const def = missionDef(mis.ids[i]);
      mis.p[i] = Math.min(def.target, mis.p[i] + this._missionGain(mis.ids[i], race, rep, place, retired));
      if (mis.p[i] < def.target) continue;
      mis.done[i] = true;
      missionCoins += MISSION_COINS[def.tier];
      missionXp += MISSION_XP[def.tier];
      completed.push(mis.ids[i]);
    }
    let bonus = false;
    if (!mis.bonus && mis.done.every(Boolean)) {
      mis.bonus = true;
      bonus = true;
      missionCoins += MISSION_BONUS;
    }

    // Levels: every level gained pays LEVEL_COINS; the entries a level awards follow from xp.
    const xpBefore = this._xp(s);
    const xp = xpBefore + raceXp + missionXp;
    const levelBefore = levelOf(xpBefore);
    const level = levelOf(xp);
    const levelCoins = (level - levelBefore) * LEVEL_COINS;
    const unlocked = [];
    for (let l = levelBefore + 1; l <= level; l++) if (LEVEL_REWARDS[l]) unlocked.push(LEVEL_REWARDS[l]);

    const next = coins + raceCoins + missionCoins + levelCoins;
    const day = { ...eco, races: eco.races + 1 };
    const patch = {
      coins: next,
      xp,
      race: null,
      eco: day,
      mis,
      award: { id: race.id, coins: raceCoins, doubled: false },
    };
    await $global.updateUserState($sender.account, patch);
    return {
      ok: true,
      raceId: race.id,
      coins: next,
      earned: { race: raceCoins, missions: missionCoins, levels: levelCoins, total: raceCoins + missionCoins + levelCoins },
      races: day.races,
      rate,
      xp,
      xpEarned: raceXp + missionXp,
      level,
      levelUps: level - levelBefore,
      missions: this._misView(mis, day),
      completed,
      bonus,
      unlocked,
      own: [...this._ownSet({ ...s, ...patch })].join(','),
      doublesLeft: raceCoins > 0 ? Math.max(0, DOUBLES_PER_DAY - day.doubles) : 0,
    };
  }

  /**
   * Pays the last race's coins a second time. Called only after the host has verified a rewarded
   * ad (the trust model of grantPremiumRaces); what is counted here is how often.
   */
  async doubleRaceCoins(raceId) {
    const s = await this._state();
    const coins = this._coins(s);
    const eco = this._eco(s);
    const award = s.award;
    const left = Math.max(0, DOUBLES_PER_DAY - eco.doubles);
    const refuse = (reason) => ({ ok: false, reason, coins, added: 0, doublesLeft: left });
    if (!award || typeof raceId !== 'string' || award.id !== raceId) return refuse('no-race');
    if (award.doubled) return refuse('done');
    if (left <= 0) return refuse('limit');
    const added = Number.isFinite(award.coins) && award.coins > 0 ? Math.floor(award.coins) : 0;
    if (added <= 0) return refuse('nothing');
    await $global.updateUserState($sender.account, {
      coins: coins + added,
      award: { ...award, doubled: true },
      eco: { ...eco, doubles: eco.doubles + 1 },
    });
    return { ok: true, coins: coins + added, added, doublesLeft: left - 1 };
  }

  // ── Check-in ─────────────────────────────────────────────────────────────

  /**
   * Claims today's check-in. A run continues from yesterday. A run broken by exactly one missed
   * day is the caller's choice: `recover === true` (after a rewarded ad) carries it on,
   * `recover === false` starts over at day 1, and saying neither changes nothing and reports that
   * the choice exists. Anything older starts over.
   */
  async claimAttendance(recover) {
    const s = await this._state();
    const coins = this._coins(s);
    const st = this._streak(s);
    const view = this._streakView(s);
    if (view.claimed) return { ok: false, reason: 'claimed', coins, reward: 0, streak: view, unlocked: [] };
    let n = 1;
    if (st.last === dayBefore(todayKey(), 1)) n = st.n + 1;
    else if (view.canRecover) {
      if (recover === true) n = st.n + 1;
      else if (recover !== false) return { ok: false, reason: 'choose', coins, reward: 0, streak: view, unlocked: [] };
    }
    const reward = STREAK_COINS[(n - 1) % STREAK_COINS.length];
    const total = st.total + 1;
    const streak = { last: todayKey(), n, total };
    await $global.updateUserState($sender.account, { coins: coins + reward, streak });
    const next = { ...s, coins: coins + reward, streak };
    return {
      ok: true,
      coins: coins + reward,
      reward,
      streak: this._streakView(next),
      unlocked: STREAK_REWARDS[total] ? [STREAK_REWARDS[total]] : [],
      own: [...this._ownSet(next)].join(','),
    };
  }

  // ── Missions ─────────────────────────────────────────────────────────────

  /**
   * Trades one unfinished mission for the next candidate of the same tier (after a rewarded ad).
   * Progress on the traded mission is lost, which is the price of the trade.
   */
  async swapMission(index) {
    const s = await this._state();
    const eco = this._eco(s);
    const mis = this._mis(s);
    const refuse = (reason) => ({ ok: false, reason, missions: this._misView(mis, eco) });
    const i = Math.floor(Number(index));
    if (!(i >= 0 && i <= 2)) return refuse('unknown');
    if (mis.done[i]) return refuse('done');
    if (eco.swaps >= SWAPS_PER_DAY) return refuse('limit');
    const current = missionDef(mis.ids[i]);
    const pool = MISSIONS.filter((m) => m.tier === current.tier);
    const replacement = pool[(pool.indexOf(current) + 1) % pool.length];
    mis.ids[i] = missionKey(replacement, seedOf(mis.day));
    mis.p[i] = 0;
    const day = { ...eco, swaps: eco.swaps + 1 };
    await $global.updateUserState($sender.account, { mis, eco: day });
    return { ok: true, missions: this._misView(mis, day) };
  }

  // ── Spending ─────────────────────────────────────────────────────────────

  /** Unlocks one garage entry for coins. Already open (owned, free, or the pass) costs nothing. */
  async buyCosmetic(rawToken) {
    const s = await this._state();
    const coins = this._coins(s);
    const bought = this._boughtSet(s);
    const reply = (ok, reason, c) => ({
      ok,
      reason,
      coins: c === undefined ? coins : c,
      own: [...this._ownSet({ ...s, own: [...bought].join(',') })].join(','),
    });
    const token = cosToken(rawToken);
    if (!token) return reply(false, 'unknown');
    if (this._owns(s, token)) return reply(true, 'owned');
    const price = cosPrice(token);
    // Not for sale at any price: it comes with a level or a check-in total.
    if (price < 0) return reply(false, 'earn');
    if (coins < price) return reply(false, 'short');
    bought.add(token);
    await $global.updateUserState($sender.account, { coins: coins - price, own: [...bought].join(',') });
    return reply(true, undefined, coins - price);
  }

  /** Unlocks one premium kart for good. Tickets and the pass keep working as before. */
  async buyKart(characterId) {
    const s = await this._state();
    const coins = this._coins(s);
    const bought = this._boughtSet(s);
    const reply = (ok, reason, c) => ({
      ok,
      reason,
      coins: c === undefined ? coins : c,
      own: [...this._ownSet({ ...s, own: [...bought].join(',') })].join(','),
    });
    if (!PREMIUM.has(characterId)) return reply(false, 'unknown');
    const token = 'k:' + characterId;
    if (this._premium(s) || bought.has(token)) return reply(true, 'owned');
    if (coins < KART_PRICE) return reply(false, 'short');
    bought.add(token);
    await $global.updateUserState($sender.account, { coins: coins - KART_PRICE, own: [...bought].join(',') });
    return reply(true, undefined, coins - KART_PRICE);
  }

  /**
   * All ranking rows. The platform's getCollectionItems honours ONLY { limit } — filters /
   * orderBy / countCollectionItems are silently ignored or throw — so every query below reads
   * the collection and filters in JS. (With filters ignored, the old submitTime deleted every
   * player's rows on each submit.)
   */
  async _allTimes() {
    const rows = await $global.getCollectionItems(RANKING_ID, { limit: 1000 }).catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }

  async _rankOf(trackId, timeMs, rows) {
    const all = rows || (await this._allTimes());
    let faster = 0;
    for (const r of all) if (r.trackId === trackId && typeof r.timeMs === 'number' && r.timeMs < timeMs) faster++;
    return faster + 1;
  }

  async submitTime(trackId, timeMs, characterId, difficulty) {
    if (!TRACKS.has(trackId)) throw new Error('Unknown track.');
    if (!CHARACTERS.has(characterId)) throw new Error('Unknown character.');
    if (!DIFFICULTIES.has(difficulty)) throw new Error('Unknown difficulty.');
    if (typeof timeMs !== 'number' || !isFinite(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
      throw new Error('Time out of range.');
    }
    const state = await this._state();
    const name = this._nickname(state);
    const candidate = {
      account: $sender.account,
      name,
      trackId,
      timeMs: Math.floor(timeMs),
      characterId,
      difficulty,
      // Snapshot of the look this time was set with, so a records row can show the kart.
      cos: this._cos(state),
      createdAt: Date.now(),
    };
    const all = await this._allTimes();
    const mine = all.filter((r) => r.account === $sender.account && r.trackId === trackId);
    const best = mine.length > 0 ? mine.slice().sort((a, b) => a.timeMs - b.timeMs)[0] : null;
    if (best && candidate.timeMs >= best.timeMs) {
      return { updated: false, rank: await this._rankOf(trackId, best.timeMs, all), timeMs: best.timeMs };
    }
    for (const row of mine) if (row.__id) await $global.deleteCollectionItem(RANKING_ID, row.__id).catch(() => {});
    await $global.addCollectionItem(RANKING_ID, candidate);
    const others = all.filter((r) => !(r.account === $sender.account && r.trackId === trackId));
    others.push(candidate);
    return { updated: true, rank: await this._rankOf(trackId, candidate.timeMs, others), timeMs: candidate.timeMs };
  }

  async getTopTimes(trackId, limit) {
    if (!TRACKS.has(trackId)) throw new Error('Unknown track.');
    const n = typeof limit === 'number' && limit > 0 ? Math.min(100, Math.floor(limit)) : 20;
    const all = await this._allTimes();
    const rows = all
      .filter((r) => r.trackId === trackId && typeof r.timeMs === 'number')
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, n);
    let myRank = null;
    let myBest = null;
    const mine = all.filter((r) => r.account === $sender.account && r.trackId === trackId);
    if (mine.length > 0) {
      const best = mine.slice().sort((a, b) => a.timeMs - b.timeMs)[0];
      myBest = best.timeMs;
      myRank = await this._rankOf(trackId, best.timeMs);
    }
    return {
      rows: rows.map((r) => ({
        name: r.name,
        timeMs: r.timeMs,
        characterId: r.characterId,
        difficulty: r.difficulty,
        cos: typeof r.cos === 'string' ? r.cos : '',
        account: r.account,
      })),
      myRank,
      myBest,
    };
  }

  async setNickname(name) {
    const nickname = normalizeNickname(name);
    if (!nickname) throw new Error('Invalid nickname.');
    await $global.updateUserState($sender.account, { nickname });
    // Rename existing records (best effort — the user state above is the source of truth).
    const mine = (await this._allTimes()).filter((r) => r.account === $sender.account);
    // updateCollectionItem is (collectionId, item) — the item carries its own __id. A 3-arg call is a silent no-op.
    for (const row of mine) {
      if (row.__id) await $global.updateCollectionItem(RANKING_ID, { ...row, name: nickname }).catch(() => {});
    }
    return { nickname };
  }

  /**
   * Saves the garage look, minus anything the account does not own. Also stamped onto my existing ranking rows, the same best-effort
   * rewrite setNickname does, so the records board shows the kart I drive today.
   */
  async setCosmetics(packed) {
    const raw = typeof packed === 'string' ? packed : '';
    if (raw.length > COS_MAX || !COS_RE.test(raw)) throw new Error('Invalid cosmetics.');
    // Ownership is decided here, not by the client that drew the look: a paid entry the account
    // has not unlocked is dropped before it can reach the records board.
    const cos = this._ownedCos(await this._state(), raw);
    await $global.updateUserState($sender.account, { cos });
    const mine = (await this._allTimes()).filter((r) => r.account === $sender.account);
    for (const row of mine) {
      if (row.__id) await $global.updateCollectionItem(RANKING_ID, { ...row, cos }).catch(() => {});
    }
    return { cos };
  }

  /**
   * Records Grand Prix results. Merged rather than replaced, and only ever improved: a client
   * replaying an old cup cannot wipe a better placing it already earned.
   */
  async setCupProgress(progress) {
    const s = await this._state();
    const cur = this._cups(s);
    const next = { ...cur };
    if (progress && typeof progress === 'object') {
      for (const id of CUPS) {
        const v = progress[id];
        if (!Number.isFinite(v) || v < 1 || v > MAX_PLACE) continue;
        const place = Math.floor(v);
        if (next[id] === undefined || place < next[id]) next[id] = place;
      }
    }
    await $global.updateUserState($sender.account, { cups: next });
    return { cups: next };
  }

  async getMyEntitlements() {
    const s = await this._state();
    return {
      premium: this._premium(s),
      premiumRaces: Number.isFinite(s.premiumRaces) ? Math.max(0, Math.floor(s.premiumRaces)) : 0,
      nickname: normalizeNickname(s.nickname),
      cos: this._cos(s),
      cups: this._cups(s),
      coins: this._coins(s),
      own: [...this._ownSet(s)].join(','),
      eco: this._eco(s),
      xp: this._xp(s),
      streak: this._streakView(s),
      missions: this._misView(this._mis(s), this._eco(s)),
    };
  }

  /** Called by the client only after @verse8/ads resolved { status: 'rewarded' } (host-verified). */
  async grantPremiumRaces() {
    const s = await this._state();
    const day = todayKey();
    const grants = s.grants && s.grants.day === day ? s.grants.count : 0;
    const current = Number.isFinite(s.premiumRaces) ? s.premiumRaces : 0;
    if (grants >= GRANTS_PER_DAY) return { granted: false, premiumRaces: current };
    const premiumRaces = Math.min(GRANT_CAP, current + GRANT_SIZE);
    await $global.updateUserState($sender.account, { premiumRaces, grants: { day, count: grants + 1 } });
    return { granted: true, premiumRaces };
  }

  async consumePremiumRace(characterId) {
    const s = await this._state();
    const current = Number.isFinite(s.premiumRaces) ? s.premiumRaces : 0;
    if (!PREMIUM.has(characterId) || this._premium(s)) return { ok: true, premiumRaces: current };
    // A kart bought with coins is owned outright: it never spends a ticket.
    if (this._ownSet(s).has('k:' + characterId)) return { ok: true, premiumRaces: current };
    if (current <= 0) return { ok: false, premiumRaces: 0 };
    await $global.updateUserState($sender.account, { premiumRaces: current - 1 });
    return { ok: true, premiumRaces: current - 1 };
  }

  // ── Daily challenge ──────────────────────────────────────────────────────

  async _allDaily() {
    const rows = await $global.getCollectionItems(DAILY_ID, { limit: 1000 }).catch(() => []);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Files today's attempt. One per account per UTC day, enforced here: the client's clock and its
   * own "already played" flag are conveniences, not the rule.
   */
  async submitDaily(timeMs, characterId) {
    if (!CHARACTERS.has(characterId)) throw new Error('Unknown character.');
    if (typeof timeMs !== 'number' || !isFinite(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
      throw new Error('Time out of range.');
    }
    const day = todayKey();
    const state = await this._state();
    const daily = state.daily && state.daily.day === day ? state.daily : { day, used: false, timeMs: 0 };
    if (daily.used) {
      return { accepted: false, day, timeMs: daily.timeMs, rank: await this._dailyRank(day, daily.timeMs) };
    }
    const row = {
      account: $sender.account,
      name: this._nickname(state),
      day,
      timeMs: Math.floor(timeMs),
      characterId,
      cos: this._cos(state),
      createdAt: Date.now(),
    };
    await $global.addCollectionItem(DAILY_ID, row);
    await $global.updateUserState($sender.account, { daily: { day, used: true, timeMs: row.timeMs } });
    await this._pruneDaily(day);
    return { accepted: true, day, timeMs: row.timeMs, rank: await this._dailyRank(day, row.timeMs) };
  }

  async _dailyRank(day, timeMs) {
    if (!(timeMs > 0)) return null;
    const rows = (await this._allDaily()).filter((r) => r.day === day && typeof r.timeMs === 'number');
    let faster = 0;
    for (const r of rows) if (r.timeMs < timeMs) faster++;
    return faster + 1;
  }

  /** Old days are dead weight on a collection every query reads whole. */
  async _pruneDaily(day) {
    const cutoff = new Date(Date.parse(day + 'T00:00:00Z') - DAILY_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    const stale = (await this._allDaily()).filter((r) => typeof r.day === 'string' && r.day < cutoff);
    for (const r of stale) if (r.__id) await $global.deleteCollectionItem(DAILY_ID, r.__id).catch(() => {});
  }

  async getDailyTop(limit) {
    const n = typeof limit === 'number' && limit > 0 ? Math.min(100, Math.floor(limit)) : 20;
    const day = todayKey();
    const state = await this._state();
    const all = await this._allDaily();
    const rows = all
      .filter((r) => r.day === day && typeof r.timeMs === 'number')
      .sort((a, b) => a.timeMs - b.timeMs);
    const mine = rows.find((r) => r.account === $sender.account) || null;
    const daily = state.daily && state.daily.day === day ? state.daily : { day, used: false, timeMs: 0 };
    return {
      day,
      used: !!daily.used,
      myTimeMs: mine ? mine.timeMs : 0,
      myRank: mine ? rows.indexOf(mine) + 1 : null,
      entries: rows.length,
      rows: rows.slice(0, n).map((r) => ({
        name: r.name,
        timeMs: r.timeMs,
        characterId: r.characterId,
        cos: typeof r.cos === 'string' ? r.cos : '',
        account: r.account,
      })),
    };
  }

  /**
   * VXShop hook. "premium-garage" (100 VX, non-consumable) opens the paid half of the garage and
   * every kart permanently. "remove-ads" is the retired id, honoured in case an old order lands.
   */
  async $onItemPurchased({ account, purchaseId, productId, quantity }) {
    if (productId === 'premium-garage' || productId === 'remove-ads') {
      await $global.updateUserState(account, { premium: true });
    }
    return { success: true };
  }

  // ── Rooms (online multiplayer) ───────────────────────────────────────────
  // Relay + state store only: the host browser runs the authoritative 60 Hz sim
  // (see docs/VERSE8-CONTEXT.md and src/net/*). Rules from verse8-starter/docs/VERSE8-MULTIPLAYER.md:
  //   * updateCollectionItem takes (collectionId, item) — 2 args — or it silently no-ops.
  //   * relay vs relayHot split the per-function call cap; hot = throttled latest-wins.
  //   * Room listing = heartbeat (touchRoom every 5 s) + 90 s stale filter (tab throttling).

  now() {
    return Date.now();
  }

  async _upsertRoom(key, data) {
    const rooms = await $global.getCollectionItems(ROOMS_ID, { limit: 100 }).catch(() => []);
    const existing = rooms.find((r) => r.key === key);
    const item = { ...(existing || {}), key, ...data, at: Date.now() };
    if (existing && existing.__id) await $global.updateCollectionItem(ROOMS_ID, item);
    else await $global.addCollectionItem(ROOMS_ID, item);
  }

  async _roomCount() {
    const s = await $room.getRoomState();
    return Object.keys(s || {}).filter((k) => k.startsWith('p_')).length;
  }

  _newCode(taken) {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!taken.has(code)) return code;
    }
    return 'R' + String(Date.now() % 1000).padStart(3, '0');
  }

  async listRooms() {
    const rooms = await $global.getCollectionItems(ROOMS_ID, { limit: 100 }).catch(() => []);
    const cutoff = Date.now() - ROOM_STALE_MS;
    const fresh = [];
    for (const r of rooms) {
      if ((r.at || 0) >= cutoff) fresh.push(r);
      else if (r.__id) $global.deleteCollectionItem(ROOMS_ID, r.__id).catch(() => {});
    }
    const byKey = new Map();
    for (const r of fresh) {
      const prev = byKey.get(r.key);
      if (!prev || (r.at || 0) > (prev.at || 0)) byKey.set(r.key, r);
    }
    return [...byKey.values()].map((r) => ({
      key: r.key,
      count: r.count || 0,
      trackId: r.trackId || '',
      started: !!r.started,
    }));
  }

  /** key: 4-char code to join, or null for quick race (open room or a new one). */
  async joinRoom(key) {
    const rooms = await $global.getCollectionItems(ROOMS_ID, { limit: 100 }).catch(() => []);
    const cutoff = Date.now() - ROOM_STALE_MS;
    const live = rooms.filter((r) => (r.at || 0) >= cutoff);
    let target = typeof key === 'string' && key.trim() ? key.trim().toUpperCase() : '';
    if (!target) {
      for (const r of live) {
        if ((r.count || 0) < ROOM_CAP && !r.started) {
          target = r.key;
          break;
        }
      }
      if (!target) target = this._newCode(new Set(rooms.map((r) => r.key)));
    }
    await $global.joinRoom(target);
    const existing = rooms.find((r) => r.key === target);
    await this._upsertRoom(target, {
      count: await this._roomCount(),
      trackId: existing?.trackId || '',
      started: !!existing?.started,
    }).catch(() => {});
    return { roomId: target };
  }

  /** Create a brand-new room (never joins an existing one). */
  async createRoom() {
    const rooms = await $global.getCollectionItems(ROOMS_ID, { limit: 100 }).catch(() => []);
    const code = this._newCode(new Set(rooms.map((r) => r.key)));
    await $global.joinRoom(code);
    await this._upsertRoom(code, { count: await this._roomCount(), trackId: '', started: false }).catch(() => {});
    return { roomId: code };
  }

  async touchRoom(key, trackId, started) {
    await this._upsertRoom(key, {
      count: await this._roomCount(),
      trackId: typeof trackId === 'string' ? trackId : '',
      started: !!started,
    });
  }

  async leaveRoom() {
    try {
      await $room.updateRoomState({ ['p_' + $sender.account]: null });
    } catch (_e) {
      /* ignore */
    }
    return $global.leaveRoom();
  }

  async getRoomState() {
    return $room.getRoomState();
  }

  async updateRoomState(patch) {
    await $room.updateRoomState(patch);
    $room.broadcastToRoom('state', await $room.getRoomState());
  }

  relay(event, payload) {
    $room.broadcastToRoom('relay', { event, payload, from: $sender.account });
  }

  /** High-frequency latest-wins channel (snapshots / inputs) — clients call with { throttle: 50 }. */
  relayHot(event, payload) {
    $room.broadcastToRoom('relay', { event, payload, from: $sender.account });
  }
}
