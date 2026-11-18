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

const run = (n, price) => new Array(n).fill(price);
/**
 * Coin price of every garage entry, by packed key and catalogue index (src/core/cosmetics.ts).
 * 0 = free. Catalogue arrays are append-only, so an index is a permanent id.
 */
const COS_PRICES = {
  // none · stripes · racing + geometric · organic · fades · special
  p: [0, ...run(5, 400), ...run(11, 500), ...run(6, 600), ...run(5, 700), ...run(5, 1000)],
  u: [0, ...run(6, 500)],
  t: [0, ...run(10, 600)],
  f: [0, ...run(8, 700)],
  w: [0, ...run(4, 400)],
  e: [0, ...run(5, 800)],
  g: [0, ...run(8, 300)],
};
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

  /** Everything bought with coins: garage tokens (`p:f`) and karts (`k:rosa`). */
  _ownSet(state) {
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

  /** The one ownership rule: free, bought, or covered by the 100 VX pass. */
  _owns(state, token, own) {
    const price = cosPrice(token);
    if (price === undefined) return false;
    if (price === 0) return true;
    return (own || this._ownSet(state)).has(token) || this._premium(state);
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
    return { day, races: e ? n(e.races) : 0 };
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
    const base = retired ? RETIRE_COINS : RACE_COINS[place - 1];
    const earned = Math.round((base * DIFF_PCT[race.difficulty] * rate) / 10000);
    const next = coins + earned;
    const races = eco.races + 1;
    await $global.updateUserState($sender.account, {
      coins: next,
      race: null,
      eco: { ...eco, races },
      award: { id: race.id, coins: earned, doubled: false },
    });
    return { ok: true, raceId: race.id, coins: next, earned: { race: earned, total: earned }, races, rate };
  }

  // ── Spending ─────────────────────────────────────────────────────────────

  /** Unlocks one garage entry for coins. Already open (bought, free, or the pass) costs nothing. */
  async buyCosmetic(rawToken) {
    const s = await this._state();
    const coins = this._coins(s);
    const own = this._ownSet(s);
    const reply = (ok, reason, c) => ({ ok, reason, coins: c === undefined ? coins : c, own: [...own].join(',') });
    const token = cosToken(rawToken);
    if (!token) return reply(false, 'unknown');
    if (this._owns(s, token, own)) return reply(true, 'owned');
    const price = cosPrice(token);
    if (coins < price) return reply(false, 'short');
    own.add(token);
    await $global.updateUserState($sender.account, { coins: coins - price, own: [...own].join(',') });
    return reply(true, undefined, coins - price);
  }

  /** Unlocks one premium kart for good. Tickets and the pass keep working as before. */
  async buyKart(characterId) {
    const s = await this._state();
    const coins = this._coins(s);
    const own = this._ownSet(s);
    const reply = (ok, reason, c) => ({ ok, reason, coins: c === undefined ? coins : c, own: [...own].join(',') });
    if (!PREMIUM.has(characterId)) return reply(false, 'unknown');
    const token = 'k:' + characterId;
    if (this._premium(s) || own.has(token)) return reply(true, 'owned');
    if (coins < KART_PRICE) return reply(false, 'short');
    own.add(token);
    await $global.updateUserState($sender.account, { coins: coins - KART_PRICE, own: [...own].join(',') });
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
