// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cupIsNews,
  dailyIsNews,
  ensureGarageBaseline,
  garageIsNews,
  garageTokenIsNew,
  hasUnseen,
  markDailySeen,
  markGarageSeen,
  markGarageTokenSeen,
} from './lobbyNews';

describe('lobby red dots', () => {
  beforeEach(() => localStorage.clear());

  it('finds an owned token the garage has not shown', () => {
    expect(hasUnseen(['p:b', 'w:1'], ['p:b'])).toBe(true);
    expect(hasUnseen(['p:b'], ['p:b', 'w:1'])).toBe(false);
    expect(hasUnseen([], [])).toBe(false);
  });

  it('clears the garage dot once the garage is opened, and brings it back for the next unlock', () => {
    expect(garageIsNews(['p:b'])).toBe(true);
    markGarageSeen(['p:b']);
    expect(garageIsNews(['p:b'])).toBe(false);
    expect(garageIsNews(['p:b', 't:2'])).toBe(true);
  });

  it('marks the daily challenge once a day', () => {
    expect(dailyIsNews('2026-11-25')).toBe(true);
    markDailySeen('2026-11-25');
    expect(dailyIsNews('2026-11-25')).toBe(false);
    expect(dailyIsNews('2026-11-26')).toBe(true);
  });

  it('dots the cup cell for an open cup never finished', () => {
    expect(cupIsNews('rookie', {})).toBe(true);
    expect(cupIsNews('rookie', { rookie: 5 })).toBe(false);
    expect(cupIsNews('pro', {})).toBe(false);
    expect(cupIsNews(null, {})).toBe(false);
  });

  it('dots each new garage entry until it is tapped, and the lobby until the last one is', () => {
    const owned = new Set(['p:b', 'w:1']);
    expect(garageTokenIsNew('p:b', owned)).toBe(true);
    expect(garageTokenIsNew('t:2', owned)).toBe(false);
    markGarageTokenSeen('p:b');
    expect(garageTokenIsNew('p:b', owned)).toBe(false);
    expect(garageIsNews(owned)).toBe(true);
    markGarageTokenSeen('w:1');
    expect(garageIsNews(owned)).toBe(false);
  });

  it("counts an older account's collection as seen the first time, and never again", () => {
    ensureGarageBaseline(['p:b', 'g:9'], true);
    expect(garageIsNews(['p:b', 'g:9'])).toBe(false);
    ensureGarageBaseline(['p:b', 'g:9', 'f:1'], true);
    expect(garageIsNews(['p:b', 'g:9', 'f:1'])).toBe(true);
  });

  it("leaves a new account's first unlocks as news", () => {
    ensureGarageBaseline(['p:b'], false);
    expect(garageIsNews(['p:b'])).toBe(true);
  });
});
