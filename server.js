// Agent8 GameServer functions (Turbo Kart Rush).
//
// Root server.js is the platform's convention: a bare `class Server` — not exported —
// whose methods become remoteFunction endpoints, with $global and $sender injected.
// Plain JS, no build step: this file IS the deployment.
//
// Endpoints:
//   submitTime(trackId, timeMs, characterId, difficulty) — best per (account, track)
//   getTopTimes(trackId, limit)                          — top N + caller rank/best
//   getMyEntitlements()                                  — { adsRemoved, premiumRaces, nickname }
//   grantPremiumRaces()                                  — +3 (cap 9, 10 grants/day) after a rewarded ad
//   consumePremiumRace(characterId)                      — -1 when starting a race with a premium kart
//   setNickname(name)                                    — stored on user state, renames my rows
//   $onItemPurchased({productId})                        — VXShop "remove-ads" → adsRemoved
//
// All purchase / ticket state lives in $global user state (server-authoritative).

const RANKING_ID = 'tkr_times';
const TRACKS = new Set(['sunny_circuit', 'coral_coast', 'dune_drift', 'frostbite_falls', 'neon_nexus', 'magma_ridge']);
const CHARACTERS = new Set(['zippy', 'pixel', 'fennec', 'max', 'juno', 'kai', 'bram', 'rosa']);
const PREMIUM = new Set(['fennec', 'bram', 'rosa']);
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const MIN_TIME_MS = 30000;
const MAX_TIME_MS = 1200000;
const GRANT_SIZE = 3;
const GRANT_CAP = 9;
const GRANTS_PER_DAY = 10;

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

  _nickname(state) {
    const n = normalizeNickname(state && state.nickname);
    return n || defaultNickname($sender.account);
  }

  async _rankOf(trackId, timeMs) {
    const faster = await $global.countCollectionItems(RANKING_ID, {
      filters: [
        { field: 'trackId', operator: '==', value: trackId },
        { field: 'timeMs', operator: '<', value: timeMs },
      ],
    });
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
      createdAt: Date.now(),
    };
    const mine = await $global.getCollectionItems(RANKING_ID, {
      filters: [
        { field: 'account', operator: '==', value: $sender.account },
        { field: 'trackId', operator: '==', value: trackId },
      ],
    });
    const best = mine.length > 0 ? mine.slice().sort((a, b) => a.timeMs - b.timeMs)[0] : null;
    if (best && candidate.timeMs >= best.timeMs) {
      return { updated: false, rank: await this._rankOf(trackId, best.timeMs), timeMs: best.timeMs };
    }
    for (const row of mine) await $global.deleteCollectionItem(RANKING_ID, row.__id);
    await $global.addCollectionItem(RANKING_ID, candidate);
    return { updated: true, rank: await this._rankOf(trackId, candidate.timeMs), timeMs: candidate.timeMs };
  }

  async getTopTimes(trackId, limit) {
    if (!TRACKS.has(trackId)) throw new Error('Unknown track.');
    const n = typeof limit === 'number' && limit > 0 ? Math.min(100, Math.floor(limit)) : 20;
    const rows = await $global.getCollectionItems(RANKING_ID, {
      filters: [{ field: 'trackId', operator: '==', value: trackId }],
      orderBy: [{ field: 'timeMs', direction: 'asc' }],
      limit: n,
    });
    let myRank = null;
    let myBest = null;
    const mine = await $global.getCollectionItems(RANKING_ID, {
      filters: [
        { field: 'account', operator: '==', value: $sender.account },
        { field: 'trackId', operator: '==', value: trackId },
      ],
    });
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
    const mine = await $global.getCollectionItems(RANKING_ID, {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    for (const row of mine) await $global.updateCollectionItem(RANKING_ID, row.__id, { name: nickname });
    return { nickname };
  }

  async getMyEntitlements() {
    const s = await this._state();
    return {
      adsRemoved: !!s.adsRemoved,
      premiumRaces: Number.isFinite(s.premiumRaces) ? Math.max(0, Math.floor(s.premiumRaces)) : 0,
      nickname: normalizeNickname(s.nickname),
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
    if (!PREMIUM.has(characterId) || s.adsRemoved) return { ok: true, premiumRaces: current };
    if (current <= 0) return { ok: false, premiumRaces: 0 };
    await $global.updateUserState($sender.account, { premiumRaces: current - 1 });
    return { ok: true, premiumRaces: current - 1 };
  }

  /** VXShop hook. "remove-ads" (100 VX, non-consumable) unlocks every kart permanently. */
  async $onItemPurchased({ account, purchaseId, productId, quantity }) {
    if (productId === 'remove-ads') {
      await $global.updateUserState(account, { adsRemoved: true });
    }
    return { success: true };
  }
}
