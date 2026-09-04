// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { TouchInputSource } from '../core/types';
import { InputManager } from './InputManager';

function touch(over: Partial<TouchInputSource> = {}): TouchInputSource & { set(o: Partial<TouchInputSource>): void } {
  const s = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, pause: false, ...over };
  return Object.assign(s, {
    set(o: Partial<TouchInputSource>) {
      Object.assign(s, o);
    },
  });
}

describe('InputManager touch merge', () => {
  it('passes touch axes through when nothing else is held', () => {
    const im = new InputManager();
    im.attachTouch(touch({ steer: -0.6, throttle: 0.9, brake: 0, drift: true }));
    const s = im.update();
    expect(s.steer).toBeCloseTo(-0.6);
    expect(s.throttle).toBeCloseTo(0.9);
    expect(s.drift).toBe(true);
    im.dispose();
  });

  it('keyboard throttle wins over weaker touch throttle (max merge)', () => {
    const im = new InputManager();
    im.attachTouch(touch({ throttle: 0.5 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(im.update().throttle).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    im.dispose();
  });

  it('item held across two frames produces exactly one useItem edge', () => {
    const im = new InputManager();
    const t = touch();
    im.attachTouch(t);
    t.set({ item: true });
    expect(im.update().useItem).toBe(true);
    expect(im.update().useItem).toBe(false);
    expect(im.update().useItemHeld).toBe(true);
    t.set({ item: false });
    expect(im.update().useItemHeld).toBe(false);
    im.dispose();
  });

  it('pause held produces one edge', () => {
    const im = new InputManager();
    const t = touch({ pause: true });
    im.attachTouch(t);
    expect(im.update().pause).toBe(true);
    expect(im.update().pause).toBe(false);
    im.dispose();
  });

  it('detaching touch clears its contribution', () => {
    const im = new InputManager();
    im.attachTouch(touch({ throttle: 1 }));
    expect(im.update().throttle).toBe(1);
    im.attachTouch(null);
    expect(im.update().throttle).toBe(0);
    im.dispose();
  });
});
