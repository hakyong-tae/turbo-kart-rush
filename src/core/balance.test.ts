import { describe, expect, it } from 'vitest';
import { BALANCE, applyBalanceOverrides, createDefaultBalance } from './balance';

describe('balance', () => {
  it('defaults match the original tuning', () => {
    expect(BALANCE.kart.accelBase).toBe(9);
    expect(BALANCE.drift.boostDurations).toEqual([0, 0.7, 1.2, 1.8]);
    expect(BALANCE.items.greenSpeed).toBe(34);
    expect(BALANCE.itemTable[0].banana).toBe(35);
    expect(BALANCE.ai.profiles.hard.releaseStage).toBe(3);
    expect(BALANCE.race.retireSeconds).toBe(10);
  });

  it('applies numeric overrides from b.<path> params', () => {
    const b = createDefaultBalance();
    const warnings = applyBalanceOverrides(b, new URLSearchParams('b.kart.accelBase=11&b.ai.profiles.easy.noise=0.2'));
    expect(warnings).toEqual([]);
    expect(b.kart.accelBase).toBe(11);
    expect(b.ai.profiles.easy.noise).toBe(0.2);
  });

  it('ignores unknown paths, non-numeric targets and bad values, reporting each', () => {
    const b = createDefaultBalance();
    const warnings = applyBalanceOverrides(
      b,
      new URLSearchParams('b.kart.nope=1&b.ai.profiles.easy.usesMushrooms=1&b.kart.accelBase=abc&unrelated=5'),
    );
    expect(b.kart.accelBase).toBe(9);
    expect(b.ai.profiles.easy.usesMushrooms).toBe(false);
    expect(warnings).toHaveLength(3);
  });

  it('does not mutate the shared BALANCE when a copy is edited', () => {
    const b = createDefaultBalance();
    b.kart.accelBase = 99;
    expect(BALANCE.kart.accelBase).toBe(9);
  });
});
