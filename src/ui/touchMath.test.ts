import { describe, expect, it } from 'vitest';
import { stickToAxes } from './touchMath';

const R = 60;
const DZ = 0.12;

describe('stickToAxes', () => {
  it("12 o'clock = full throttle, no steer", () => {
    const a = stickToAxes(0, -R, R, DZ);
    expect(a.throttle).toBeCloseTo(1);
    expect(a.brake).toBe(0);
    expect(a.steer).toBeCloseTo(0);
  });
  it("6 o'clock = full brake", () => {
    const a = stickToAxes(0, R, R, DZ);
    expect(a.brake).toBeCloseTo(1);
    expect(a.throttle).toBe(0);
  });
  it("11 o'clock = throttle + steer left", () => {
    const a = stickToAxes(-R * 0.5, -R * 0.866, R, DZ);
    expect(a.throttle).toBeGreaterThan(0.8);
    expect(a.steer).toBeLessThan(-0.4);
    expect(a.brake).toBe(0);
  });
  it('inside deadzone = zero', () => {
    const a = stickToAxes(3, -3, R, DZ);
    expect(a).toEqual({ steer: 0, throttle: 0, brake: 0 });
  });
  it('beyond radius saturates', () => {
    const a = stickToAxes(-500, -500, R, DZ);
    expect(a.steer).toBeCloseTo(-Math.SQRT1_2, 1);
    expect(a.throttle).toBeCloseTo(Math.SQRT1_2, 1);
    expect(Math.hypot(a.steer, a.throttle)).toBeLessThanOrEqual(1.0001);
  });
});
