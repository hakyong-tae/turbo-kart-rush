import { beforeEach, describe, expect, it } from 'vitest';
// Vite's ?raw import keeps this free of node typings.
import serverSource from '../../server.js?raw';

// server.js is a bare `class Server` (platform convention: no exports). Evaluate it with
// fake $global/$sender injected and grab the class from the end of the source.
function loadServer(global: unknown, sender: unknown): any {
  const factory = new Function('$global', '$sender', `${serverSource}\nreturn Server;`);
  const Server = factory(global, sender);
  return new Server();
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
    async updateCollectionItem(id: string, rowId: string, data: Row) {
      const row = (collections[id] ?? []).find((r) => r.__id === rowId);
      if (row) Object.assign(row, data);
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

  it('entitlements: grant +3 (cap 9, 10/day), consume, purchase', async () => {
    expect(await me.getMyEntitlements()).toEqual({ adsRemoved: false, premiumRaces: 0, nickname: '' });
    for (let i = 0; i < 3; i++) await me.grantPremiumRaces();
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9);
    expect((await me.consumePremiumRace('zippy')).ok).toBe(true); // non-premium: free
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9);
    expect(await me.consumePremiumRace('rosa')).toEqual({ ok: true, premiumRaces: 8 });
    for (let i = 0; i < 7; i++) await me.grantPremiumRaces();
    expect((await me.grantPremiumRaces()).granted).toBe(false); // 11th grant today
    await me.$onItemPurchased({ account: '0xAAAA1111', productId: 'remove-ads', purchaseId: 'p', quantity: 1 });
    expect((await me.getMyEntitlements()).adsRemoved).toBe(true);
    const c = await me.consumePremiumRace('rosa');
    expect(c.ok).toBe(true);
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9); // not consumed once purchased
  });

  it('consumePremiumRace refuses with no races', async () => {
    expect((await me.consumePremiumRace('bram')).ok).toBe(false);
  });
});
