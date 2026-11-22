import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from './ResolutionGovernor';

/**
 * A device whose frame rate depends on the resolution: `full` frames a second at scale 1, and
 * faster in proportion as pixels are taken away (never above 60). Runs it for `seconds`.
 */
function runDevice(g: ResolutionGovernor, full: number, seconds: number): void {
  let t = 0;
  while (t < seconds) {
    const s = g.state.scale;
    const fps = Math.min(60, (full / (s * s)) * (g.state.lean ? 1.25 : 1));
    g.sample(1 / fps);
    t += 1 / fps;
  }
}

/** Feeds `seconds` of frames at a fixed `fps` whatever the governor does; returns the last change. */
function run(g: ResolutionGovernor, fps: number, seconds: number) {
  let last = null;
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) last = g.sample(1 / fps) ?? last;
  return last;
}

describe('ResolutionGovernor', () => {
  it('leaves a fast device alone', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    expect(run(g, 60, 60)).toBeNull();
    expect(g.state).toEqual({ scale: 1, lean: false });
  });

  it('steps the resolution down after two slow seconds, not after one', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    expect(run(g, 30, 1.2)).toBeNull();
    expect(run(g, 30, 1.2)?.scale).toBeLessThan(1);
  });

  it('settles a device that fewer pixels do help, at a resolution that holds its frame rate', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    runDevice(g, 36, 40);
    const s = g.state.scale;
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.5);
    expect(36 / (s * s)).toBeGreaterThanOrEqual(48);
    expect(g.hasStoodDown).toBe(false);
  });

  it('goes to the floor and then lean on a device that is far too slow', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    runDevice(g, 9, 60);
    expect(g.state.scale).toBeCloseTo(0.5, 5);
    expect(g.state.lean).toBe(true);
    expect(g.overwhelmed).toBe(true);
  });

  it('is not overwhelmed by a device it managed to settle', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    runDevice(g, 36, 40);
    expect(g.overwhelmed).toBe(false);
  });

  it('gives the resolution back when lowering it buys nothing (a 30 fps cap)', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    run(g, 30, 30);
    expect(g.hasStoodDown).toBe(true);
    expect(g.overwhelmed).toBe(true);
    expect(g.state).toEqual({ scale: 1, lean: false });
    // And it stays out of the way afterwards.
    expect(run(g, 30, 60)).toBeNull();
  });

  it('comes back up only after a long calm spell', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    runDevice(g, 40, 6);
    const low = g.state.scale;
    expect(low).toBeLessThan(1);
    run(g, 60, 10);
    expect(g.state.scale).toBe(low);
    run(g, 60, 20);
    expect(g.state.scale).toBeGreaterThan(low);
  });

  it('stops trying to go up when going up brings the slowness back', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    runDevice(g, 40, 6);
    const low = g.state.scale;
    // Calm until it tries the step up...
    for (let i = 0; i < 60 * 40 && g.state.scale === low; i++) g.sample(1 / 60);
    const up = g.state.scale;
    expect(up).toBeGreaterThan(low);
    run(g, 40, 3); // ...which is slow at once
    expect(g.state.scale).toBeLessThan(up);
    const settled = g.state.scale;
    run(g, 60, 120);
    expect(g.state.scale).toBe(settled);
  });

  it('ignores the long frame of a tab coming back', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    for (let i = 0; i < 20; i++) expect(g.sample(2)).toBeNull();
    expect(g.state.scale).toBe(1);
  });
});
