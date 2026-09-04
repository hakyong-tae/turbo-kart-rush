/**
 * Bottom sheet shown when the player tries to race a premium kart without a ticket:
 * watch a rewarded ad (3 races), unlock every kart (100 VX), or pick another kart.
 */
import type { CharacterDef } from '../core/types';
import { t } from '../core/i18n';
import { getEntitlements } from '../verse8/entitlements';
import { button, el, TextField } from './dom';

export interface LockSheetHandlers {
  onWatch: () => void | Promise<void>;
  onBuy: () => void | Promise<void>;
  onOther: () => void;
}

export class LockSheet {
  private readonly rootNode: HTMLElement;
  private readonly title: TextField;
  private readonly body: TextField;
  private readonly watchBtn: HTMLButtonElement;
  private readonly buyBtn: HTMLButtonElement;
  private readonly otherBtn: HTMLButtonElement;
  private handlers: LockSheetHandlers | null = null;
  private visible = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen lock-sheet hidden', undefined, root);
    const panel = el('div', 'glass panel lock-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('v8.lock.title'), panel);
    this.title = new TextField(el('h2', 'panel-title', '', panel));
    this.body = new TextField(el('p', 'lock-body', '', panel));
    const actions = el('div', 'actions column', undefined, panel);
    this.watchBtn = button(t('v8.lock.watch'), 'primary', () => void this.run(this.handlers?.onWatch));
    this.buyBtn = button(t('v8.lock.buy'), '', () => void this.run(this.handlers?.onBuy));
    this.otherBtn = button(t('v8.lock.other'), 'ghost', () => this.handlers?.onOther());
    actions.append(this.watchBtn, this.buyBtn, this.otherBtn);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(character: CharacterDef, handlers: LockSheetHandlers): void {
    this.handlers = handlers;
    this.title.set(character.name.toUpperCase());
    const n = getEntitlements().premiumRaces;
    this.body.set(t('v8.lock.body', { name: character.name }) + (n > 0 ? `  ${t('v8.ticketsLeft', { n })}` : ''));
    this.setBusy(false);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
    this.handlers = null;
  }

  setBusy(busy: boolean): void {
    this.watchBtn.disabled = busy;
    this.buyBtn.disabled = busy;
    this.rootNode.classList.toggle('busy', busy);
  }

  dispose(): void {
    this.rootNode.remove();
  }

  private async run(fn: (() => void | Promise<void>) | undefined): Promise<void> {
    if (!fn) return;
    this.setBusy(true);
    try {
      await fn();
    } finally {
      if (this.visible) this.setBusy(false);
    }
  }
}
