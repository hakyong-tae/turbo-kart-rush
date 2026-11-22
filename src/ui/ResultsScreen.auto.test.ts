// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputState, RaceStanding } from '../core/types';
import { createEmptyInput } from '../core/types';
import { AUTO_NEXT_SECONDS, ResultsScreen } from './ResultsScreen';

const standings: RaceStanding[] = [
  { kartId: 0, name: 'You', color: 0x33ccff, place: 1, finishTime: 100, isPlayer: true },
  { kartId: 1, name: 'Rival', color: 0xff3355, place: 2, finishTime: 101, isPlayer: false },
];
const paid = { state: 'paid' as const, coins: 60, balance: 60 };
const press = (keys: Partial<InputState>): InputState => ({ ...createEmptyInput(), ...keys });
const SETTLE = 2;

describe('results screen: going on to the next race by itself', () => {
  let screen: ResultsScreen;
  let next: ReturnType<typeof vi.fn>;
  let again: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    screen = new ResultsScreen(document.body);
    next = vi.fn();
    again = vi.fn();
    screen.onNextRace = next;
    screen.onRaceAgain = again;
  });
  afterEach(() => {
    screen.dispose();
    vi.useRealTimers();
  });

  const primary = (): HTMLElement => document.querySelector('.results-next-btn') as HTMLElement;
  const seconds = (s: number): void => void vi.advanceTimersByTime(s * 1000);

  it('does nothing unless the game arms it', () => {
    screen.show(standings);
    screen.showRewards(paid);
    seconds(60);
    expect(next).not.toHaveBeenCalled();
  });

  it('fills the primary button, shows the seconds left, then starts the next race once', () => {
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    seconds(SETTLE - 0.2);
    expect(screen.autoNextLeft).toBeNull();
    seconds(0.5);
    expect(primary().classList.contains('auto')).toBe(true);
    expect(primary().querySelector('.auto-count')?.textContent).toBe(String(AUTO_NEXT_SECONDS));
    seconds(AUTO_NEXT_SECONDS / 2);
    expect(Number(primary().style.getPropertyValue('--auto'))).toBeGreaterThan(0.4);
    expect(next).not.toHaveBeenCalled();
    seconds(AUTO_NEXT_SECONDS / 2 + 0.5);
    expect(next).toHaveBeenCalledTimes(1);
    seconds(30);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('waits while the reward is still being counted, and starts over when it lands', () => {
    screen.show(standings);
    screen.showRewards({ state: 'pending' });
    screen.armAutoNext();
    seconds(30);
    expect(screen.autoNextLeft).toBeNull();
    expect(next).not.toHaveBeenCalled();
    screen.showRewards(paid);
    seconds(1);
    expect(screen.autoNextLeft).toBeNull();
    seconds(1 + AUTO_NEXT_SECONDS + 0.5);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('gives unlock cards time to be read before counting', () => {
    screen.show(standings);
    screen.showRewards({ ...paid, opened: [{ kind: 'track', name: 'Dune Drift' }, { kind: 'item', name: 'Checker livery' }] });
    screen.armAutoNext();
    seconds(3);
    expect(screen.autoNextLeft).toBeNull();
    seconds(1.5 + AUTO_NEXT_SECONDS);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('is called off for good by moving the keyboard cursor', () => {
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    seconds(SETTLE + 3);
    screen.handleInput(press({ menuRight: true }));
    expect(primary().classList.contains('auto')).toBe(false);
    expect(primary().querySelector('.auto-count')).toBeNull();
    seconds(60);
    expect(next).not.toHaveBeenCalled();
  });

  it('is called off by a press anywhere but the primary button, not by a press on it', () => {
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    seconds(SETTLE + 1);
    primary().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(screen.autoNextLeft).not.toBeNull();
    document.querySelector('.standings')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(screen.autoNextLeft).toBeNull();
    seconds(60);
    expect(next).not.toHaveBeenCalled();
  });

  it('is called off by another button, which does its own job', () => {
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    seconds(SETTLE + 1);
    (document.querySelector('.results-again') as HTMLElement).click();
    expect(again).toHaveBeenCalledTimes(1);
    seconds(60);
    expect(next).not.toHaveBeenCalled();
  });

  it('is called off when the window loses focus', () => {
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    seconds(SETTLE + 1);
    window.dispatchEvent(new Event('blur'));
    seconds(60);
    expect(next).not.toHaveBeenCalled();
  });

  it('pressing the primary button goes at once, and only once', () => {
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    seconds(SETTLE + 1);
    primary().click();
    expect(next).toHaveBeenCalledTimes(1);
    seconds(60);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never runs on an online results screen, and a new race starts with it off', () => {
    screen.show(standings, 'solo', true);
    screen.armAutoNext();
    seconds(60);
    expect(next).not.toHaveBeenCalled();
    screen.show(standings);
    screen.showRewards(paid);
    screen.armAutoNext();
    screen.show(standings);
    screen.showRewards(paid);
    seconds(60);
    expect(next).not.toHaveBeenCalled();
  });
});
