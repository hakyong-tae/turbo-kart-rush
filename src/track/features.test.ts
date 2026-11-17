import { describe, expect, it } from 'vitest';
import type { MoverDef, TrackDefinition } from '../core/types';
import { sunnyCircuit } from './tracks/sunnyCircuit';
import { TrackFeatures, crosserCountdown, moverPose, rampProfile, ROLLER_FADE, type MoverPose } from './features';

/** A 1000 m lap: t maps straight to metres. */
const cl = { length: 1000, sOf: (t: number) => (((t % 1) + 1) % 1) * 1000 };
const def = (extra: Partial<TrackDefinition>): TrackDefinition => ({ ...sunnyCircuit, ...extra });
const pose = (): MoverPose => ({ s: 0, lateral: 0, vAlong: 0, vLateral: 0, active: false });

describe('ramps', () => {
  it('profile runs 0 → 1 and never goes backwards', () => {
    expect(rampProfile(0)).toBe(0);
    expect(rampProfile(1)).toBe(1);
    let last = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      const h = rampProfile(u);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
  });

  it('raises the ground only on the wedge', () => {
    const f = new TrackFeatures(def({ ramps: [{ t: 0.3, length: 10, height: 2 }] }), cl);
    expect(f.rampHeight(299, 0)).toBe(0);
    expect(f.rampHeight(305, 0)).toBeGreaterThan(0.5);
    expect(f.rampHeight(309.9, 0)).toBeCloseTo(2, 1);
    expect(f.rampHeight(310.5, 0)).toBe(0); // past the lip: the ground is gone from under you
    expect(f.rampHeight(305, 30)).toBeGreaterThan(0); // wall to wall by default
  });

  it('a narrow ramp has sides', () => {
    const f = new TrackFeatures(def({ ramps: [{ t: 0.3, height: 2, halfWidth: 3, lateral: 2 }] }), cl);
    expect(f.rampHeight(305, 2)).toBeGreaterThan(0);
    expect(f.rampHeight(305, -2)).toBe(0);
  });

  it('gap: the road is missing right after the lip and nowhere else', () => {
    const f = new TrackFeatures(def({ ramps: [{ t: 0.3, length: 10, height: 2, gap: 8 }] }), cl);
    expect(f.hasGap).toBe(true);
    expect(f.inGap(309)).toBe(false);
    expect(f.inGap(311)).toBe(true);
    expect(f.inGap(317.9)).toBe(true);
    expect(f.inGap(318.5)).toBe(false);
  });

  it('respawn: not in the run-up, on the ramp or over the gap', () => {
    const f = new TrackFeatures(def({ ramps: [{ t: 0.3, length: 10, height: 2, gap: 8 }] }), cl);
    expect(f.isRespawnSafe(200)).toBe(true);
    expect(f.isRespawnSafe(260)).toBe(false); // 40 m before the foot
    expect(f.isRespawnSafe(305)).toBe(false);
    expect(f.isRespawnSafe(315)).toBe(false);
    expect(f.isRespawnSafe(330)).toBe(true);
    // A plain ramp (no gap) never blocks a respawn.
    expect(new TrackFeatures(def({ ramps: [{ t: 0.3, height: 2 }] }), cl).isRespawnSafe(305)).toBe(true);
  });

  it('a ramp near the line wraps', () => {
    const f = new TrackFeatures(def({ ramps: [{ t: 0.995, length: 10, height: 2, gap: 6 }] }), cl);
    expect(f.rampHeight(998, 0)).toBeGreaterThan(0);
    expect(f.rampHeight(3, 0)).toBeGreaterThan(1);
    expect(f.inGap(8)).toBe(true);
    expect(f.isRespawnSafe(960)).toBe(false);
  });
});

describe('surface zones', () => {
  it('reports the kind inside the range and lateral band', () => {
    const f = new TrackFeatures(
      def({ zones: [{ from: 0.1, to: 0.15, kind: 'ice' }, { from: 0.5, to: 0.52, kind: 'mud', lateral: [0, 6] }] }),
      cl,
    );
    expect(f.zoneAt(120, 0)).toBe('ice');
    expect(f.zoneAt(160, 0)).toBeNull();
    expect(f.zoneAt(510, 3)).toBe('mud');
    expect(f.zoneAt(510, -3)).toBeNull();
  });

  it('empty when the definition has no gimmicks', () => {
    expect(new TrackFeatures(def({}), cl).empty).toBe(true);
  });
});

describe('moving obstacles', () => {
  const roller: MoverDef = { kind: 'roller', from: 0.5, to: 0.4, speed: 10, lateral: 2, sway: 1 };
  const tram: MoverDef = { kind: 'crosser', t: 0.25, period: 8, speed: 10, cars: 3, radius: 1.4 };

  it('is a pure function of the race clock', () => {
    const a = moverPose(roller, 0, 12.34, 1000, 500, 400, 0, pose());
    const b = moverPose(roller, 0, 12.34, 1000, 500, 400, 0, pose());
    expect(b).toEqual(a);
  });

  it('roller: travels from → to against the traffic and loops', () => {
    const p = moverPose(roller, 0, 3, 1000, 500, 400, 0, pose());
    expect(p.s).toBeCloseTo(470, 5);
    expect(p.vAlong).toBe(-10);
    expect(p.active).toBe(true);
    // One loop is 100 m / 10 m/s = 10 s.
    const again = moverPose(roller, 0, 13, 1000, 500, 400, 0, pose());
    expect(again.s).toBeCloseTo(p.s, 5);
    // Fading at the ends: cannot be hit as it appears or disappears.
    expect(moverPose(roller, 0, (ROLLER_FADE - 1) / 10, 1000, 500, 400, 0, pose()).active).toBe(false);
  });

  it('crosser: sweeps the road, then parks until the next period', () => {
    const reach = 14;
    const start = moverPose(tram, 0, 0, 1000, 250, 250, reach, pose());
    expect(start.active).toBe(true);
    expect(start.lateral).toBeCloseTo(-reach, 5);
    const mid = moverPose(tram, 0, 1.4, 1000, 250, 250, reach, pose());
    expect(mid.lateral).toBeCloseTo(0, 5);
    // The cars trail the lead car.
    expect(moverPose(tram, 1, 1.4, 1000, 250, 250, reach, pose()).lateral).toBeLessThan(mid.lateral);
    const parked = moverPose(tram, 0, 6, 1000, 250, 250, reach, pose());
    expect(parked.active).toBe(false);
    // Next period it comes back the other way.
    const back = moverPose(tram, 0, 8.5, 1000, 250, 250, reach, pose());
    expect(back.active).toBe(true);
    expect(back.vLateral).toBe(-10);
  });

  it('countdown reaches zero as the crossing starts', () => {
    if (tram.kind !== 'crosser') throw new Error('unreachable');
    expect(crosserCountdown(tram, 7, 14)).toBeCloseTo(1, 5);
    expect(crosserCountdown(tram, 8.1, 14)).toBe(0);
  });
});
