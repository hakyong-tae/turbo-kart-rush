// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTests,
  applyEntitlements,
  canRace,
  getEntitlements,
  isPremium,
  mockStore,
  onEntitlementsChange,
  entitlementsPending,
  _mergeForTests,
} from './entitlements';

/** Pretends we are inside the Verse8 host iframe, where the server is the authority. */
function asEmbedded(fn: () => void): void {
  const real = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { value: {}, configurable: true });
  try {
    fn();
  } finally {
    if (real) Object.defineProperty(window, 'parent', real);
  }
}

describe('entitlements (mock store rules)', () => {
  beforeEach(() => _resetForTests());

  it('a reply about one field never claims the record has loaded', () => {
    // The bug this guards: `grantPremiumRaces` learns the new ticket count from its own reply and
    // used to fold it in with the full-record setter, which stamps `loaded: true`. A session whose
    // first fetch was lost therefore went on believing the player's nickname was genuinely empty —
    // blank in Settings, a bot handle in the race — instead of not yet known. QA hit it four
    // restarts in five.
    expect(getEntitlements().loaded).toBe(false);
    _mergeForTests({ premiumRaces: 3 });
    expect(getEntitlements().premiumRaces).toBe(3);
    expect(getEntitlements().loaded).toBe(false);
    applyEntitlements({ premium: false, premiumRaces: 3, nickname: 'Speedy', cos: '', cups: {} });
    expect(getEntitlements().loaded).toBe(true);
    expect(getEntitlements().nickname).toBe('Speedy');
  });

  it('a kart is not locked merely because the record has not arrived', () => {
    // QA: an account with tickets left showed the kart locked on the phone while the same account
    // could drive it on the desktop. The phone had simply not received the record yet, and
    // "not known" was being answered as "nothing". Starting a premium race spends a ticket through
    // the server, so being optimistic here costs nothing and cannot be exploited.
    asEmbedded(() => {
      expect(entitlementsPending()).toBe(true);
      expect(canRace('rosa')).toBe(true);

      // Once the record is in, an empty one really does mean locked.
      applyEntitlements({ premium: false, premiumRaces: 0, nickname: '', cos: '', cups: {} });
      expect(entitlementsPending()).toBe(false);
      expect(canRace('rosa')).toBe(false);

      applyEntitlements({ premium: false, premiumRaces: 2, nickname: '', cos: '', cups: {} });
      expect(canRace('rosa')).toBe(true);
    });
  });

  it('premium set is fennec/bram/rosa', () => {
    expect(['fennec', 'bram', 'rosa'].every(isPremium)).toBe(true);
    expect(['zippy', 'pixel', 'max', 'juno', 'kai'].some(isPremium)).toBe(false);
  });

  it('non-premium karts always race, premium needs tickets', () => {
    expect(canRace('zippy')).toBe(true);
    expect(canRace('rosa')).toBe(false);
  });

  it('grant adds 3 capped at 9; consume decrements only premium', () => {
    mockStore.grant();
    mockStore.grant();
    mockStore.grant();
    mockStore.grant();
    expect(getEntitlements().premiumRaces).toBe(9);
    expect(mockStore.consume('zippy').ok).toBe(true);
    expect(getEntitlements().premiumRaces).toBe(9);
    expect(mockStore.consume('bram')).toEqual({ ok: true, premiumRaces: 8 });
    expect(canRace('bram')).toBe(true);
  });

  it('consume refuses at zero', () => {
    expect(mockStore.consume('fennec')).toEqual({ ok: false, premiumRaces: 0 });
  });

  it('purchase unlocks everything without consuming', () => {
    mockStore.purchase();
    expect(canRace('fennec')).toBe(true);
    expect(mockStore.consume('fennec').ok).toBe(true);
    expect(getEntitlements().premiumRaces).toBe(0);
  });

  it('applyEntitlements notifies subscribers and marks loaded', () => {
    let seen = 0;
    const off = onEntitlementsChange(() => seen++);
    applyEntitlements({ premium: true, premiumRaces: 2, nickname: 'X', cos: '', cups: { rookie: 2 } });
    expect(seen).toBe(1);
    expect(getEntitlements()).toEqual({ premium: true, premiumRaces: 2, nickname: 'X', cos: '', cups: { rookie: 2 }, loaded: true });
    off();
    applyEntitlements({ premium: false, premiumRaces: 0, nickname: '', cos: '', cups: {} });
    expect(seen).toBe(1);
  });
});
