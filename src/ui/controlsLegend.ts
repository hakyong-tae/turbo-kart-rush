/**
 * The controls legend: which key (or which touch control) does what.
 *
 * It used to sit on the title screen, where it explained the game before anyone had asked. It now
 * lives in Settings, and is shown once on the loading screen of the first race. A touch device
 * gets the touch controls instead of a keyboard it does not have.
 */
import { t } from '../core/i18n';
import type { IconName } from './icons';
import { icon } from './icons';
import { el, kbd, kbdIcon } from './dom';

type Key = string | { icon: IconName };

const KEYBOARD: readonly { keys: readonly Key[]; label: Parameters<typeof t>[0] }[] = [
  { keys: ['W', { icon: 'chevron-up' }], label: 'legend.throttle' },
  { keys: ['S', { icon: 'chevron-down' }], label: 'legend.brake' },
  { keys: ['A', 'D', { icon: 'chevron-left' }, { icon: 'chevron-right' }], label: 'legend.steer' },
  { keys: ['SPACE', 'SHIFT'], label: 'legend.drift' },
  { keys: ['E', 'CTRL'], label: 'legend.item' },
  { keys: ['Q'], label: 'legend.lookBack' },
  { keys: ['ESC', 'P'], label: 'legend.pause' },
  { keys: ['M'], label: 'legend.mute' },
];

export function buildControlsLegend(parent: HTMLElement, touch: boolean): HTMLElement {
  const legend = el('div', `controls-legend${touch ? ' touch' : ''}`, undefined, parent);
  if (touch) {
    const row = (name: HTMLElement | string, text: string): void => {
      const r = el('div', 'legend-row', undefined, legend);
      const cell = el('span', 'legend-keys', undefined, r);
      if (typeof name === 'string') el('span', 'chip', name, cell);
      else cell.appendChild(name);
      el('span', 'legend-text', text, r);
    };
    row(t('legend.touch.stickName'), t('legend.touch.stick'));
    row(t('touch.drift'), t('legend.touch.drift'));
    row(t('touch.item'), t('legend.touch.item'));
    const pause = el('span', 'chip');
    pause.appendChild(icon('pause'));
    row(pause, t('legend.pause'));
    return legend;
  }
  for (const entry of KEYBOARD) {
    const r = el('div', 'legend-row', undefined, legend);
    const cell = el('span', 'legend-keys', undefined, r);
    for (const key of entry.keys) {
      if (typeof key === 'string') kbd(cell, key);
      else kbdIcon(cell, key.icon);
    }
    el('span', 'legend-text', t(entry.label), r);
  }
  return legend;
}
