/**
 * Bottom sheet shown when the player tries to race a premium kart without a ticket:
 * watch a rewarded ad (3 races), buy this kart for good with coins, unlock every kart (100 VX),
 * or pick another kart.
 */
import type { CharacterDef } from '../core/types';
import { t } from '../core/i18n';
import { KART_PRICE, formatCoins } from '../core/economy';
import { PLATFORM } from '../core/platform';
import { getCoins, getEntitlements } from '../verse8/entitlements';
import { button, el, TextField } from './dom';
import { icon } from './icons';

export interface LockSheetHandlers {
  onWatch: () => void | Promise<void>;
  /** Spend `KART_PRICE` coins on this kart, permanently. */
  onCoins: () => void | Promise<void>;
  onBuy: () => void | Promise<void>;
  onOther: () => void;
}

export class LockSheet {
  private readonly rootNode: HTMLElement;
  private readonly title: TextField;
  private readonly body: TextField;
  private readonly wallet: HTMLElement;
  private readonly watchBtn: HTMLButtonElement;
  private readonly coinsBtn: HTMLButtonElement;
  private readonly buyBtn: HTMLButtonElement;
  private readonly otherBtn: HTMLButtonElement;
  private handlers: LockSheetHandlers | null = null;
  private visible = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen lock-sheet hidden', undefined, root);
    const panel = el('div', 'panel lock-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('v8.lock.title'), panel);
    this.title = new TextField(el('h2', 'panel-title', '', panel));
    this.body = new TextField(el('p', 'lock-body', '', panel));
    this.wallet = el('div', 'coin-chip lock-wallet', undefined, panel);
    const actions = el('div', 'actions column', undefined, panel);
    this.watchBtn = button(t('v8.lock.watch'), 'primary', () => void this.run(this.handlers?.onWatch), 'ad');
    this.coinsBtn = button(t('v8.lock.coins', { n: formatCoins(KART_PRICE) }), 'lock-coins', () => void this.run(this.handlers?.onCoins), 'coin');
    this.buyBtn = button(t('v8.lock.buy'), '', () => void this.run(this.handlers?.onBuy), 'cart');
    this.otherBtn = button(t('v8.lock.other'), 'ghost', () => this.handlers?.onOther());
    actions.append(this.watchBtn, this.coinsBtn, this.buyBtn, this.otherBtn);
    // A build with no rewarded ads or no VX shop offers the kart for coins and nothing else.
    this.watchBtn.hidden = !PLATFORM.rewardedAds;
    this.buyBtn.hidden = !PLATFORM.vx;
    if (!PLATFORM.rewardedAds) this.coinsBtn.classList.add('primary');
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(character: CharacterDef, handlers: LockSheetHandlers): void {
    this.handlers = handlers;
    this.title.set(character.name.toUpperCase());
    const n = getEntitlements().premiumRaces;
    this.body.set(t('v8.lock.body', { name: character.name }) + (n > 0 && PLATFORM.rewardedAds ? `  ${t('v8.ticketsLeft', { n })}` : ''));
    this.wallet.replaceChildren(icon('coin'), document.createTextNode(t('v8.lock.have', { n: formatCoins(getCoins()) })));
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
    // Short of the price the button stays, greyed, so the player can see what they are saving for.
    this.coinsBtn.disabled = busy || getCoins() < KART_PRICE;
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
