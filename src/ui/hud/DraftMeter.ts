/**
 * Slipstream meter under the speedometer: a thin bar that fills while tucked in a wake and
 * glows once the tow is active. Deliberately wordless — the air-streak particles carry the
 * message; this is just the charge read-out.
 */
import { clamp01 } from '../../core/math';
import type { KartState } from '../../core/types';
import { el } from '../dom';

export class DraftMeter {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private shown = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-draft', undefined, parent);
    const bar = el('div', 'hud-draft-bar', undefined, this.root);
    this.fill = el('div', 'hud-draft-fill', undefined, bar);
  }

  update(s: KartState): void {
    const shown = s.draftCharge > 0.02 ? 1 : 0;
    if (shown !== this.shown) {
      this.shown = shown;
      this.root.classList.toggle('visible', shown === 1);
    }
    if (shown) {
      this.fill.style.width = `${(clamp01(s.draftCharge) * 100).toFixed(1)}%`;
      this.root.classList.toggle('active', s.isDrafting);
    }
  }
}
