import { describe, expect, it } from 'vitest';
import { cosmeticOf, cosmeticToken, isUnlocked, kartToken, lockedParts, packCosmetics, parseOwned, sanitize, type KartCosmetics } from './cosmetics';

const LOOK: KartCosmetics = { body: 0x112233, pattern: 'stripe', patternColor: 0xffffff, trail: 'sparks', flame: 'jet', badge: 'crown' };

describe('per-item ownership', () => {
  it('tokens are the packed form of an entry', () => {
    expect(cosmeticToken('pattern', 'stripe')).toBe('p:1');
    expect(cosmeticToken('pattern', 'wireframe')).toBe('p:w');
    expect(cosmeticToken('trail', 'pixels')).toBe('t:a');
    expect(cosmeticToken('badge', 'nope')).toBeNull();
    expect(packCosmetics({ pattern: 'wireframe' })).toBe('p:w');
    expect(cosmeticOf('p:w')).toMatchObject({ field: 'pattern', id: 'wireframe', token: 'p:w' });
    expect(cosmeticOf('p:0w')?.token).toBe('p:w');
    expect(cosmeticOf('k:rosa')).toBeNull();
    expect(cosmeticOf('p:zz')).toBeNull();
    expect(kartToken('rosa')).toBe('k:rosa');
  });

  it('without an owned set, sanitize is the original two-tier gate', () => {
    expect(sanitize(LOOK, true)).toEqual(LOOK);
    expect(sanitize(LOOK, false)).toEqual({ body: 0x112233 });
  });

  it('with an owned set, a free player keeps exactly what they bought', () => {
    const owned = parseOwned('p:1,f:1');
    expect(sanitize(LOOK, false, owned)).toEqual({ body: 0x112233, pattern: 'stripe', patternColor: 0xffffff, flame: 'jet' });
    expect(sanitize(LOOK, false, new Set())).toEqual({ body: 0x112233 });
    // The pass still opens the whole paid tier.
    expect(sanitize(LOOK, true, new Set())).toEqual(LOOK);
  });

  it('lockedParts lists what a look wears that is not owned', () => {
    const owned = parseOwned('p:1,f:1');
    expect(lockedParts(LOOK, false, owned).map((p) => p.token)).toEqual(['t:2', 'g:2']);
    expect(lockedParts(LOOK, true, owned)).toEqual([]);
    expect(lockedParts({ body: 1 }, false, new Set())).toEqual([]);
    expect(isUnlocked('trail', 'sparks', false, owned)).toBe(false);
    expect(isUnlocked('trail', 'none', false, owned)).toBe(true);
    expect(isUnlocked('flame', 'jet', false, owned)).toBe(true);
  });

  it('parseOwned ignores anything that is not a token', () => {
    expect([...parseOwned('p:1,,<x>,k:rosa, t:2,P:1')]).toEqual(['p:1', 'k:rosa']);
    expect(parseOwned(undefined).size).toBe(0);
  });
});
