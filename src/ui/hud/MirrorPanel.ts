/**
 * Rear-view mirror frame (bottom-left PiP). Scans behind the player for closing karts and
 * incoming shells, shows the frame + a one-line label, and exposes the view rectangle the
 * game renders the rear camera into (`src/fx/RearView.ts`).
 *
 * The label names the threat and nothing else. A distance in metres is a number to read at the
 * exact moment the player should be looking at the road, and the frame's own colour and pulse
 * already say how close it is.
 */
import type { HazardInfo, IKart, ItemType } from '../../core/types';
import { t } from '../../core/i18n';
import { TextField, el, restartAnimation } from '../dom';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const KART_RANGE = 14;
const HAZARD_RANGE = 30;

export class MirrorPanel {
  readonly root: HTMLElement;
  private readonly view: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly text: TextField;
  private iconType: ItemType | 'kart' | null = null;
  private level = '';
  private readonly rect: ScreenRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    parent: HTMLElement,
    private readonly buildIcon: (item: ItemType) => HTMLCanvasElement,
  ) {
    this.root = el('div', 'hud-mirror', undefined, parent);
    this.view = el('div', 'hud-mirror-view', undefined, this.root);
    const bar = el('div', 'hud-mirror-bar', undefined, this.root);
    this.icon = el('div', 'hud-mirror-icon', undefined, bar);
    this.text = new TextField(el('div', 'hud-mirror-text', '', bar));
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
    if (s.isFrozen || s.finished) {
      this.set(null, '', '');
      return;
    }
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    let level = '';
    let icon: ItemType | 'kart' | null = null;
    let text = '';
    // Hazards first (they outrank karts).
    let bestHazard = Infinity;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.ownerId === s.id) continue;
      if (h.type !== 'red_shell' && h.type !== 'green_shell' && h.type !== 'blue_shell' && h.type !== 'bob_omb') continue;
      const dx = h.position.x - s.position.x;
      const dz = h.position.z - s.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > HAZARD_RANGE || dist >= bestHazard) continue;
      const rvx = h.velocity.x - s.velocity.x;
      const rvz = h.velocity.z - s.velocity.z;
      const closing = -(rvx * dx + rvz * dz) / Math.max(0.1, dist);
      const behind = dx * fx + dz * fz < 0;
      if (h.type === 'blue_shell' || (closing > 2 && (behind || h.type === 'red_shell'))) {
        bestHazard = dist;
        icon = h.type;
        level = h.type === 'blue_shell' ? 'blue' : 'danger';
        text = h.type === 'blue_shell' ? t('hud.mirror.blue') : t('hud.mirror.shell');
      }
    }
    if (!icon) {
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
          icon = 'kart';
          level = dist < 5 ? 'warn-near' : 'warn';
          text = t('hud.mirror.kart');
        }
      }
    }
    this.set(icon, level, text);
  }

  private set(icon: ItemType | 'kart' | null, level: string, text: string): void {
    if (icon !== this.iconType) {
      this.iconType = icon;
      this.icon.replaceChildren();
      if (icon === 'kart') this.icon.textContent = '🏎';
      else if (icon) {
        this.icon.textContent = '';
        this.icon.appendChild(this.buildIcon(icon));
      }
    }
    if (level !== this.level) {
      this.root.classList.remove('warn', 'warn-near', 'danger', 'blue', 'visible');
      if (level) this.root.classList.add('visible', level);
      this.level = level;
      if (level === 'danger' || level === 'blue') restartAnimation(this.root, 'rumble');
    }
    this.text.set(text);
  }
}
