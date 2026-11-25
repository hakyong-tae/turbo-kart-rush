// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, icon } from './icons';

describe('icons', () => {
  it('every name returns a 24-grid stroke svg that inherits colour', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(23);
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.classList.contains('icon')).toBe(true);
      expect(svg.childElementCount).toBeGreaterThan(0);
    }
  });

  it('covers the names the spec lists', () => {
    const need = [
      'trophy', 'wrench', 'gear', 'flag', 'calendar', 'users', 'lock', 'chevron-left', 'chevron-right',
      'spray', 'ad', 'cart', 'sound', 'mute', 'pause', 'play', 'rotate-phone', 'star', 'check', 'close',
      'coin', 'flame', 'target', 'stopwatch',
    ];
    for (const n of need) expect(ICON_NAMES).toContain(n);
  });

  it('throws on an unknown name', () => {
    // @ts-expect-error deliberately unknown
    expect(() => icon('nope')).toThrow(/unknown icon/i);
  });

  it('adds an extra class when asked', () => {
    expect(icon('star', 'on').classList.contains('on')).toBe(true);
  });
});
