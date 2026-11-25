/**
 * Steering assist for touch play. A thumb on a glass stick has no feel for where the road edge
 * is, so phones were the hardest way to play the game. The assist looks a little way down the
 * road and leans the player's steering toward staying on it:
 *
 *   - hands off the stick: the kart follows the bend on its own, gently;
 *   - steering: the player's input is pulled part of the way toward the line, so a late or
 *     over-wide correction still makes the corner;
 *   - heading off the edge: steering further outward is damped.
 *
 * It never steers for the player while they drift (the drift is theirs), in the air, spinning,
 * nearly stopped, or facing the wrong way. Pure maths over the kart and track: no allocation per
 * call, no state, and nothing is stored on the kart.
 */
import * as THREE from 'three';
import { clamp } from '../../core/math';
import type { IKart, ITrack, TrackSample } from '../../core/types';

/** How far the assist pulls the player's steering toward the road, 0..1. */
export const TOUCH_ASSIST_STRENGTH = 0.45;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _target = new THREE.Vector3();
const sample = (): TrackSample => ({
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(0, 0, -1),
  normal: new THREE.Vector3(0, 1, 0),
  binormal: new THREE.Vector3(1, 0, 0),
  halfWidth: 6,
  wallHalfWidth: 8,
  t: 0,
});
const _s0 = sample();
const _s1 = sample();

/** Steering gain from the angle to the aim point (radians) to stick deflection. */
const GAIN = 2.2;

/** The steer to drive with: `user` (-1..1) leaned toward the road by `strength` (0..1). */
export function assistSteer(kart: IKart, track: ITrack, user: number, strength: number): number {
  const s = kart.state;
  if (strength <= 0 || s.isDrifting || s.isAirborne || s.isSpinning || s.wrongWay || s.speed < 4) return user;

  const len = Math.max(1, track.length);
  const lookahead = clamp(s.speed * 0.8, 8, 26);
  track.sample(s.trackT, _s0);
  const wrap = (x: number): number => x - Math.floor(x);
  track.sample(wrap(s.trackT + lookahead / len), _s1);

  kart.forwardDir(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) return user;
  _fwd.normalize();
  _right.set(-_fwd.z, 0, _fwd.x);

  // Where the kart is across the road now, and where to aim: the same side of the road, pulled
  // in from the edge, so the assist keeps the player's line instead of dragging them to the middle.
  const hw = Math.max(2, _s0.halfWidth);
  _rel.subVectors(s.position, _s0.position);
  const lat = _rel.dot(_s0.binormal);
  const aimLat = clamp(lat * 0.6, -(hw - 2), hw - 2);
  _target.copy(_s1.position).addScaledVector(_s1.binormal, aimLat);
  _rel.subVectors(_target, s.position);
  _rel.y = 0;
  const angle = Math.atan2(_rel.dot(_right), _rel.dot(_fwd));
  const line = clamp(GAIN * angle, -1, 1);

  let out: number;
  if (Math.abs(user) < 0.1) {
    // Hands off: follow the bend, but only partly — the kart should not drive itself.
    out = line * strength;
  } else {
    out = user + (line - user) * strength * 0.6;
  }
  // Near the edge and steering further out: take most of that away.
  const edge = Math.abs(lat) / hw;
  if (edge > 0.8 && Math.sign(out) === Math.sign(lat) && Math.sign(out) !== 0) {
    out *= clamp(1 - (edge - 0.8) * 4 * strength, 0.2, 1);
  }
  return clamp(out, -1, 1);
}
