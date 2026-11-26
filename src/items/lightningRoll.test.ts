// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemManager } from './ItemManager';
import { BALANCE } from '../core/balance';

/** The roulette's draw, without a race around it. */
type Roller = { rollItem(place: number): string; time: number; lastLightningTime: number };

describe('lightning out of the boxes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is not rolled again for a while after one comes out, even while it is still held', () => {
    const im = new ItemManager(null) as unknown as Roller;
    // Eighth place, a draw that lands on lightning in the full table.
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    im.time = 100;
    expect(im.rollItem(8)).toBe('lightning');
    im.time = 100 + BALANCE.items.lightningRollCooldown - 1;
    expect(im.rollItem(8)).not.toBe('lightning');
    im.time = 100 + BALANCE.items.lightningRollCooldown + 1;
    expect(im.rollItem(8)).toBe('lightning');
  });

  it('keeps the longer wait after one has struck', () => {
    const im = new ItemManager(null) as unknown as Roller;
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    im.time = 100;
    im.lastLightningTime = 95;
    expect(im.rollItem(8)).not.toBe('lightning');
  });
});
