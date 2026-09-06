import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../kart/roster';
import { assignSlotCharacters, buildRoster, kartIdOf } from './roster';

const players = [
  { account: '0xB', nick: 'Bee', characterId: 'max', joinedAt: 200 },
  { account: '0xA', nick: 'Ay', characterId: 'zippy', joinedAt: 100 },
  { account: '0xH', nick: 'Host', characterId: 'rosa', joinedAt: 300 },
];

describe('roster', () => {
  it('host is kart 0, then joinedAt order', () => {
    const r = buildRoster(players, '0xH');
    expect(r.map((e) => e.account)).toEqual(['0xH', '0xA', '0xB']);
    expect(r.map((e) => e.kartId)).toEqual([0, 1, 2]);
    expect(kartIdOf(r, '0xB')).toBe(2);
    expect(kartIdOf(r, '0xZ')).toBeNull();
  });

  it('is deterministic regardless of input order', () => {
    const a = buildRoster(players, '0xH');
    const b = buildRoster(players.slice().reverse(), '0xH');
    expect(a).toEqual(b);
  });

  it('assigns remaining characters to AI slots without duplicating human picks', () => {
    const r = buildRoster(players, '0xH');
    const slots = assignSlotCharacters(r, CHARACTERS);
    expect(slots).toHaveLength(8);
    expect(slots[0].id).toBe('rosa');
    expect(slots[1].id).toBe('zippy');
    expect(slots[2].id).toBe('max');
    const aiIds = slots.slice(3).map((c) => c.id);
    expect(new Set(aiIds).size).toBe(5);
    for (const id of aiIds) expect(['rosa', 'zippy', 'max']).not.toContain(id);
  });

  it('caps humans at 8 and allows duplicate human picks', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ account: `0x${i}`, nick: `P${i}`, characterId: 'kai', joinedAt: i }));
    const r = buildRoster(many, '0x9');
    expect(r).toHaveLength(8);
    expect(r[0].account).toBe('0x9');
    const slots = assignSlotCharacters(r, CHARACTERS);
    expect(slots.every((c) => c.id === 'kai')).toBe(true);
  });
});

describe('pickNextHost', () => {
  it('picks the lowest remaining kart id, skipping accounts that are gone', async () => {
    const { pickNextHost } = await import('./roster');
    const r = buildRoster(players, '0xH'); // H:0, A:1, B:2
    expect(pickNextHost(r, new Set(['0xH']))?.account).toBe('0xA');
    expect(pickNextHost(r, new Set(['0xH', '0xA']))?.account).toBe('0xB');
    expect(pickNextHost(r, new Set(['0xH', '0xA', '0xB']))).toBeNull();
  });
});
