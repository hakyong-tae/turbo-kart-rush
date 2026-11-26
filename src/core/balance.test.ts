import { describe, expect, it } from 'vitest';
import { BALANCE, applyBalanceOverrides, createDefaultBalance } from './balance';

describe('balance', () => {
  it('defaults match the shipped tuning', () => {
    // A smoke test that the table loads intact, not a design constraint: when a number here is
    // deliberately retuned, update it. greenSpeed moved 34 -> 40 with the top-speed change, so
    // that shells keep the same closing speed on the karts they chase.
    expect(BALANCE.kart.accelBase).toBe(9);
    expect(BALANCE.drift.boostDurations).toEqual([0, 0.7, 1.2, 1.8]);
    expect(BALANCE.items.greenSpeed).toBe(40);
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

describe('one-off race band', () => {
  const factor = (r: { base: number; amp: number; scale: number; min: number; max: number }, gap: number) =>
    Math.min(r.max, Math.max(r.min, r.base + r.amp * Math.tanh(gap / r.scale)));

  it('pulls harder both ways than the cup band of the same difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const pack = BALANCE.ai.packRubber[d];
      const cup = BALANCE.ai.profiles[d].rubber;
      // Player 150 m clear: the one-off field closes faster than the cup field.
      expect(factor(pack, 150), d).toBeGreaterThan(factor(cup, 150));
      // Player 150 m behind: the one-off field waits more.
      expect(factor(pack, -150), d).toBeLessThan(factor(cup, -150));
    }
  });

  it('lets normal and hard bots past their own top speed only to chase a player who is clear', () => {
    expect(factor(BALANCE.ai.packRubber.normal, 0)).toBeLessThan(1);
    expect(factor(BALANCE.ai.packRubber.normal, 200)).toBeGreaterThan(1);
    expect(factor(BALANCE.ai.packRubber.hard, 200)).toBeGreaterThan(1);
    // Easy never runs faster than its karts can.
    expect(factor(BALANCE.ai.packRubber.easy, 1000)).toBeLessThanOrEqual(1);
  });
});

describe('intro band', () => {
  const factor = (r: { base: number; amp: number; scale: number; min: number; max: number }, gap: number) =>
    Math.min(r.max, Math.max(r.min, r.base + r.amp * Math.tanh(gap / r.scale)));
  const r = BALANCE.ai.intro.rubber;

  it('waits for a new player who is behind', () => {
    expect(factor(r, -100)).toBeLessThan(0.7);
  });

  it('chases a new player who is clear, close to full speed', () => {
    expect(factor(r, 150)).toBeGreaterThan(0.95);
  });
});
