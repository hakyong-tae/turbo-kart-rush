import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from './ResolutionGovernor';

/** Feeds `seconds` of frames at `fps`; returns the last change reported, if any. */
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

  it('goes to the floor and then lean, and no lower', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    run(g, 20, 60);
    expect(g.state.scale).toBeCloseTo(0.5, 5);
    expect(g.state.lean).toBe(true);
  });

  it('comes back up only after a long calm spell', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    run(g, 30, 5);
    const low = g.state.scale;
    run(g, 60, 10);
    expect(g.state.scale).toBe(low);
    run(g, 60, 20);
    expect(g.state.scale).toBeGreaterThan(low);
  });

  it('stops trying to go up when going up brings the slowness back', () => {
    const g = new ResolutionGovernor({ minScale: 0.5 });
    run(g, 30, 3);
    run(g, 60, 26); // steps up
    const up = g.state.scale;
    run(g, 30, 3); // and is slow at once
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
