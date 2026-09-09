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
} from './entitlements';

describe('entitlements (mock store rules)', () => {
  beforeEach(() => _resetForTests());

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
    applyEntitlements({ premium: true, premiumRaces: 2, nickname: 'X', cos: '' });
    expect(seen).toBe(1);
    expect(getEntitlements()).toEqual({ premium: true, premiumRaces: 2, nickname: 'X', cos: '', loaded: true });
    off();
    applyEntitlements({ premium: false, premiumRaces: 0, nickname: '', cos: '' });
    expect(seen).toBe(1);
  });
});
