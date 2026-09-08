/**
 * Landscape-only gate for touch devices: while the device is held in portrait a full-screen
 * overlay covers the game and `onGate(true)` fires (Game pauses a running race). Best-effort
 * `screen.orientation.lock('landscape')` once we are back in landscape.
 */
import { t } from '../core/i18n';
import { el } from '../ui/dom';

export class OrientationGate {
  private readonly node: HTMLElement;
  private gated = false;

  constructor(
    uiRoot: HTMLElement,
    private readonly isTouch: () => boolean,
    private readonly onGate: (gated: boolean) => void,
  ) {
    this.node = el('div', 'rotate-gate hidden', undefined, uiRoot);
    el('div', 'rotate-gate-icon', '📱', this.node);
    el('div', 'rotate-gate-title', t('rotate.title'), this.node);
    el('div', 'rotate-gate-body', t('rotate.body'), this.node);
    window.addEventListener('resize', this.check);
    window.addEventListener('orientationchange', this.check);
    this.check();
  }

  get isGated(): boolean {
    return this.gated;
  }

  readonly check = (): void => {
    const gate = this.isTouch() && window.innerHeight > window.innerWidth;
    if (gate !== this.gated) {
      this.gated = gate;
      this.node.classList.toggle('hidden', !gate);
      this.onGate(gate);
    }
    if (!gate) {
      const so = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      so?.lock?.('landscape').catch(() => undefined);
    }
  };

  dispose(): void {
    window.removeEventListener('resize', this.check);
    window.removeEventListener('orientationchange', this.check);
    this.node.remove();
  }
}
