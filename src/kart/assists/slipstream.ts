/**
 * Slipstream (drafting) — tuck into another kart's wake to charge, then run faster while it
 * lasts; pulling OUT of a charged wake to pass fires a short burst (F1 rule: falling back out
 * of range earns nothing).
 *
 * The speed bonus depends on both weight classes (leader → follower): a heavy kart punches
 * the biggest hole, a light kart gains the most from any hole. See `BALANCE.slipstream.bonus`.
 *
 * Owned by Kart; allocation-free per frame.
 */
import { BALANCE as B } from '../../core/balance';
import { events } from '../../core/events';
import type { BoostSource, IKart, KartState, WeightClass } from '../../core/types';

/** What the tracker needs from its kart. */
export interface SlipstreamHost {
  readonly state: KartState;
  baseTopSpeed(): number;
  applyBoost(strength: number, duration: number, source: BoostSource): void;
}

export class SlipstreamTracker {
  /** Forward distance to the wake source on the last in-wake frame (exit rule). */
  private lastAlong = 0;
  /** Weight class of the kart we are drafting (null when none). */
  private leaderClass: WeightClass | null = null;

  update(host: SlipstreamHost, others: readonly IKart[], dt: number): void {
    const s = host.state;
    const S = B.slipstream;
    let inWake = false;
    if (!s.isSpinning && !s.isAirborne && !s.isFrozen && s.speed > S.minSpeedFrac * host.baseTopSpeed()) {
      const fx = -Math.sin(s.heading);
      const fz = -Math.cos(s.heading);
      for (let i = 0; i < others.length; i++) {
        const o = others[i].state;
        if (o.id === s.id || o.isFrozen || o.finished) continue;
        if (Math.abs(o.position.y - s.position.y) > 1.5) continue;
        const dx = o.position.x - s.position.x;
        const dz = o.position.z - s.position.z;
        const along = dx * fx + dz * fz;
        if (along < S.minDistance || along > S.maxDistance) continue;
        const lateral = Math.abs(dx * fz - dz * fx);
        if (lateral > S.lateralTolerance) continue;
        const otherAlong = o.velocity.x * fx + o.velocity.z * fz;
        if (otherAlong < 0.5 * s.speed) continue;
        inWake = true;
        this.lastAlong = along;
        this.leaderClass = o.character.weightClass;
        break;
      }
    }
    if (inWake) {
      s.draftCharge = Math.min(1, s.draftCharge + dt / S.chargeTime);
      if (!s.isDrafting && s.draftCharge >= 1) {
        s.isDrafting = true;
        events.emit('kart:draftStart', { kartId: s.id });
      }
    } else {
      if (s.isDrafting) {
        const burst = this.lastAlong < S.maxDistance * 0.75;
        if (burst) host.applyBoost(S.exitBoostStrength, S.exitBoostDuration, 'slipstream');
        events.emit('kart:draftEnd', { kartId: s.id, burst });
      }
      s.isDrafting = false;
      s.draftCharge = Math.max(0, s.draftCharge - dt * 2);
      if (s.draftCharge <= 0) this.leaderClass = null;
    }
  }

  /** Top-speed multiplier while drafting (1 when not). */
  bonus(host: SlipstreamHost): number {
    if (!host.state.isDrafting || !this.leaderClass) return 1;
    return B.slipstream.bonus[this.leaderClass][host.state.character.weightClass];
  }

  reset(): void {
    this.lastAlong = 0;
    this.leaderClass = null;
  }
}
