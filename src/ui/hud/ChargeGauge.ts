/**
 * Rocket-start charge gauge: visible while frozen on the grid with the throttle down.
 * Tiers come from BALANCE.race (good / perfect / stall) and drive colour classes.
 */
import { BALANCE as B } from '../../core/balance';
import { t } from '../../core/i18n';
import { clamp01 } from '../../core/math';
import type { KartState } from '../../core/types';
import { el } from '../dom';

const CLASSES = ['weak', 'good', 'perfect', 'danger', 'stall'];

export class ChargeGauge {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private cls = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-charge', undefined, parent);
    el('span', 'hud-charge-label', t('hud.charge'), this.root);
    const bar = el('div', 'hud-charge-bar', undefined, this.root);
    this.fill = el('div', 'hud-charge-fill', undefined, bar);
    const good = (B.race.startChargeGood / B.race.startSpinoutHold) * 100;
    const perfect = (B.race.startChargePerfect / B.race.startSpinoutHold) * 100;
    el('span', 'hud-charge-tick', undefined, bar).style.left = `${good}%`;
    el('span', 'hud-charge-tick perfect', undefined, bar).style.left = `${perfect}%`;
  }

  hide(): void {
    this.root.classList.remove('visible');
  }

  update(s: KartState): void {
    const show = s.isFrozen && s.startCharge > 0.02;
    this.root.classList.toggle('visible', show);
    if (!show) return;
    const frac = clamp01(s.startCharge / B.race.startSpinoutHold);
    this.fill.style.width = `${(frac * 100).toFixed(1)}%`;
    const c = s.startCharge;
    const cls =
      c >= B.race.startSpinoutHold ? 'stall' : c >= B.race.startSpinoutHold - 0.4 ? 'danger' : c >= B.race.startChargePerfect ? 'perfect' : c >= B.race.startChargeGood ? 'good' : 'weak';
    if (cls !== this.cls) {
      this.root.classList.remove(...CLASSES);
      this.root.classList.add(cls);
      this.cls = cls;
    }
  }
}
