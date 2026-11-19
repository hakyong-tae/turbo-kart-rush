import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Vite's ?raw import keeps this free of node typings.
import serverSource from '../../server.js?raw';

// server.js is a bare `class Server` (platform convention: no exports). Evaluate it with
// fake $global/$sender injected and grab the class from the end of the source.
function loadServer(global: unknown, sender: unknown, room: unknown = fakeRoom()): any {
  const factory = new Function('$global', '$sender', '$room', `${serverSource}\nreturn Server;`);
  const Server = factory(global, sender, room);
  return new Server();
}

function fakeRoom() {
  let state: Row = {};
  const broadcasts: { event: string; msg: unknown }[] = [];
  return {
    broadcasts,
    async getRoomState() {
      return { ...state };
    },
    async updateRoomState(patch: Row) {
      for (const k of Object.keys(patch)) {
        if (patch[k] === null) delete state[k];
        else state[k] = patch[k];
      }
    },
    broadcastToRoom(event: string, msg: unknown) {
      broadcasts.push({ event, msg });
    },
  };
}

type Row = Record<string, any>;

function fakeGlobal() {
  const collections: Record<string, Row[]> = {};
  const users: Record<string, Row> = {};
  let nextId = 1;
  const match = (item: Row, filters: Row[] = []) =>
    filters.every((f) => {
      const v = item[f.field];
      switch (f.operator) {
        case '==':
          return v === f.value;
        case '<':
          return v < f.value;
        case '>':
          return v > f.value;
        default:
          return true;
      }
    });
  return {
    collections,
    users,
    async getCollectionItems(id: string, q: Row = {}) {
      let rows = (collections[id] ?? []).filter((r) => match(r, q.filters));
      if (q.orderBy) {
        for (const o of [...q.orderBy].reverse()) {
          rows.sort((a, b) => (a[o.field] - b[o.field]) * (o.direction === 'desc' ? -1 : 1));
        }
      }
      if (q.limit) rows = rows.slice(0, q.limit);
      return rows;
    },
    async countCollectionItems(id: string, q: Row = {}) {
      return (collections[id] ?? []).filter((r) => match(r, q.filters)).length;
    },
    async addCollectionItem(id: string, data: Row) {
      const row = { ...data, __id: String(nextId++) };
      (collections[id] ??= []).push(row);
      return row;
    },
    // Platform signature: (collectionId, item) with item.__id. A 3-arg call must silently do nothing
    // (that is exactly how the real API behaves — see VERSE8-MULTIPLAYER.md §3).
    async updateCollectionItem(id: string, item: Row, extra?: unknown) {
      if (extra !== undefined || typeof item !== 'object' || item === null || !item.__id) return undefined;
      const row = (collections[id] ?? []).find((r) => r.__id === item.__id);
      if (row) Object.assign(row, item);
      return row;
    },
    async deleteCollectionItem(id: string, rowId: string) {
      collections[id] = (collections[id] ?? []).filter((r) => r.__id !== rowId);
    },
    async getUserState(account: string) {
      return users[account] ?? null;
    },
    async updateUserState(account: string, patch: Row) {
      users[account] = { ...(users[account] ?? {}), ...patch };
      return users[account];
    },
    joined: [] as string[],
    async joinRoom(key: string) {
      this.joined.push(key);
    },
    async leaveRoom() {
      return 'left';
    },
  };
}

describe('server.js', () => {
  let g: ReturnType<typeof fakeGlobal>;
  let me: any;
  beforeEach(() => {
    g = fakeGlobal();
    me = loadServer(g, { account: '0xAAAA1111' });
  });

  it('submitTime keeps one best per account/track and uses the stored nickname', async () => {
    await g.updateUserState('0xAAAA1111', { nickname: 'Kid' });
    const a = await me.submitTime('sunny_circuit', 95000, 'zippy', 'normal');
    expect(a.updated).toBe(true);
    expect(a.rank).toBe(1);
    const slower = await me.submitTime('sunny_circuit', 99000, 'zippy', 'normal');
    expect(slower.updated).toBe(false);
    const faster = await me.submitTime('sunny_circuit', 90000, 'rosa', 'hard');
    expect(faster.updated).toBe(true);
    expect(g.collections.tkr_times).toHaveLength(1);
    expect(g.collections.tkr_times[0]).toMatchObject({ name: 'Kid', timeMs: 90000, characterId: 'rosa' });
  });

  it('submitTime rejects bad input', async () => {
    await expect(me.submitTime('nope', 90000, 'zippy', 'normal')).rejects.toThrow();
    await expect(me.submitTime('sunny_circuit', 1000, 'zippy', 'normal')).rejects.toThrow();
    await expect(me.submitTime('sunny_circuit', 90000, 'mario', 'normal')).rejects.toThrow();
  });

  it('default nickname when none set', async () => {
    await me.submitTime('dune_drift', 100000, 'max', 'easy');
    expect(g.collections.tkr_times[0].name).toBe('RACER-1111');
  });

  it('getTopTimes ranks ascending and reports my rank', async () => {
    const other = loadServer(g, { account: '0xBBBB2222' });
    await other.submitTime('sunny_circuit', 80000, 'bram', 'hard');
    await me.submitTime('sunny_circuit', 90000, 'zippy', 'normal');
    const top = await me.getTopTimes('sunny_circuit', 10);
    expect(top.rows.map((r: Row) => r.timeMs)).toEqual([80000, 90000]);
    expect(top.myRank).toBe(2);
    expect(top.myBest).toBe(90000);
  });

  it('setNickname normalises, stores, and renames my rows', async () => {
    await me.submitTime('sunny_circuit', 90000, 'zippy', 'normal');
    const r = await me.setNickname('  Speed<>Demon  ');
    expect(r.nickname).toBe('SpeedDemon');
    expect(g.users['0xAAAA1111'].nickname).toBe('SpeedDemon');
    expect(g.collections.tkr_times[0].name).toBe('SpeedDemon');
    await expect(me.setNickname('!!!')).rejects.toThrow();
  });

  it('setCosmetics stores the look, stamps my rows, and rejects a hostile payload', async () => {
    // This account has the pass, so the paid entries in the look are its to keep.
    await g.updateUserState('0xAAAA1111', { premium: true });
    await me.submitTime('sunny_circuit', 90000, 'zippy', 'normal');
    const r = await me.setCosmetics('b:101218,p:f,t:3');
    expect(r.cos).toBe('b:101218,p:f,t:3');
    expect(g.users['0xAAAA1111'].cos).toBe('b:101218,p:f,t:3');
    expect(g.collections.tkr_times[0].cos).toBe('b:101218,p:f,t:3');
    // A time set afterwards carries the look, and the board hands it back.
    await me.submitTime('sunny_circuit', 80000, 'zippy', 'normal');
    expect((await me.getTopTimes('sunny_circuit', 5)).rows[0].cos).toBe('b:101218,p:f,t:3');
    await expect(me.setCosmetics('<script>')).rejects.toThrow();
    await expect(me.setCosmetics('x'.repeat(200))).rejects.toThrow();
  });

  it('setCupProgress merges, only ever improves, and ignores junk', async () => {
    expect((await me.setCupProgress({ rookie: 4 })).cups).toEqual({ rookie: 4 });
    expect((await me.setCupProgress({ pro: 2 })).cups).toEqual({ rookie: 4, pro: 2 });
    // A worse replay of a cup already won must not overwrite the better placing.
    expect((await me.setCupProgress({ rookie: 7 })).cups).toEqual({ rookie: 4, pro: 2 });
    expect((await me.setCupProgress({ rookie: 1 })).cups).toEqual({ rookie: 1, pro: 2 });
    expect((await me.setCupProgress({ nonsense: 1, championship: 0, pro: 99 })).cups).toEqual({ rookie: 1, pro: 2 });
    expect((await me.getMyEntitlements()).cups).toEqual({ rookie: 1, pro: 2 });
  });

  it('daily: one attempt per day, ranked on its own board, stale days pruned', async () => {
    const other = loadServer(g, { account: '0xBBBB2222' });
    await me.setNickname('Speedy');
    await me.setCosmetics('b:ff0000');
    const first = await me.submitDaily(95000, 'zippy');
    expect(first.accepted).toBe(true);
    expect(first.rank).toBe(1);
    // The attempt is spent: a second, faster run does not replace it.
    const again = await me.submitDaily(80000, 'zippy');
    expect(again.accepted).toBe(false);
    expect(again.timeMs).toBe(95000);
    await other.submitDaily(90000, 'max');
    const top = await me.getDailyTop(10);
    expect(top.rows.map((r: Row) => r.timeMs)).toEqual([90000, 95000]);
    expect(top.myRank).toBe(2);
    expect(top.used).toBe(true);
    expect(top.entries).toBe(2);
    // The board carries the look, like the records board.
    expect(top.rows[1].cos).toBe('b:ff0000');
    expect(top.rows[1].name).toBe('Speedy');
    // Rows from a week ago are dropped on the next submit rather than read forever.
    g.collections.tkr_daily.push({ __id: 'old', account: '0xCCCC', day: '2000-01-01', timeMs: 40000 });
    await loadServer(g, { account: '0xDDDD4444' }).submitDaily(99000, 'kai');
    expect(g.collections.tkr_daily.some((r: Row) => r.day === '2000-01-01')).toBe(false);
    await expect(me.submitDaily(95000, 'nobody')).rejects.toThrow();
    await expect(me.submitDaily(10, 'zippy')).rejects.toThrow();
  });

  it('entitlements: grant +3 (cap 9, 10/day), consume, purchase', async () => {
    expect(await me.getMyEntitlements()).toMatchObject({ premium: false, premiumRaces: 0, nickname: '', cos: '', cups: {}, coins: 0, own: '' });
    for (let i = 0; i < 3; i++) await me.grantPremiumRaces();
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9);
    expect((await me.consumePremiumRace('zippy')).ok).toBe(true); // non-premium: free
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9);
    expect(await me.consumePremiumRace('rosa')).toEqual({ ok: true, premiumRaces: 8 });
    for (let i = 0; i < 7; i++) await me.grantPremiumRaces();
    expect((await me.grantPremiumRaces()).granted).toBe(false); // 11th grant today
    await me.$onItemPurchased({ account: '0xAAAA1111', productId: 'premium-garage', purchaseId: 'p', quantity: 1 });
    expect((await me.getMyEntitlements()).premium).toBe(true);
    const c = await me.consumePremiumRace('rosa');
    expect(c.ok).toBe(true);
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9); // not consumed once purchased
  });

  it('consumePremiumRace refuses with no races', async () => {
    expect((await me.consumePremiumRace('bram')).ok).toBe(false);
  });

  /**
   * An account that climbed the first-session ladder long ago: no intro races, no first-day
   * missions, every rung reached. The economy and progression tests below describe that account;
   * a brand-new one has its own block ('first-session ladder').
   */
  const VETERAN = { lad: { all: true, day: '', r: 50, f: 50, p: 50, w: 50, d: 50 } };
  /** Garage entries the ladder hands out, which a veteran owns on top of whatever a test buys. */
  const RUNGS = new Set(['p:b', 'w:1', 't:2', 'u:1', 'f:1', 'g:1', 'p:u', 'u:5']);
  const bought = (own: string): string =>
    own
      .split(',')
      .filter((t) => t && !RUNGS.has(t))
      .join(',');
  /** A reply with the rungs taken out of its `own`, so a test can name exactly what it bought. */
  const plain = <T extends { own: string }>(r: T): T => ({ ...r, own: bought(r.own) });

  describe('economy', () => {
    const T0 = Date.parse('2026-11-18T10:00:00Z');
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      await g.updateUserState('0xAAAA1111', VETERAN);
    });
    afterEach(() => vi.useRealTimers());

    /** One honest race: opened, driven for `seconds` of real time, reported. */
    async function race(
      srv: any,
      place: number,
      opts: { difficulty?: string; retired?: boolean; seconds?: number; report?: Row; track?: string; kart?: string; mode?: string } = {},
    ) {
      const { raceId } = await srv.beginRace(opts.track ?? 'sunny_circuit', opts.kart ?? 'zippy', opts.difficulty ?? 'normal', opts.mode ?? 'solo');
      const seconds = opts.seconds ?? 90;
      vi.setSystemTime(Date.now() + (seconds + 8) * 1000);
      return srv.finishRace(raceId, { place, retired: !!opts.retired, timeMs: seconds * 1000, ...(opts.report ?? {}) });
    }

    it('pays by place and difficulty from its own table', async () => {
      expect((await race(me, 1)).earned.race).toBe(60);
      expect((await race(me, 8)).earned.race).toBe(10);
      expect((await race(me, 2, { difficulty: 'hard' })).earned.race).toBe(59); // 45 × 1.3 = 58.5
      expect((await race(me, 4, { difficulty: 'easy' })).earned.race).toBe(22); // 28 × 0.8 = 22.4
      // A retirement pays the retirement rate whatever place it was classified in.
      expect((await race(me, 3, { retired: true })).earned.race).toBe(5);
      const state = await me.getMyEntitlements();
      // Race coins only: missions and level-ups are counted in their own tests.
      expect(state.coins).toBeGreaterThanOrEqual(60 + 10 + 59 + 22 + 5);
      expect(state.eco).toEqual({ day: '2026-11-18', races: 5, doubles: 0, swaps: 0 });
    });

    it('a race is paid once, and only against the ticket that opened it', async () => {
      const { raceId } = await me.beginRace('sunny_circuit', 'zippy', 'normal', 'solo');
      vi.setSystemTime(Date.now() + 100000);
      expect((await me.finishRace('not-the-ticket', { place: 1, timeMs: 90000 })).reason).toBe('no-race');
      expect((await me.finishRace(raceId, { place: 1, timeMs: 90000 })).ok).toBe(true);
      expect(await me.finishRace(raceId, { place: 1, timeMs: 90000 })).toMatchObject({ ok: false, reason: 'no-race', coins: 60 });
      await expect(me.beginRace('nowhere', 'zippy', 'normal', 'solo')).rejects.toThrow();
      await expect(me.beginRace('sunny_circuit', 'zippy', 'impossible', 'solo')).rejects.toThrow();
    });

    it('refuses a finish the server clock says could not have happened', async () => {
      const { raceId } = await me.beginRace('sunny_circuit', 'zippy', 'hard', 'solo');
      // Ten seconds after the start, claiming a ninety second race.
      vi.setSystemTime(Date.now() + 10000);
      expect((await me.finishRace(raceId, { place: 1, timeMs: 90000 })).reason).toBe('too-fast');
      // Claiming a race too short to be one.
      expect((await me.finishRace(raceId, { place: 1, timeMs: 9000 })).reason).toBe('bad-time');
      expect((await me.finishRace(raceId, { place: 0, timeMs: 30000 })).reason).toBe('too-fast');
      expect((await me.getMyEntitlements()).coins).toBe(0);
      // The same ticket still pays once the time has really passed.
      vi.setSystemTime(Date.now() + 90000);
      expect((await me.finishRace(raceId, { place: 9, timeMs: 90000 })).reason).toBe('bad-place');
      expect((await me.finishRace(raceId, { place: 1, timeMs: 90000 })).earned.race).toBe(78);
    });

    it('ten races a day at full rate, then 30%, then nothing from the 61st; a new day starts over', async () => {
      const paid: number[] = [];
      for (let i = 0; i < 62; i++) paid.push((await race(me, 1, { seconds: 31 })).earned.race);
      expect(paid.slice(0, 10)).toEqual(new Array(10).fill(60));
      expect(paid.slice(10, 60)).toEqual(new Array(50).fill(18));
      expect(paid.slice(60)).toEqual([0, 0]);
      expect((await me.getMyEntitlements()).eco.races).toBe(62);
      vi.setSystemTime(Date.parse('2026-11-19T00:00:05Z'));
      expect((await me.getMyEntitlements()).eco).toEqual({ day: '2026-11-19', races: 0, doubles: 0, swaps: 0 });
      const next = await race(me, 1);
      expect(next).toMatchObject({ rate: 100, races: 1 });
      expect(next.earned.race).toBe(60);
    });

    it('buyCosmetic charges the table price once and reports why it would not', async () => {
      await g.updateUserState('0xAAAA1111', { coins: 1000 });
      expect(plain(await me.buyCosmetic('p:1'))).toEqual({ ok: true, reason: undefined, coins: 600, own: 'p:1' });
      // Already owned: answered as a success that costs nothing.
      expect(await me.buyCosmetic('p:1')).toMatchObject({ ok: true, reason: 'owned', coins: 600 });
      expect(await me.buyCosmetic('p:0')).toMatchObject({ ok: true, reason: 'owned', coins: 600 }); // free entry
      expect(await me.buyCosmetic('f:2')).toMatchObject({ ok: false, reason: 'short', coins: 600 });
      for (const junk of ['p:zz', 'q:1', 'k:rosa', '', null, 'p:1,p:2']) {
        expect((await me.buyCosmetic(junk)).reason).toBe('unknown');
      }
      expect(plain(await me.buyCosmetic('g:8'))).toMatchObject({ ok: true, coins: 300, own: 'p:1,g:8' });
      expect(bought((await me.getMyEntitlements()).own)).toBe('p:1,g:8');
    });

    it('the pass covers the paid tier: buying under it costs nothing', async () => {
      await g.updateUserState('0xAAAA1111', { coins: 5000, premium: true });
      expect(await me.buyCosmetic('p:w')).toMatchObject({ ok: true, reason: 'owned', coins: 5000 });
      expect(await me.buyKart('rosa')).toMatchObject({ ok: true, reason: 'owned', coins: 5000 });
    });

    it('buyKart: 2,500 coins, premium karts only, and the kart then needs no ticket', async () => {
      await g.updateUserState('0xAAAA1111', { coins: 2600 });
      expect((await me.buyKart('zippy')).reason).toBe('unknown');
      expect((await me.consumePremiumRace('rosa')).ok).toBe(false);
      expect(plain(await me.buyKart('rosa'))).toMatchObject({ ok: true, coins: 100, own: 'k:rosa' });
      expect(await me.consumePremiumRace('rosa')).toEqual({ ok: true, premiumRaces: 0 });
      expect((await me.consumePremiumRace('bram')).ok).toBe(false);
      expect((await me.buyKart('bram')).reason).toBe('short');
    });

    it('setCosmetics keeps what the account owns and drops the rest', async () => {
      await g.updateUserState('0xAAAA1111', { coins: 1000 });
      await me.buyCosmetic('t:3');
      // Colours and the bought trail stay; the unbought livery and its index-padded twin go.
      expect((await me.setCosmetics('b:101218,pc:ffffff,p:f,t:3,g:0')).cos).toBe('b:101218,pc:ffffff,t:3,g:0');
      expect((await me.setCosmetics('t:03,f:8')).cos).toBe('t:3');
      // Junk in the stored ownership string is not ownership.
      await g.updateUserState('0xAAAA1111', { own: 'p:f,<x>,k:zippy' });
      expect(bought((await me.getMyEntitlements()).own)).toBe('');
      await g.updateUserState('0xAAAA1111', { own: 'p:f,k:zippy,k:rosa,zz' });
      expect(bought((await me.getMyEntitlements()).own)).toBe('p:f,k:rosa');
      expect((await me.setCosmetics('p:f,f:8')).cos).toBe('p:f');
    });
  });

  describe('progression', () => {
    // 2026-11-18: the date seed picks `start`, `drift` and `hardPodium`.
    const T0 = Date.parse('2026-11-18T10:00:00Z');
    const DAY = 86400000;
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      await g.updateUserState('0xAAAA1111', VETERAN);
    });
    afterEach(() => vi.useRealTimers());

    async function race(srv: any, place: number, opts: { difficulty?: string; retired?: boolean; report?: Row; mode?: string } = {}) {
      const { raceId } = await srv.beginRace('sunny_circuit', 'zippy', opts.difficulty ?? 'normal', opts.mode ?? 'solo');
      vi.setSystemTime(Date.now() + 98000);
      return srv.finishRace(raceId, { place, retired: !!opts.retired, timeMs: 90000, ...(opts.report ?? {}) });
    }

    it('experience by place; a level gained pays 100 coins; level 5 awards its badge', async () => {
      const first = await race(me, 4);
      expect(first).toMatchObject({ xpEarned: 30, xp: 30, level: 1, levelUps: 0 });
      expect(first.earned).toMatchObject({ race: 28, levels: 0 });
      // 700 experience is level 5. Start just short of it.
      await g.updateUserState('0xAAAA1111', { xp: 690, coins: 0 });
      expect(bought((await me.getMyEntitlements()).own)).toBe('');
      const up = await race(me, 1);
      expect(up).toMatchObject({ xp: 750, level: 5, levelUps: 1, unlocked: ['g:9'] });
      expect(up.earned).toEqual({ race: 60, missions: 0, levels: 100, total: 160 });
      expect(up.coins).toBe(160);
      expect(bought(up.own)).toBe('g:9');
      // The badge is owned by level, not stored: it stays even though nothing was written to `own`.
      expect(g.users['0xAAAA1111'].own).toBeUndefined();
      expect((await me.setCosmetics('g:9,g:a')).cos).toBe('g:9');
      // Several levels in one race pay for each of them.
      await g.updateUserState('0xAAAA1111', { xp: 0, coins: 0 });
      await g.updateUserState('0xAAAA1111', { xp: 95 });
      const two = await race(me, 1, { retired: true });
      expect(two).toMatchObject({ xpEarned: 10, level: 2, levelUps: 1 });
      // A retirement earns the retirement experience, and the daily rate applies to it too.
      await g.updateUserState('0xAAAA1111', { eco: { day: '2026-11-18', races: 10 } });
      expect((await race(me, 1)).xpEarned).toBe(18);
    });

    it('the pass does not open earn-only entries; the coin shelf sells them, rewards are not for sale', async () => {
      await g.updateUserState('0xAAAA1111', { premium: true, coins: 3000 });
      expect((await me.setCosmetics('p:w,g:9,f:c')).cos).toBe('p:w');
      expect(await me.buyCosmetic('g:9')).toMatchObject({ ok: false, reason: 'earn', coins: 3000 });
      expect(plain(await me.buyCosmetic('f:c'))).toMatchObject({ ok: true, coins: 500, own: 'f:c' });
      expect((await me.setCosmetics('p:w,g:9,f:c')).cos).toBe('p:w,f:c');
    });

    it("today's missions come from the date, move with the race report and pay when reached", async () => {
      const view = (await me.getMyEntitlements()).missions;
      expect(view.list.map((m: Row) => m.key)).toEqual(['start', 'drift', 'hardPodium']);
      expect(view.list.map((m: Row) => [m.tier, m.target, m.coins, m.xp])).toEqual([[0, 2, 40, 20], [1, 10, 70, 35], [2, 1, 120, 60]]);
      expect(view).toMatchObject({ day: '2026-11-18', bonus: false, bonusCoins: 100, swapsLeft: 1 });

      // Counters are clamped: five start boosts in one race is one.
      const a = await race(me, 5, { report: { stats: { start: 5, drift: 6, items: 99 } } });
      expect(a.missions.list.map((m: Row) => m.progress)).toEqual([1, 6, 0]);
      expect(a.completed).toEqual([]);
      expect(a.earned.missions).toBe(0);

      const b = await race(me, 5, { report: { stats: { start: 1, drift: 3.9, hits: 'x' } } });
      expect(b.missions.list.map((m: Row) => m.done)).toEqual([true, false, false]);
      expect(b.completed).toEqual(['start']);
      expect(b.earned.missions).toBe(40);
      expect(b.xpEarned).toBe(30 + 20);

      // Top three on Hard finishes the hard one; drift reaches ten in the same race: all three, plus the bonus.
      const c = await race(me, 3, { difficulty: 'hard', report: { stats: { drift: 2 } } });
      expect(c.completed).toEqual(['drift', 'hardPodium']);
      expect(c.bonus).toBe(true);
      expect(c.earned.missions).toBe(70 + 120 + 100);
      expect(c.missions.bonus).toBe(true);
      // Nothing is paid twice.
      const d = await race(me, 1, { difficulty: 'hard', report: { stats: { drift: 50, start: 1 } } });
      expect(d.completed).toEqual([]);
      expect(d.bonus).toBe(false);
      expect(d.earned.missions).toBe(0);

      // A new UTC day is a new set with nothing on it.
      vi.setSystemTime(T0 + DAY);
      const next = (await me.getMyEntitlements()).missions;
      expect(next.day).toBe('2026-11-19');
      expect(next.list.map((m: Row) => m.key)).toEqual(['items', 'draft', 'team']);
      expect(next.list.every((m: Row) => m.progress === 0 && !m.done)).toBe(true);
      expect(next.bonus).toBe(false);
    });

    it('each mission counts only the races that meet it', () => {
      const race0 = { trackId: 'coral_coast', characterId: 'bram', difficulty: 'hard', mode: 'teamPoints' };
      const gain = (key: string, rep: Row, place = 2, retired = false, over: Row = {}) =>
        me._missionGain(key, { ...race0, ...over }, rep, place, retired);
      expect(gain('finish', {})).toBe(1);
      expect(gain('finish', {}, 8, true)).toBe(0);
      expect(gain('track:coral_coast', {})).toBe(1);
      expect(gain('track:dune_drift', {})).toBe(0);
      expect(gain('class:heavy', {})).toBe(1);
      expect(gain('class:light', {})).toBe(0);
      expect(gain('podium', {}, 3)).toBe(1);
      expect(gain('podium', {}, 4)).toBe(0);
      expect(gain('win', {}, 1)).toBe(1);
      expect(gain('win', {}, 2)).toBe(0);
      expect(gain('hardPodium', {}, 3)).toBe(1);
      expect(gain('hardPodium', {}, 3, false, { difficulty: 'normal' })).toBe(0);
      expect(gain('hardPodium', {}, 3, true)).toBe(0);
      // Clean: three wall hits are allowed, four are not, and an absent count is not a clean race.
      expect(gain('clean', { stats: { walls: 3 } })).toBe(1);
      expect(gain('clean', { stats: { walls: 4 } })).toBe(0);
      expect(gain('clean', {})).toBe(0);
      expect(gain('clean', { stats: { walls: 0 } }, 2, true)).toBe(0);
      expect(gain('daily', { daily: true })).toBe(1);
      expect(gain('daily', { daily: 'yes' })).toBe(0);
      expect(gain('team', { teamWon: true })).toBe(1);
      expect(gain('team', { teamWon: true }, 2, false, { mode: 'solo' })).toBe(0);
      expect(gain('team', {})).toBe(0);
      expect(gain('cup', { cupDone: true })).toBe(1);
      expect(gain('cup', { cupDone: true }, 2, true)).toBe(0);
      // Counters: summed, floored, clamped, and counted even in a race that was not finished.
      expect(gain('items', { stats: { items: 7.9 } })).toBe(7);
      expect(gain('items', { stats: { items: 500 } })).toBe(30);
      expect(gain('items', { stats: { items: -3 } })).toBe(0);
      expect(gain('hits', { stats: { hits: 2 } }, 8, true)).toBe(2);
      expect(gain('tricks', { stats: { tricks: 5 } })).toBe(5);
      expect(gain('draft', { stats: {} })).toBe(0);
    });

    it('swapMission trades one unfinished mission a day for the next of its tier', async () => {
      const swapped = await me.swapMission(0);
      expect(swapped.ok).toBe(true);
      // After `start` in the easy tier comes `track`, with the day's circuit.
      expect(swapped.missions.list[0].key).toMatch(/^track:[a-z_]+$/);
      expect(swapped.missions.list[0].progress).toBe(0);
      expect(swapped.missions.swapsLeft).toBe(0);
      expect(swapped.missions.list.slice(1).map((m: Row) => m.key)).toEqual(['drift', 'hardPodium']);
      expect((await me.swapMission(1)).reason).toBe('limit');
      expect((await me.swapMission(7)).reason).toBe('unknown');
      // The traded set is what the day's races now count against.
      expect((await me.getMyEntitlements()).missions.list[0].key).toBe(swapped.missions.list[0].key);
      vi.setSystemTime(T0 + DAY);
      await race(me, 1, { report: { stats: { items: 8 } } });
      expect((await me.swapMission(0)).reason).toBe('done');
      expect((await me.swapMission(1)).ok).toBe(true);
    });

    it('swapMission keeps the progress of the missions it did not touch', async () => {
      await race(me, 5, { report: { stats: { drift: 4 } } });
      const swapped = await me.swapMission(2);
      expect(swapped.missions.list.map((m: Row) => m.progress)).toEqual([0, 4, 0]);
      expect(swapped.missions.list[2].key).toBe('team');
    });

    it('doubleRaceCoins pays the last race again, once, five times a day', async () => {
      expect((await me.doubleRaceCoins('nothing-yet')).reason).toBe('no-race');
      const first = await race(me, 1);
      expect(first.doublesLeft).toBe(5);
      const before = (await me.getMyEntitlements()).coins;
      expect(await me.doubleRaceCoins(first.raceId)).toEqual({ ok: true, coins: before + 60, added: 60, doublesLeft: 4 });
      expect(await me.doubleRaceCoins(first.raceId)).toMatchObject({ ok: false, reason: 'done', added: 0 });
      expect((await me.doubleRaceCoins('some-other-race')).reason).toBe('no-race');
      for (let i = 0; i < 4; i++) expect((await me.doubleRaceCoins((await race(me, 8)).raceId)).ok).toBe(true);
      const sixth = await race(me, 1);
      expect(sixth.doublesLeft).toBe(0);
      expect(await me.doubleRaceCoins(sixth.raceId)).toMatchObject({ ok: false, reason: 'limit', doublesLeft: 0 });
      // Tomorrow the count starts over; a race that paid nothing has nothing to double.
      vi.setSystemTime(T0 + DAY);
      await g.updateUserState('0xAAAA1111', { eco: { day: '2026-11-19', races: 60 } });
      const dry = await race(me, 1);
      expect(dry.earned.race).toBe(0);
      expect(dry.doublesLeft).toBe(0);
      expect((await me.doubleRaceCoins(dry.raceId)).reason).toBe('nothing');
    });

    it('check-in: one a day, a seven-day cycle, a badge at seven days in total', async () => {
      expect((await me.getMyEntitlements()).streak).toEqual({ last: '', n: 0, total: 0, claimed: false, canRecover: false, next: 1 });
      const rewards: number[] = [];
      for (let d = 0; d < 8; d++) {
        vi.setSystemTime(T0 + d * DAY);
        const r = await me.claimAttendance();
        expect(r.ok, `day ${d + 1}`).toBe(true);
        expect(r.streak).toMatchObject({ n: d + 1, total: d + 1, claimed: true, next: d + 1 });
        // The second day in total hands over the day-two gift (a ladder rung), the seventh its badge.
        expect(r.unlocked).toEqual(d === 6 ? ['g:b'] : d === 1 ? ['u:5'] : []);
        rewards.push(r.reward);
        // A second claim the same day changes nothing.
        expect(await me.claimAttendance()).toMatchObject({ ok: false, reason: 'claimed', reward: 0 });
      }
      expect(rewards).toEqual([50, 60, 80, 100, 120, 150, 300, 50]);
      const state = await me.getMyEntitlements();
      expect(state.coins).toBe(910);
      expect(bought(state.own)).toBe('g:b');
      // The next morning the run is alive and waiting for day nine.
      vi.setSystemTime(T0 + 8 * DAY);
      expect((await me.getMyEntitlements()).streak).toMatchObject({ n: 8, claimed: false, canRecover: false, next: 9 });
    });

    it('check-in: one missed day is a choice, more than one starts over', async () => {
      await me.claimAttendance();
      vi.setSystemTime(T0 + DAY);
      await me.claimAttendance();
      // Day three is skipped. On day four the run is broken by exactly one day.
      vi.setSystemTime(T0 + 3 * DAY);
      expect((await me.getMyEntitlements()).streak).toMatchObject({ n: 2, claimed: false, canRecover: true, next: 1 });
      const asked = await me.claimAttendance();
      expect(asked).toMatchObject({ ok: false, reason: 'choose', reward: 0 });
      expect((await me.getMyEntitlements()).coins).toBe(110);
      // Recovering (after an ad) carries on to day three of the run.
      const kept = await me.claimAttendance(true);
      expect(kept).toMatchObject({ ok: true, reward: 80 });
      expect(kept.streak).toMatchObject({ n: 3, total: 3, claimed: true });

      // Another account declines: day one again, but the total still counts every day claimed.
      const other = loadServer(g, { account: '0xBBBB2222' });
      vi.setSystemTime(T0);
      await other.claimAttendance();
      vi.setSystemTime(T0 + 2 * DAY);
      const restarted = await other.claimAttendance(false);
      expect(restarted).toMatchObject({ ok: true, reward: 50 });
      expect(restarted.streak).toMatchObject({ n: 1, total: 2 });
      // Two missed days: no choice to make, and `recover` cannot conjure one.
      vi.setSystemTime(T0 + 5 * DAY);
      expect((await other.getMyEntitlements()).streak).toMatchObject({ canRecover: false, next: 1 });
      const late = await other.claimAttendance(true);
      expect(late).toMatchObject({ ok: true, reward: 50 });
      expect(late.streak).toMatchObject({ n: 1, total: 3 });
    });

    it('check-in rewards at 14 and 30 days in total arrive even when the run was broken', async () => {
      await g.updateUserState('0xAAAA1111', { streak: { last: '2026-11-01', n: 2, total: 13 } });
      const r = await me.claimAttendance();
      expect(r.streak).toMatchObject({ n: 1, total: 14 });
      expect(r.unlocked).toEqual(['f:a']);
      expect(bought(r.own).split(',').sort()).toEqual(['f:a', 'g:b']);
      await g.updateUserState('0xAAAA1111', { streak: { last: '2026-11-17', n: 9, total: 29 } });
      vi.setSystemTime(T0);
      // `last` is yesterday, so the run continues: day ten of the run, thirty in total.
      const thirty = await me.claimAttendance();
      expect(thirty.streak).toMatchObject({ n: 10, total: 30 });
      expect(thirty.reward).toBe(80);
      expect(thirty.unlocked).toEqual(['t:d']);
    });
  });

  describe('first-session ladder', () => {
    const T0 = Date.parse('2026-11-20T10:00:00Z');
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    async function race(srv: any, place: number, opts: { difficulty?: string; retired?: boolean; report?: Row; kind?: string } = {}) {
      const begun = await srv.beginRace('sunny_circuit', 'zippy', opts.difficulty ?? 'normal', 'solo', opts.kind);
      vi.setSystemTime(Date.now() + 98000);
      const award = await srv.finishRace(begun.raceId, { place, retired: !!opts.retired, timeMs: 90000, ...(opts.report ?? {}) });
      return { ...award, begun };
    }

    it('a new account starts with four circuits, an intro race ahead and the starter missions', async () => {
      const ent = await me.getMyEntitlements();
      expect(ent.ladder).toEqual({ all: false, races: 0, finishes: 0, podiums: 0, wins: 0, drifts: 0, tracks: 4, intro: true, firstDay: true });
      expect(ent.missions.list.map((m: Row) => m.key)).toEqual(['finish', 'items', 'drift']);
      expect(ent.own).toBe('');
      // The decision is written down the first time the account is read.
      expect(g.users['0xAAAA1111'].lad).toMatchObject({ all: false, day: '2026-11-20', r: 0 });
    });

    it('an account that played before the ladder keeps all sixteen circuits and its own missions', async () => {
      for (const seed of [{ coins: 120 }, { nickname: 'Old Hand' }, { cups: { rookie: 2 } }, { xp: 30 }]) {
        const old = fakeGlobal();
        await old.updateUserState('0xAAAA1111', seed);
        const srv = loadServer(old, { account: '0xAAAA1111' });
        const ent = await srv.getMyEntitlements();
        expect(ent.ladder, JSON.stringify(seed)).toMatchObject({ all: true, tracks: 16, intro: false, firstDay: false });
        expect(ent.missions.list.map((m: Row) => m.key)).not.toEqual(['finish', 'items', 'drift']);
        expect((await srv.beginRace('sunny_circuit', 'zippy', 'hard', 'solo')).intro).toBe(false);
      }
      // A time on the records board is the only trace some old accounts left.
      const board = fakeGlobal();
      await board.addCollectionItem('tkr_times', { account: '0xAAAA1111', trackId: 'sunny_circuit', timeMs: 90000 });
      const srv = loadServer(board, { account: '0xAAAA1111' });
      expect((await srv.getMyEntitlements()).ladder).toMatchObject({ all: true, tracks: 16 });
      // Someone else's time says nothing about this account.
      const other = loadServer(board, { account: '0xBBBB2222' });
      expect((await other.getMyEntitlements()).ladder).toMatchObject({ all: false, tracks: 4 });
    });

    it('a brand-new account whose first call is a race start is still new', async () => {
      expect((await me.beginRace('sunny_circuit', 'zippy', 'normal', 'solo')).intro).toBe(true);
      expect((await me.getMyEntitlements()).ladder).toMatchObject({ all: false, tracks: 4 });
    });

    it('each of the first three finishes opens a circuit and a garage entry', async () => {
      const first = await race(me, 5);
      expect(first.begun.intro).toBe(true);
      expect(first.unlocked).toEqual(['p:b']);
      expect(first.newTracks).toEqual(['dune_drift']);
      expect(first.ladder).toMatchObject({ races: 1, finishes: 1, tracks: 5, intro: true });
      const second = await race(me, 4);
      expect(second.unlocked).toEqual(['w:1']);
      expect(second.newTracks).toEqual(['frostbite_falls']);
      // Third: the trail for three finishes, and the underglow for the first podium.
      const third = await race(me, 3);
      expect(third.unlocked.sort()).toEqual(['t:2', 'u:1']);
      expect(third.newTracks).toEqual(['stunt_park']);
      expect(third.ladder).toMatchObject({ races: 3, finishes: 3, podiums: 1, tracks: 7, intro: false });
      expect(third.own.split(',').sort()).toEqual(['p:b', 't:2', 'u:1', 'w:1']);
      // What the ladder gave can be worn: the server keeps it in a saved look.
      expect((await me.setCosmetics('p:b,w:1,t:2,u:1,f:1')).cos).toBe('p:b,w:1,t:2,u:1');
      expect((await race(me, 6)).begun.intro).toBe(false);
    });

    it('an intro race is paid as normal whatever was picked; a cup or daily race is never an intro', async () => {
      expect((await race(me, 2, { difficulty: 'hard' })).earned.race).toBe(45);
      const cup = await race(me, 2, { difficulty: 'hard', kind: 'cup' });
      expect(cup.begun.intro).toBe(false);
      expect(cup.earned.race).toBe(59);
      // It still counts as one of the three.
      expect(cup.ladder).toMatchObject({ races: 2, intro: true });
    });

    it('a retirement counts as a race but opens nothing; a win and ten drift boosts each have their rung', async () => {
      const out = await race(me, 8, { retired: true });
      expect(out.unlocked).toEqual([]);
      expect(out.newTracks).toEqual([]);
      expect(out.ladder).toMatchObject({ races: 1, finishes: 0, tracks: 4 });
      const win = await race(me, 1, { report: { stats: { drift: 6 } } });
      expect(win.unlocked.sort()).toEqual(['p:b', 'p:u', 'u:1']);
      expect(win.ladder.drifts).toBe(6);
      const more = await race(me, 7, { report: { stats: { drift: 900 } } });
      // One race reports at most the cap, which is more than the rung needs.
      expect(more.ladder.drifts).toBe(66);
      expect(more.unlocked.sort()).toEqual(['f:1', 'w:1']);
    });

    it('the starter missions finish inside three races and pay like any others', async () => {
      const stats = { items: 3, drift: 4 };
      await race(me, 4, { report: { stats } });
      await race(me, 4, { report: { stats } });
      const third = await race(me, 4, { report: { stats } });
      expect(third.completed.sort()).toEqual(['drift', 'finish', 'items']);
      expect(third.bonus).toBe(true);
      expect(third.earned.missions).toBe(40 + 40 + 70 + 100);
      // The next day is an ordinary one: the date picks.
      vi.setSystemTime(T0 + 86400000);
      const next = (await me.getMyEntitlements()).missions.list.map((m: Row) => m.key);
      expect(next).not.toEqual(['finish', 'items', 'drift']);
      expect((await me.getMyEntitlements()).ladder.firstDay).toBe(false);
    });

    it('circuits stop opening at sixteen', async () => {
      let last: Row = {};
      for (let i = 0; i < 14; i++) last = await race(me, 6);
      expect(last.ladder.tracks).toBe(16);
      expect(last.newTracks).toEqual([]);
    });

    it('the second day checked in hands over the day-two gift; a pass holder is not told about what they have', async () => {
      await me.claimAttendance();
      vi.setSystemTime(T0 + 86400000);
      const two = await me.claimAttendance();
      expect(two).toMatchObject({ ok: true, reward: 60, unlocked: ['u:5'] });
      expect(two.own.split(',')).toContain('u:5');
      // The pass already covers every rung's entry.
      const passG = fakeGlobal();
      await passG.updateUserState('0xAAAA1111', { premium: true, lad: { all: false, day: '2026-11-21', r: 0, f: 0, p: 0, w: 0, d: 0 } });
      const pass = loadServer(passG, { account: '0xAAAA1111' });
      expect((await race(pass, 1)).unlocked).toEqual([]);
    });
  });

  describe('rooms', () => {
    it('createRoom yields a 4-char code and registers a listing; touchRoom upserts with 2-arg update', async () => {
      const room = fakeRoom();
      const srv = loadServer(g, { account: '0xH' }, room);
      const { roomId } = await srv.createRoom();
      expect(roomId).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
      expect(g.joined).toEqual([roomId]);
      expect(g.collections.tkr_rooms).toHaveLength(1);
      const firstId = g.collections.tkr_rooms[0].__id;
      await room.updateRoomState({ p_0xH: { nick: 'H' }, p_0xC: { nick: 'C' } });
      await srv.touchRoom(roomId, 'magma_ridge', true);
      expect(g.collections.tkr_rooms).toHaveLength(1); // updated in place, not duplicated
      expect(g.collections.tkr_rooms[0].__id).toBe(firstId);
      expect(g.collections.tkr_rooms[0]).toMatchObject({ key: roomId, count: 2, trackId: 'magma_ridge', started: true });
    });

    it('quick join picks an open, unstarted room; otherwise makes a new code', async () => {
      const srv = loadServer(g, { account: '0xA' });
      await g.addCollectionItem('tkr_rooms', { key: 'FULL', count: 8, started: false, at: Date.now() });
      await g.addCollectionItem('tkr_rooms', { key: 'GONE', count: 1, started: true, at: Date.now() });
      await g.addCollectionItem('tkr_rooms', { key: 'OPEN', count: 3, started: false, at: Date.now() });
      await g.addCollectionItem('tkr_rooms', { key: 'OLD1', count: 1, started: false, at: Date.now() - 200000 });
      expect((await srv.joinRoom(null)).roomId).toBe('OPEN');
      g.collections.tkr_rooms = g.collections.tkr_rooms.filter((r) => r.key !== 'OPEN');
      const fresh = (await srv.joinRoom(null)).roomId;
      expect(['FULL', 'GONE', 'OLD1']).not.toContain(fresh);
      expect(fresh).toHaveLength(4);
    });

    it('listRooms hides stale rooms and dedupes by key', async () => {
      const srv = loadServer(g, { account: '0xA' });
      await g.addCollectionItem('tkr_rooms', { key: 'AAAA', count: 1, started: false, at: Date.now() - 1000 });
      await g.addCollectionItem('tkr_rooms', { key: 'AAAA', count: 2, started: false, at: Date.now() });
      await g.addCollectionItem('tkr_rooms', { key: 'ZZZZ', count: 1, started: false, at: Date.now() - 500000 });
      const list = await srv.listRooms();
      expect(list).toEqual([{ key: 'AAAA', count: 2, trackId: '', started: false }]);
    });

    it('relay and relayHot broadcast on the relay channel with the sender', () => {
      const room = fakeRoom();
      const srv = loadServer(g, { account: '0xA' }, room);
      srv.relay('start', { a: 1 });
      srv.relayHot('snap', 'b64');
      expect(room.broadcasts).toEqual([
        { event: 'relay', msg: { event: 'start', payload: { a: 1 }, from: '0xA' } },
        { event: 'relay', msg: { event: 'snap', payload: 'b64', from: '0xA' } },
      ]);
    });
  });
});
