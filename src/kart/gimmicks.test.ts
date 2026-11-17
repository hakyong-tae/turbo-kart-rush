// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BALANCE } from '../core/balance';
import { FIXED_DT } from '../core/constants';
import { events } from '../core/events';
import { createEmptyInput, type SurfaceQuery, type SurfaceType, type TrackObstacle } from '../core/types';
import { FakeTrack } from '../net/FakeTrack';
import { Kart } from './Kart';
import { getCharacter } from './roster';

/**
 * FakeTrack with the gimmick hooks a real Track answers: a surface override for the whole road,
 * a ramp wedge over an arc of the lap, a gap after it, and obstacles.
 */
class GimmickTrack extends FakeTrack {
  /** A 600 m radius: near enough straight that a simple centring steer holds the road at any speed. */
  constructor() {
    super(600, 8);
  }
  surface: SurfaceType | null = null;
  /** Ramp from rampT, `rampLength` m long, `rampHeight` m high; then `gap` m of void. */
  rampT = -1;
  rampLength = 10;
  rampHeight = 0;
  gap = 0;
  obstacles: TrackObstacle[] = [];

  override query(position: THREE.Vector3, hintT?: number, out?: SurfaceQuery): SurfaceQuery {
    const q = super.query(position, hintT, out);
    if (this.surface && q.surface === 'road') q.surface = this.surface;
    if (this.rampT >= 0) {
      let s = (q.t - this.rampT) * this.length;
      if (s < 0) s += this.length;
      if (s < this.rampLength) q.groundY = (this.rampHeight * s) / this.rampLength;
      else if (s < this.rampLength + this.gap) q.surface = 'void';
    }
    return q;
  }
}

const throttle = { ...createEmptyInput(), throttle: 1 };

function kartOn(track: FakeTrack, id = 'max'): Kart {
  const kart = new Kart(0, getCharacter(id), true);
  const slot = track.startGrid[0];
  kart.resetTo(slot.position, slot.quaternion);
  return kart;
}

/** Steps the kart, steering it round the circular test track so it stays on the road. */
function drive(kart: Kart, track: FakeTrack, seconds: number, each?: (kart: Kart) => void): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const input = { ...kart.input };
    // + lateral = right of the centre line, + steer = turn right. Steer against the offset and,
    // more strongly, against the rate it is changing (offset alone just weaves across the road).
    const q = track.query(kart.state.position);
    const drift = kart.state.velocity.x * q.binormal.x + kart.state.velocity.z * q.binormal.z;
    input.steer = kart.state.surface === 'void' ? 0 : Math.max(-1, Math.min(1, -(q.lateral * 0.1 + drift * 0.35)));
    kart.setInput(input);
    kart.update(FIXED_DT, track, [kart]);
    each?.(kart);
  }
}

function lateralOf(kart: Kart, track: FakeTrack): number {
  return track.query(kart.state.position).lateral;
}

describe('track gimmicks: kart physics', () => {
  beforeEach(() => events.clear());

  it('mud caps the top speed, and a boost ignores it', () => {
    const road = new GimmickTrack();
    const a = kartOn(road);
    a.setInput(throttle);
    drive(a, road, 8);
    const mud = new GimmickTrack();
    mud.surface = 'mud';
    const b = kartOn(mud);
    b.setInput(throttle);
    drive(b, mud, 8);
    expect(b.state.surface).toBe('mud');
    expect(b.state.speed).toBeLessThan(a.state.speed * (BALANCE.track.mudFactor + 0.05));
    b.applyBoost(0.45, 2, 'nitro');
    drive(b, mud, 1.5);
    expect(b.state.speed).toBeGreaterThan(a.state.speed);
  });

  it('ice: a sideways shove takes far longer to scrub off than on road', () => {
    const slide = (surface: SurfaceType | null): number => {
      const track = new GimmickTrack();
      track.surface = surface;
      const kart = kartOn(track);
      kart.setInput(throttle);
      drive(kart, track, 3);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(kart.state.quaternion);
      kart.applyImpulse(right.clone().multiplyScalar(5));
      for (let i = 0; i < Math.round(0.3 / FIXED_DT); i++) kart.update(FIXED_DT, track, [kart]);
      // Sideways speed still left after 0.3 s.
      return Math.abs(kart.state.velocity.dot(right));
    };
    const onRoad = slide(null);
    const onIce = slide('ice');
    expect(onRoad).toBeLessThan(1);
    expect(onIce).toBeGreaterThan(onRoad * 2.5);
  });

  it('a long boost strip keeps the boost alive for as long as the kart is on it', () => {
    const track = new GimmickTrack();
    track.surface = 'boost';
    const kart = kartOn(track);
    kart.setInput(throttle);
    drive(kart, track, 1); // a freshly placed kart ignores pads for half a second
    let boosting = 0;
    let steps = 0;
    drive(kart, track, 4, (k) => {
      steps++;
      if (k.state.isBoosting) boosting++;
    });
    // One pad is 1.3 s of boost; on a strip it never lapses.
    expect(boosting / steps).toBeGreaterThan(0.95);
  });

  it('a ramp throws the kart into the air', () => {
    const track = new GimmickTrack();
    track.rampT = 0.012; // ~45 m past the line
    track.rampHeight = 2.5;
    const kart = kartOn(track);
    kart.setInput(throttle);
    let maxAir = 0;
    let maxY = 0;
    drive(kart, track, 6, (k) => {
      maxAir = Math.max(maxAir, k.state.airTime);
      maxY = Math.max(maxY, k.state.position.y);
    });
    expect(maxAir).toBeGreaterThan(0.35);
    expect(maxY).toBeGreaterThan(2.5);
    expect(kart.state.isAirborne).toBe(false); // and it came back down
  });

  it('trick: a drift tap in the air spins the kart and pays a boost on landing', () => {
    const track = new GimmickTrack();
    track.rampT = 0.012; // ~45 m past the line
    track.rampHeight = 2.5;
    const kart = kartOn(track);
    kart.setInput(throttle);
    const seen: boolean[] = [];
    events.on('kart:trick', (e) => seen.push(e.landed));
    const sources: string[] = [];
    events.on('kart:boost', (e) => sources.push(e.source));
    let tapped = false;
    drive(kart, track, 6, (k) => {
      if (!tapped && k.state.isAirborne && !k.state.isHopping && k.state.airTime > 0.2) {
        tapped = true;
        k.setInput({ ...k.input, drift: true });
      } else if (tapped && k.input.drift) {
        k.setInput({ ...k.input, drift: false });
      }
    });
    expect(tapped).toBe(true);
    expect(seen).toEqual([false, true]);
    expect(sources).toContain('trick');
  });

  it('a hop is not a jump: no trick from a hop', () => {
    const track = new GimmickTrack();
    const kart = kartOn(track);
    kart.setInput(throttle);
    drive(kart, track, 3);
    let tricks = 0;
    events.on('kart:trick', () => tricks++);
    kart.setInput({ ...kart.input, drift: true });
    drive(kart, track, 0.05);
    kart.setInput({ ...kart.input, drift: false });
    drive(kart, track, 0.05);
    kart.setInput({ ...kart.input, drift: true });
    drive(kart, track, 0.3);
    expect(tricks).toBe(0);
  });

  it('gap: a kart that drops below the road keeps falling instead of being lifted onto the far lip', () => {
    const track = new GimmickTrack();
    track.rampT = 0.012; // ~45 m past the line
    track.rampHeight = 0.01; // no launch to speak of
    track.gap = 30;
    const kart = kartOn(track);
    kart.setInput({ ...throttle, throttle: 0.45 });
    let minY = 0;
    drive(kart, track, 14, (k) => {
      minY = Math.min(minY, k.state.position.y);
    });
    expect(minY).toBeLessThan(-10);
    expect(kart.state.surface).toBe('void');
  });

  it('a moving obstacle marked `hit` spins the kart; a plain one only bounces it', () => {
    const run = (hit: boolean): boolean => {
      const track = new GimmickTrack();
      const kart = kartOn(track);
      kart.setInput(throttle);
      drive(kart, track, 2);
      const fwd = kart.forwardDir();
      track.obstacles = [
        { position: kart.state.position.clone().addScaledVector(fwd, 6), radius: 1.5, height: 3, velocity: new THREE.Vector3(), hit },
      ];
      let spun = false;
      for (let i = 0; i < Math.round(1 / FIXED_DT); i++) {
        kart.update(FIXED_DT, track, [kart]);
        if (kart.state.isSpinning) spun = true;
      }
      return spun;
    };
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false);
  });
});
