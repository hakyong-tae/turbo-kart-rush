// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RaceStanding } from '../core/types';
import { ResultsScreen } from './ResultsScreen';

// The fit pass picks the first layout that is not taller than the window. jsdom lays nothing out,
// so the panel's heights are played here from the layout it has been put in: how tall each layout
// "is" is a table, and the pass has to read it the way a browser would be read.
// (tools/results-fit-check.mjs does the real thing, in a browser, at the window sizes that matter.)
const standings: RaceStanding[] = [
  { kartId: 0, name: 'You', color: 0x33ccff, place: 1, finishTime: 100, isPlayer: true },
  { kartId: 1, name: 'Rival', color: 0xff3355, place: 2, finishTime: 101, isPlayer: false },
];
const paid = { state: 'paid' as const, coins: 60, balance: 60, nextUnlock: { text: 'Finish 3 races', value: 2, target: 3, reward: 'Sparks trail' } };

describe('results screen: folding to fit the window', () => {
  let screen: ResultsScreen;
  let panel: HTMLElement;
  /** Height of the panel's content in each layout, keyed `<dense><a if aside>`. */
  let heights: Record<string, number>;
  const WINDOW = 300;

  beforeEach(() => {
    document.body.replaceChildren();
    screen = new ResultsScreen(document.body);
    panel = document.querySelector('.results-panel') as HTMLElement;
    Object.defineProperty(panel, 'clientHeight', { get: () => WINDOW });
    Object.defineProperty(panel, 'scrollHeight', {
      get: () => heights[`${panel.dataset.dense ?? 0}${panel.hasAttribute('data-aside') ? 'a' : ''}`] ?? 9999,
    });
  });
  afterEach(() => screen.dispose());

  const layout = (): string => `${panel.dataset.dense ?? 0}${panel.hasAttribute('data-aside') ? 'a' : ''}`;
  const nextIsUnder = (): string => (document.querySelector('.results-next')?.parentElement?.className ?? '').split(' ')[0];
  const deal = (): void => {
    screen.show(standings);
    screen.showRewards(paid);
  };

  it('leaves a screen that fits alone', () => {
    heights = { '0': 280 };
    deal();
    expect(layout()).toBe('0');
    expect(nextIsUnder()).toBe('results-main');
  });

  it('first tries moving what comes next under the table, and takes it when that is enough', () => {
    heights = { '0': 340, '0a': 300 };
    deal();
    expect(layout()).toBe('0a');
    expect(nextIsUnder()).toBe('results-side');
    expect(document.querySelector('.results-tomorrow')?.parentElement?.className).toContain('results-side');
  });

  it('does not move them where that does not help, and folds the cards instead', () => {
    heights = { '0': 340, '0a': 360, '1': 298, '1a': 280 };
    deal();
    expect(layout()).toBe('1');
    expect(nextIsUnder()).toBe('results-main');
  });

  it('goes as far as it has to, in order', () => {
    heights = { '0': 400, '0a': 380, '1': 370, '1a': 350, '2': 330, '2a': 310, '3': 305, '3a': 299 };
    deal();
    expect(layout()).toBe('3a');
  });

  it('keeps the tightest layout when nothing fits', () => {
    heights = { '0': 400, '0a': 380, '1': 370, '1a': 350, '2': 330, '2a': 320, '3': 315, '3a': 318 };
    deal();
    expect(layout()).toBe('3');
  });

  it('starts over for the next race, and when the window changes', () => {
    heights = { '0': 340, '0a': 300 };
    deal();
    expect(layout()).toBe('0a');
    heights = { '0': 280 };
    deal();
    expect(layout()).toBe('0');
    expect(nextIsUnder()).toBe('results-main');
    heights = { '0': 340, '0a': 360, '1': 290 };
    window.dispatchEvent(new Event('resize'));
    expect(layout()).toBe('1');
  });

  it('does nothing while the screen is hidden', () => {
    heights = { '0': 340, '0a': 300 };
    deal();
    screen.hide();
    heights = { '0': 280 };
    window.dispatchEvent(new Event('resize'));
    expect(layout()).toBe('0a');
  });
});
