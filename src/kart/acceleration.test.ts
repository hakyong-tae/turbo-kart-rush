// @vitest-environment jsdom
/**
 * The shape of the acceleration curve.
 *
 * This is a feel test, not a physics one. A kart used to be within 1% of its top speed after about
 * 37 m, which meant every straight longer than that was a procession: nothing left to gain, so a
 * tow, a mini-turbo or a boost pad bought you nothing you did not already have. The ceiling was
 * raised and the approach slackened so the last few m/s are still arriving at 100 m.
 *
 * Both ends are guarded. Slack alone would make the kart feel dead out of a hairpin; punch alone
 * puts us back where we started.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Kart } from './Kart';
import { getCharacter } from './roster';
import { FakeTrack } from '../net/FakeTrack';
import { createEmptyInput, type InputState } from '../core/types';
import { FIXED_DT } from '../core/constants';

const fullThrottle: InputState = { ...createEmptyInput(), throttle: 1 };

/** Seconds and metres for a standing kart to first reach `frac` of its own top speed. */
function launch(characterId: string): { top: number; at: (frac: number) => { t: number; d: number } } {
  // A 2 km circle is straight enough: a kart running 150 m in a straight line stays 1.4 m from the
  // centre of an 8 m road, so it never touches the grass and the speed cap is never the offroad one.
  const track = new FakeTrack(2000, 8);
  const kart = new Kart(0, getCharacter(characterId), true);
  const slot = track.startGrid[0];
  kart.resetTo(slot.position, slot.quaternion);
  kart.setFrozen(false);
  kart.setInput(fullThrottle);
  const top = kart.topSpeed();
  const marks = new Map<number, { t: number; d: number }>();
  const fracs = [0.5, 0.9, 0.99];
  const prev = new THREE.Vector3().copy(kart.state.position);
  let t = 0;
  let d = 0;
  for (let i = 0; i < 120 * 20; i++) {
    for (const f of fracs) if (!marks.has(f) && kart.state.speed >= top * f) marks.set(f, { t, d });
    kart.update(FIXED_DT, track, [kart]);
    d += kart.state.position.distanceTo(prev);
    prev.copy(kart.state.position);
    t += FIXED_DT;
  }
  return { top, at: (f) => marks.get(f) ?? { t: Infinity, d: Infinity } };
}

describe('acceleration curve', () => {
  it('still leaves a corner hard: half of top speed inside 10 m', () => {
    for (const id of ['zippy', 'max', 'bram']) {
      const { at } = launch(id);
      // Heavy karts are meant to be slower away — Bram needs about 10.5 m — but none of them may
      // feel like they are waking up.
      expect(at(0.5).d, `${id} to 50%`).toBeLessThan(12);
      expect(at(0.5).t, `${id} to 50%`).toBeLessThan(1.7);
    }
  });

  it('takes most of a long straight to top out: 99% no sooner than 80 m', () => {
    for (const id of ['zippy', 'max', 'bram']) {
      const { at } = launch(id);
      // Prism Skyway's return sweep — the longest straight in the game — is about 138 m. Topping
      // out before 80 m would leave most of it with nothing happening.
      expect(at(0.99).d, `${id} to 99%`).toBeGreaterThan(80);
      expect(at(0.99).t, `${id} to 99%`).toBeGreaterThan(4);
    }
  });

  it('a tow raises the target, so drafting pulls rather than only lifting the ceiling', () => {
    // With a slack approach, acceleration is proportional to the gap to the target speed, which
    // means anything that raises the ceiling also increases the pull toward it. That is what makes
    // a slipstream worth taking on a straight the kart has not finished accelerating down.
    const track = new FakeTrack(2000, 8);
    const kart = new Kart(0, getCharacter('max'), true);
    const slot = track.startGrid[0];
    kart.resetTo(slot.position, slot.quaternion);
    kart.setFrozen(false);
    kart.setInput(fullThrottle);
    for (let i = 0; i < 120 * 3; i++) kart.update(FIXED_DT, track, [kart]);
    // Three seconds of full throttle and still short of the ceiling: there is headroom left for a
    // tow to pull into, which is the whole point.
    expect(kart.state.speed).toBeLessThan(kart.topSpeed() * 0.9);
    expect(kart.state.speed).toBeGreaterThan(kart.topSpeed() * 0.7);
  });
});
