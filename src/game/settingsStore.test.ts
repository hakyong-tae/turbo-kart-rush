// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSeenControls, markControlsSeen } from './settingsStore';

describe('seen-controls flag', () => {
  beforeEach(() => localStorage.clear());

  it('is false until marked, then true', () => {
    expect(hasSeenControls()).toBe(false);
    markControlsSeen();
    expect(localStorage.getItem('tkr.seenControls')).toBe('1');
    expect(hasSeenControls()).toBe(true);
  });

  it('reads as seen when storage is unreadable, so the legend is skipped rather than repeated', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(hasSeenControls()).toBe(true);
    spy.mockRestore();
  });

  it('a write that fails is swallowed', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => markControlsSeen()).not.toThrow();
    spy.mockRestore();
  });
});
