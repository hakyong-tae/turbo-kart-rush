import { beforeEach, describe, expect, it } from 'vitest';
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

  it('entitlements: grant +3 (cap 9, 10/day), consume, purchase', async () => {
    expect(await me.getMyEntitlements()).toEqual({ premium: false, premiumRaces: 0, nickname: '', cos: '', cups: {} });
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
