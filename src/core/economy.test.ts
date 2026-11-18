import { describe, expect, it } from 'vitest';
import { BADGES, ENGINE_PACKS, FLAMES, PATTERNS, TRAILS, UNDERGLOWS, WHEEL_FX, paidCosmetics } from './cosmetics';
import { COS_PRICES, FULL_RACES, RACE_CAP, formatCoins, priceOf, raceCoins, raceRate } from './economy';

describe('race coins', () => {
  it('pays the approved table on normal', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => raceCoins(p, false, 'normal', 0))).toEqual([60, 45, 35, 28, 22, 18, 14, 10]);
    expect(raceCoins(1, true, 'normal', 0)).toBe(5);
  });

  it('scales by difficulty and rounds once, in integers', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => raceCoins(p, false, 'easy', 0))).toEqual([48, 36, 28, 22, 18, 14, 11, 8]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((p) => raceCoins(p, false, 'hard', 0))).toEqual([78, 59, 46, 36, 29, 23, 18, 13]);
    expect(raceCoins(5, true, 'hard', 0)).toBe(7);
  });

  it('full rate for ten races, 30% to the cap, nothing after', () => {
    expect(raceRate(0)).toBe(100);
    expect(raceRate(FULL_RACES - 1)).toBe(100);
    expect(raceRate(FULL_RACES)).toBe(30);
    expect(raceRate(RACE_CAP - 1)).toBe(30);
    expect(raceRate(RACE_CAP)).toBe(0);
    expect(raceCoins(1, false, 'hard', FULL_RACES)).toBe(23);
    expect(raceCoins(1, false, 'hard', RACE_CAP)).toBe(0);
    expect(raceCoins(99, false, 'normal', 0)).toBe(0);
  });
});

describe('garage prices', () => {
  it('has one price per catalogue entry, free exactly where the catalogue says free', () => {
    const lists = { p: PATTERNS, u: UNDERGLOWS, t: TRAILS, f: FLAMES, w: WHEEL_FX, e: ENGINE_PACKS, g: BADGES };
    for (const [key, list] of Object.entries(lists)) {
      expect(COS_PRICES[key], key).toHaveLength(list.length);
      list.forEach((entry, i) => expect(COS_PRICES[key][i] === 0, `${key}:${i}`).toBe(entry.free));
    }
  });

  it('the 73 paid entries follow the approved price bands and total 42,200', () => {
    const paid = paidCosmetics();
    expect(paid).toHaveLength(73);
    const byId = (field: string, id: string): number | undefined => {
      const ref = paid.find((p) => p.field === field && p.id === id);
      return ref ? priceOf(ref.token) : undefined;
    };
    // Livery bands follow PATTERNS order: stripes, racing + geometric, organic, fades, special.
    expect(byId('pattern', 'stripe')).toBe(400);
    expect(byId('pattern', 'wideBand')).toBe(400);
    expect(byId('pattern', 'rally')).toBe(500);
    expect(byId('pattern', 'grid')).toBe(500);
    expect(byId('pattern', 'camo')).toBe(600);
    expect(byId('pattern', 'wave')).toBe(600);
    expect(byId('pattern', 'twoTone')).toBe(700);
    expect(byId('pattern', 'iridescent')).toBe(700);
    expect(byId('pattern', 'carbon')).toBe(1000);
    expect(byId('pattern', 'wireframe')).toBe(1000);
    expect(byId('badge', 'bolt')).toBe(300);
    expect(byId('wheelFx', 'spinBlur')).toBe(400);
    expect(byId('underglow', 'ripple')).toBe(500);
    expect(byId('trail', 'pixels')).toBe(600);
    expect(byId('flame', 'pulseJet')).toBe(700);
    expect(byId('enginePack', 'chiptune')).toBe(800);
    expect(paid.reduce((sum, p) => sum + (priceOf(p.token) ?? 0), 0)).toBe(42200);
  });

  it('priceOf answers undefined for what the table does not know', () => {
    expect(priceOf('p:0')).toBe(0);
    expect(priceOf('p:zz')).toBeUndefined();
    expect(priceOf('k:rosa')).toBeUndefined();
    expect(priceOf('nonsense')).toBeUndefined();
  });

  it('formats amounts with grouping', () => {
    expect(formatCoins(0)).toBe('0');
    expect(formatCoins(950)).toBe('950');
    expect(formatCoins(2500)).toBe('2,500');
    expect(formatCoins(1234567.9)).toBe('1,234,567');
  });
});
