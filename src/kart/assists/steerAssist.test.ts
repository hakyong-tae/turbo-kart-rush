import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assistSteer } from './steerAssist';
import type { IKart, ITrack, TrackSample } from '../../core/types';

const LENGTH = 1000;

/** A straight road 1 km long running toward -z, 12 m wide. Right of the road is +x. */
const track = {
  length: LENGTH,
  sample(t: number, out: TrackSample): TrackSample {
    out.position.set(0, 0, -t * LENGTH);
    out.tangent.set(0, 0, -1);
    out.normal.set(0, 1, 0);
    out.binormal.set(1, 0, 0);
    out.halfWidth = 6;
    out.t = t;
    return out;
  },
} as unknown as ITrack;

function kart(x: number, over: Record<string, unknown> = {}): IKart {
  const state = {
    position: new THREE.Vector3(x, 0, -100),
    trackT: 0.1,
    speed: 20,
    isDrifting: false,
    isAirborne: false,
    isSpinning: false,
    wrongWay: false,
    ...over,
  };
  return { state, forwardDir: (out: THREE.Vector3) => out.set(0, 0, -1) } as unknown as IKart;
}

describe('touch steering assist', () => {
  it('leaves a kart on its line alone', () => {
    expect(Math.abs(assistSteer(kart(0), track, 0, 0.45))).toBeLessThan(0.02);
  });

  it('eases a hands-off kart near the right edge back toward the road', () => {
    expect(assistSteer(kart(5), track, 0, 0.45)).toBeLessThan(0);
  });

  it('takes away most of a steer further off the edge', () => {
    const out = assistSteer(kart(5.5), track, 1, 0.45);
    expect(out).toBeLessThan(0.7);
  });

  it('keeps the player in charge: a steer stays a steer the same way', () => {
    expect(assistSteer(kart(0), track, -0.8, 0.45)).toBeLessThan(-0.4);
    expect(assistSteer(kart(0), track, 0.8, 0.45)).toBeGreaterThan(0.4);
  });

  it('does nothing while drifting, airborne, spinning, slow, or with no strength', () => {
    expect(assistSteer(kart(5, { isDrifting: true }), track, 0.3, 0.45)).toBe(0.3);
    expect(assistSteer(kart(5, { isAirborne: true }), track, 0.3, 0.45)).toBe(0.3);
    expect(assistSteer(kart(5, { isSpinning: true }), track, 0.3, 0.45)).toBe(0.3);
    expect(assistSteer(kart(5, { speed: 2 }), track, 0.3, 0.45)).toBe(0.3);
    expect(assistSteer(kart(5), track, 0.3, 0)).toBe(0.3);
  });
});
