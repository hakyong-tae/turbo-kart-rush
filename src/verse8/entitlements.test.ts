// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetLocalServerForTests } from './localServer';
import {
  _resetForTests,
  applyEntitlements,
  beginRace,
  buyCosmetic,
  buyKart,
  canRace,
  finishRace,
  claimAttendance,
  getCoins,
  getCosmetics,
  getMissions,
  getOwned,
  getStreak,
  getXp,
  ownsKart,
  racesToday,
  refreshEntitlements,
  saveCosmetics,
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
  beforeEach(() => {
    _resetForTests();
    _resetLocalServerForTests();
  });

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

  it('grant adds 3 capped at 9; consume decrements only premium', async () => {
    await mockStore.grant();
    await mockStore.grant();
    await mockStore.grant();
    await mockStore.grant();
    expect(getEntitlements().premiumRaces).toBe(9);
    expect((await mockStore.consume('zippy')).ok).toBe(true);
    expect(getEntitlements().premiumRaces).toBe(9);
    expect(await mockStore.consume('bram')).toEqual({ ok: true, premiumRaces: 8 });
    expect(canRace('bram')).toBe(true);
  });

  it('consume refuses at zero', async () => {
    expect(await mockStore.consume('fennec')).toEqual({ ok: false, premiumRaces: 0 });
  });

  it('purchase unlocks everything without consuming', async () => {
    await mockStore.purchase();
    expect(canRace('fennec')).toBe(true);
    expect((await mockStore.consume('fennec')).ok).toBe(true);
    expect(getEntitlements().premiumRaces).toBe(0);
  });

  it('the local wallet is the real server: a race pays, a purchase spends, a reload keeps both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
      await refreshEntitlements();
      expect(getCoins()).toBe(0);
      // Nine wins on hard; the clock has to really pass for each. Missions and level-ups pay on
      // top of the race, so the wallet is checked against what the server said it paid.
      let paid = 0;
      for (let i = 0; i < 9; i++) {
        beginRace({ trackId: 'sunny_circuit', characterId: 'zippy', difficulty: 'hard' });
        // The start is fire-and-forget in the game; here the stamp has to land before the clock moves.
        await new Promise((r) => setTimeout(r, 5));
        vi.setSystemTime(Date.now() + 120000);
        const award = await finishRace({ place: 1, retired: false, timeMs: 90000 });
        expect(award?.ok).toBe(true);
        expect(award?.earned?.race).toBe(78);
        paid += award?.earned?.total ?? 0;
      }
      expect(paid).toBeGreaterThanOrEqual(702);
      expect(getCoins()).toBe(paid);
      expect(racesToday()).toBe(9);
      expect(getXp()).toBeGreaterThanOrEqual(540);
      expect(getMissions()?.list).toHaveLength(3);

      expect((await buyCosmetic('p:zz'))?.reason).toBe('unknown');
      const flame = await buyCosmetic('f:1'); // a flame is 700
      expect(flame?.ok).toBe(true);
      expect(getCoins()).toBe(paid - 700);
      expect(getOwned().has('f:1')).toBe(true);

      // The look can now keep the flame it bought, and nothing it did not.
      await saveCosmetics({ flame: 'jet', trail: 'ribbon', body: 0x112233 });
      expect(getCosmetics()).toEqual({ flame: 'jet', body: 0x112233 });

      // A fresh page: nothing in memory, everything still in storage.
      _resetForTests();
      expect(getCoins()).toBe(0);
      await refreshEntitlements();
      expect(getCoins()).toBe(paid - 700);
      expect(getOwned().has('f:1')).toBe(true);
      expect(getCosmetics()).toEqual({ flame: 'jet', body: 0x112233 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('check-in pays through the local server and the record follows', async () => {
    await refreshEntitlements();
    expect(getStreak()).toMatchObject({ claimed: false, n: 0, total: 0, next: 1 });
    const first = await claimAttendance();
    expect(first).toMatchObject({ ok: true, reward: 50 });
    expect(getCoins()).toBe(50);
    expect(getStreak()).toMatchObject({ claimed: true, n: 1, total: 1 });
    expect((await claimAttendance())?.reason).toBe('claimed');
    expect(getCoins()).toBe(50);
  });

  it('a kart bought with coins races without a ticket', async () => {
    localStorage.setItem('tkr.local.user', JSON.stringify({ coins: 2600 }));
    await refreshEntitlements();
    expect(canRace('rosa')).toBe(false);
    expect((await buyKart('zippy'))?.reason).toBe('unknown');
    expect((await buyKart('rosa'))?.ok).toBe(true);
    expect(getCoins()).toBe(100);
    expect(ownsKart('rosa')).toBe(true);
    expect(canRace('rosa')).toBe(true);
    expect(canRace('bram')).toBe(false);
    expect(await mockStore.consume('rosa')).toEqual({ ok: true, premiumRaces: 0 });
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
