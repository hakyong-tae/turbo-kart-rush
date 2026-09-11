/**
 * What every item on the track does.
 *
 * Opened from Settings. The roulette hands out fourteen different things and none of them are
 * explained anywhere in the race — players were reported saving a star because they thought a
 * nitro was faster, and throwing bananas forward. This is the reference, not a tutorial: a row
 * per item, the real icon from the HUD beside it, and one line on what it actually does.
 *
 * Icons come from `buildItemIcon`, the same canvas the HUD draws, so the picture here is the
 * picture in the race.
 */
import { ALL_ITEM_TYPES } from '../core/types';
import { t } from '../core/i18n';
import { buildItemIcon } from '../items/itemVisuals';
import { button, el } from './dom';

export class ItemGuide {
  onClose: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly list: HTMLElement;
  private visible = false;
  private built = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen item-guide hidden', undefined, root);
    const panel = el('div', 'glass panel item-guide-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('guide.title'), panel);
    el('p', 'item-guide-intro', t('guide.intro'), panel);
    this.list = el('div', 'item-guide-list', undefined, panel);
    const actions = el('div', 'actions', undefined, panel);
    actions.appendChild(button(t('settings.close'), 'ghost', () => this.close()));
  }

  /**
   * Rows are built on first open rather than in the constructor: fourteen icon canvases is real
   * work for a panel most players never open, and the title screen is already drawing a race.
   */
  private build(): void {
    this.list.replaceChildren();
    for (const item of ALL_ITEM_TYPES) {
      const row = el('div', 'item-guide-row', undefined, this.list);
      const icon = el('div', 'item-guide-icon', undefined, row);
      icon.appendChild(buildItemIcon(item));
      const text = el('div', 'item-guide-text', undefined, row);
      el('span', 'item-guide-name', t(`item.${item}` as Parameters<typeof t>[0]), text);
      el('span', 'item-guide-desc', t(`guide.${item}` as Parameters<typeof t>[0]), text);
    }
    this.built = true;
  }

  open(): void {
    if (!this.built) this.build();
    this.visible = true;
    this.rootNode.classList.remove('hidden');
    this.list.scrollTop = 0;
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.rootNode.classList.add('hidden');
    this.onClose?.();
  }

  isOpen(): boolean {
    return this.visible;
  }

  /**
   * The guide's screen is a sibling of the settings panel, not a child, so it has to be taken
   * down with it — a language change rebuilds Settings, and without this every switch would leave
   * another dead guide in the DOM.
   */
  dispose(): void {
    this.rootNode.remove();
  }
}
