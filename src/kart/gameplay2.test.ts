// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BALANCE } from '../core/balance';
import { FIXED_DT } from '../core/constants';
import { events } from '../core/events';
import { createEmptyInput } from '../core/types';
import { FakeTrack } from '../net/FakeTrack';
import { Kart } from './Kart';
import { getCharacter } from './roster';

const fullThrottle = { ...createEmptyInput(), throttle: 1 };
const idle = createEmptyInput();

/** Two identical karts: leader on grid slot 0, follower `gap` metres straight behind it. */
function pair(track: FakeTrack, gap: number): { leader: Kart; follower: Kart; karts: Kart[] } {
  const max = getCharacter('max');
  const leader = new Kart(0, max, false);
  const follower = new Kart(1, max, true);
  const slot = track.startGrid[0];
  leader.resetTo(slot.position, slot.quaternion);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(slot.quaternion);
  follower.resetTo(slot.position.clone().addScaledVector(fwd, -gap), slot.quaternion);
  return { leader, follower, karts: [leader, follower] };
}

function run(karts: Kart[], track: FakeTrack, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    for (const k of karts) k.update(FIXED_DT, track, karts);
    each?.();
  }
}

describe('gameplay-2', () => {
  beforeEach(() => events.clear());

  it('slipstream: tucking behind a kart charges up, then grants the top-speed bonus', () => {
    const track = new FakeTrack();
    const { leader, follower, karts } = pair(track, 4);
    leader.setInput(fullThrottle);
    follower.setInput(fullThrottle);
    let drafted = false;
    let bonusSeen = false;
    const soloTop = leader.topSpeed();
    run(karts, track, 5, () => {
      if (follower.state.isDrafting) {
        drafted = true;
        if (follower.topSpeed() > soloTop * 1.05) bonusSeen = true;
      }
    });
    expect(drafted).toBe(true);
    expect(bonusSeen).toBe(true);
  });

  it('slipstream: a lone kart never drafts', () => {
    const track = new FakeTrack();
    const { follower, karts } = pair(track, 60);
    follower.setInput(fullThrottle);
    run(karts, track, 4);
    expect(follower.state.isDrafting).toBe(false);
    expect(follower.state.draftCharge).toBe(0);
  });

  it('magnet: latches onto the kart ahead, tows without throttle, then detaches with a burst', () => {
    const track = new FakeTrack();
    const { leader, follower, karts } = pair(track, 18);
    leader.setInput(fullThrottle);
    follower.setInput(idle);
    follower.applyMagnet(leader.state.id, 3);
    expect(follower.state.magnetTargetId).toBe(0);

    run(karts, track, 2.5);
    const d = follower.state.position.distanceTo(leader.state.position);
    expect(d).toBeLessThan(BALANCE.items.magnetAnchor + 1.5);
    expect(d).toBeGreaterThan(1.0);
    expect(follower.state.speed).toBeGreaterThan(3);

    run(karts, track, 0.8);
    expect(follower.state.magnetTargetId).toBe(-1);
    expect(follower.state.isBoosting).toBe(true);
  });

  it('magnet: even a faster kart is held behind its target', () => {
    const track = new FakeTrack();
    const { leader, follower, karts } = pair(track, 6);
    leader.setInput({ ...createEmptyInput(), throttle: 0.35 });
    follower.setInput(fullThrottle);
    follower.applyMagnet(leader.state.id, 4);
    run(karts, track, 3.5);
    // Still behind the leader along the leader's heading.
    const fwd = leader.forwardDir(new THREE.Vector3());
    const rel = follower.state.position.clone().sub(leader.state.position);
    expect(rel.dot(fwd)).toBeLessThan(0);
    expect(follower.state.magnetTargetId).toBe(0);
  });

  it('star: the invincible kart takes no knockback, the other kart takes all of it', () => {
    const track = new FakeTrack();
    const { leader: star, follower: victim, karts } = pair(track, 0);
    // Overlap the victim slightly to the star kart's right.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(track.startGrid[0].quaternion);
    victim.resetTo(star.state.position.clone().addScaledVector(right, 1.0), track.startGrid[0].quaternion);
    star.applyStar(5);
    const before = star.state.position.clone();
    const victimBefore = victim.state.position.clone();
    star.update(FIXED_DT, track, karts);
    expect(star.state.position.x).toBeCloseTo(before.x, 6);
    expect(star.state.position.z).toBeCloseTo(before.z, 6);
    expect(victim.state.position.distanceTo(victimBefore)).toBeGreaterThan(0.1);
  });
});
