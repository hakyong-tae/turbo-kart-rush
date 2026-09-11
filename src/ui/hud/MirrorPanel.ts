/**
 * Rear-view mirror frame (bottom-left PiP). Scans behind the player for closing karts and
 * incoming shells, and exposes the view rectangle the game renders the rear camera into
 * (`src/fx/RearView.ts`).
 *
 * No text, no icon: a mirror shows what is behind you. The threat scan only decides whether the
 * mirror is up and how alarmed the frame looks — colour and pulse — because anything written here
 * is read at the exact moment the player should be watching the road, and the HUD already asks
 * for enough attention.
 */
import type { HazardInfo, IKart } from '../../core/types';
import { events } from '../../core/events';
import { el, restartAnimation } from '../dom';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const KART_RANGE = 14;
const HAZARD_RANGE = 30;
/** How long the mirror stays up after your own item lands, so the hit is actually seen. */
const KILL_HOLD_MS = 1400;

export class MirrorPanel {
  readonly root: HTMLElement;
  private readonly view: HTMLElement;
  private level = '';
  private readonly rect: ScreenRect = { x: 0, y: 0, w: 0, h: 0 };
  private holdUntil = 0;
  private playerId = -1;
  private readonly unsubHit: () => void;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-mirror', undefined, parent);
    this.view = el('div', 'hud-mirror-view', undefined, this.root);
    // Your own shell landing on someone behind you is the one thing worth looking back for, and
    // it is over before the mirror's own scan would notice: the hazard is destroyed by the hit.
    // So the hit itself pins the mirror open for a moment.
    this.unsubHit = events.on('item:hit', (e) => {
      if (e.sourceKartId !== this.playerId || e.kartId === this.playerId) return;
      this.holdUntil = performance.now() + KILL_HOLD_MS;
    });
  }

  dispose(): void {
    this.unsubHit();
  }

  /** Rectangle (CSS px) to draw the rear camera into, or null while hidden. Reuses one object. */
  getRect(): ScreenRect | null {
    if (!this.level) return null;
    const r = this.view.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    this.rect.x = r.left;
    this.rect.y = r.top;
    this.rect.w = r.width;
    this.rect.h = r.height;
    return this.rect;
  }

  update(player: IKart, karts: readonly IKart[], hazards: readonly HazardInfo[]): void {
    const s = player.state;
    this.playerId = s.id;
    if (s.isFrozen || s.finished) {
      this.holdUntil = 0;
      this.set('');
      return;
    }
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    let level = '';
    let hazardSeen = false;
    // Hazards first (they outrank karts).
    let bestHazard = Infinity;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.type !== 'red_shell' && h.type !== 'green_shell' && h.type !== 'blue_shell' && h.type !== 'bob_omb') continue;
      const dx = h.position.x - s.position.x;
      const dz = h.position.z - s.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > HAZARD_RANGE || dist >= bestHazard) continue;
      const rvx = h.velocity.x - s.velocity.x;
      const rvz = h.velocity.z - s.velocity.z;
      const closing = -(rvx * dx + rvz * dz) / Math.max(0.1, dist);
      const behind = dx * fx + dz * fz < 0;
      if (h.ownerId === s.id) {
        // Ours. Worth watching, not worth alarming about — the frame stays calm and the mirror
        // opens only once the shell is actually behind us and going away to find someone.
        if (behind && dist < bestHazard) {
          bestHazard = dist;
          hazardSeen = true;
          level = 'mine';
        }
        continue;
      }
      if (h.type === 'blue_shell' || (closing > 2 && (behind || h.type === 'red_shell'))) {
        bestHazard = dist;
        hazardSeen = true;
        level = h.type === 'blue_shell' ? 'blue' : 'danger';
      }
    }
    if (!hazardSeen) {
      let bestKart = Infinity;
      for (let i = 0; i < karts.length; i++) {
        const o = karts[i].state;
        if (o.id === s.id || o.finished) continue;
        const dx = o.position.x - s.position.x;
        const dz = o.position.z - s.position.z;
        const along = dx * fx + dz * fz;
        if (along > -0.5 || along < -KART_RANGE) continue;
        const lateral = Math.abs(dx * fz - dz * fx);
        if (lateral > 4) continue;
        const closing = (o.velocity.x - s.velocity.x) * fx + (o.velocity.z - s.velocity.z) * fz;
        const dist = -along;
        if (closing > 0.5 && dist < bestKart) {
          bestKart = dist;
          level = dist < 5 ? 'warn-near' : 'warn';
        }
      }
    }
    // A hit we caused keeps the mirror open even after the shell is gone, but never downgrades a
    // real threat: being chased still outranks watching a replay.
    if (!level && performance.now() < this.holdUntil) level = 'mine';
    this.set(level);
  }

  private set(level: string): void {
    if (level !== this.level) {
      this.root.classList.remove('warn', 'warn-near', 'danger', 'blue', 'mine', 'visible');
      if (level) this.root.classList.add('visible', level);
      this.level = level;
      if (level === 'danger' || level === 'blue') restartAnimation(this.root, 'rumble');
    }
  }
}
