/**
 * Magnet item — while latched the kart is towed to a point just behind its target: heading
 * and speed follow the target, so even a faster kart cannot pull past. Detaching (timer,
 * target gone, spin) gives a short burst. Owned by Kart; allocation-free per frame.
 */
import { BALANCE as B } from '../../core/balance';
import { events } from '../../core/events';
import { angleDelta, damp, wrapAngle } from '../../core/math';
import type { BoostSource, IKart, KartState } from '../../core/types';

export interface MagnetHost {
  readonly state: KartState;
  baseTopSpeed(): number;
  applyBoost(strength: number, duration: number, source: BoostSource): void;
  /** Ends an active drift without a boost (the tow takes over steering). */
  cancelDrift(): void;
  /** Lateral (sideways) velocity accessor so the tow can bleed it off. */
  getLateralVel(): number;
  setLateralVel(v: number): void;
}

export function startMagnet(host: MagnetHost, targetId: number, duration: number): void {
  const s = host.state;
  if (duration <= 0 || targetId === s.id) return;
  s.magnetTargetId = targetId;
  s.magnetTimer = duration;
  if (s.isDrifting) host.cancelDrift();
  events.emit('kart:magnetStart', { kartId: s.id, targetId });
}

/** Returns true while the magnet overrides normal driving for this frame. */
export function updateMagnet(host: MagnetHost, others: readonly IKart[], dt: number): boolean {
  const s = host.state;
  if (s.magnetTargetId < 0) return false;
  s.magnetTimer -= dt;
  let target: IKart | null = null;
  for (let i = 0; i < others.length; i++) {
    if (others[i].state.id === s.magnetTargetId) {
      target = others[i];
      break;
    }
  }
  if (s.magnetTimer <= 0 || !target || target.state.isFrozen || target.state.finished || s.isSpinning) {
    s.magnetTargetId = -1;
    s.magnetTimer = 0;
    if (!s.isSpinning) host.applyBoost(B.items.magnetBoostStrength, B.items.magnetBoostDuration, 'magnet');
    events.emit('kart:magnetEnd', { kartId: s.id });
    return false;
  }
  const t = target.state;
  // Anchor a fixed distance behind the target, along ITS heading.
  const tfx = -Math.sin(t.heading);
  const tfz = -Math.cos(t.heading);
  const ax = t.position.x - tfx * B.items.magnetAnchor;
  const az = t.position.z - tfz * B.items.magnetAnchor;
  const dx = ax - s.position.x;
  const dz = az - s.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  // Steer toward the anchor when it is far, toward the target's heading when tucked in.
  const wantHeading = dist > 0.6 ? Math.atan2(-dx, -dz) : t.heading;
  s.heading = wrapAngle(s.heading + angleDelta(s.heading, wantHeading) * Math.min(1, 9 * dt));
  // Speed: match the target, plus a pull proportional to the gap along our heading.
  const fx = -Math.sin(s.heading);
  const fz = -Math.cos(s.heading);
  const along = dx * fx + dz * fz;
  const targetSpeed = Math.max(0, t.velocity.x * fx + t.velocity.z * fz);
  const wanted = Math.min(host.baseTopSpeed() * 1.6, Math.max(0, targetSpeed + along * 3));
  s.speed = damp(s.speed, wanted, 8, dt);
  host.setLateralVel(damp(host.getLateralVel(), 0, 12, dt));
  if (s.isDrifting) host.cancelDrift();
  return true;
}
