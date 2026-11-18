/**
 * The garage's purchase sheet: what the kart on the turntable is wearing that the player does not
 * own, what each piece costs in coins, and the two ways to keep it — buy the pieces, or take the
 * 100 VX pass that opens the whole paid tier.
 *
 * It lists only what is on the kart. The catalogue is the tabs behind it; this is the till.
 */
import { formatCoins } from '../../core/economy';
import { t } from '../../core/i18n';
import { button, el, setButtonContent } from '../dom';
import { icon } from '../icons';

export interface PurchaseItem {
  token: string;
  /** Tab name the entry lives under ("TRAIL"). */
  group: string;
  name: string;
  /** Coins, or null for an entry that cannot be bought (earned by playing). */
  price: number | null;
  /** How an unbuyable entry is earned, already translated. */
  condition?: string;
}

export class PurchaseSheet {
  /** Buy these tokens, in order. The garage owns the wallet calls and re-renders this sheet. */
  onBuy: ((tokens: string[]) => void | Promise<void>) | null = null;
  onPass: (() => void) | null = null;
  onClose: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly title: HTMLElement;
  private readonly balance: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly allBtn: HTMLButtonElement;
  private readonly passBtn: HTMLButtonElement;
  private items: readonly PurchaseItem[] = [];
  private visible = false;
  private busy = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'buy-sheet hidden', undefined, root);
    const panel = el('div', 'panel buy-panel', undefined, this.rootNode);
    const head = el('div', 'buy-head', undefined, panel);
    this.title = el('div', 'panel-kicker', t('buy.title'), head);
    this.balance = el('span', 'coin-chip buy-balance', undefined, head);
    this.list = el('div', 'buy-list', undefined, panel);
    this.note = el('div', 'buy-note', '', panel);
    const actions = el('div', 'actions column', undefined, panel);
    this.allBtn = button('', 'primary buy-all', () => void this.run(this.buyable().map((i) => i.token)), 'coin');
    this.passBtn = button(t('buy.pass'), 'buy-pass', () => this.onPass?.(), 'cart');
    actions.append(this.allBtn, this.passBtn, button(t('buy.close'), 'ghost buy-close', () => this.onClose?.()));
    // A press on the dimmed backdrop closes, like every other sheet in the game.
    this.rootNode.addEventListener('click', (ev) => {
      if (ev.target === this.rootNode) this.onClose?.();
    });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Shows (or refreshes) the sheet. `passOffered` is false for a player who already has the pass. */
  show(items: readonly PurchaseItem[], coins: number, passOffered: boolean): void {
    this.items = items;
    // Nothing here is for sale: the sheet is then an explanation, and is titled as one.
    this.title.textContent = t(this.buyable().length > 0 ? 'buy.title' : 'garage.howToGet');
    this.balance.replaceChildren(icon('coin'), document.createTextNode(formatCoins(coins)));
    this.balance.title = t('buy.balance', { n: formatCoins(coins) });
    this.list.replaceChildren();
    for (const item of items) {
      const row = el('div', 'buy-row', undefined, this.list);
      el('span', 'buy-group', item.group, row);
      el('span', 'buy-name', item.name, row);
      if (item.price === null) {
        el('span', 'buy-condition', item.condition ?? '', row);
        continue;
      }
      const price = el('span', 'buy-price', undefined, row);
      price.append(icon('coin'), document.createTextNode(formatCoins(item.price)));
      const b = button(t('buy.one'), 'buy-one', () => void this.run([item.token]));
      b.disabled = this.busy || coins < item.price;
      row.appendChild(b);
    }
    const total = this.buyable().reduce((sum, i) => sum + (i.price ?? 0), 0);
    setButtonContent(this.allBtn, t('buy.all', { n: formatCoins(total) }), 'coin');
    this.allBtn.disabled = this.busy || total === 0 || coins < total;
    // One buyable piece: the row's own button already says everything "buy all" would.
    this.allBtn.classList.toggle('hidden', this.buyable().length < 2);
    this.note.textContent = total > coins ? t('buy.short', { n: formatCoins(total - coins) }) : '';
    this.passBtn.classList.toggle('hidden', !passOffered);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
    this.busy = false;
  }

  dispose(): void {
    this.rootNode.remove();
  }

  private buyable(): PurchaseItem[] {
    return this.items.filter((i) => i.price !== null);
  }

  private async run(tokens: string[]): Promise<void> {
    if (this.busy || tokens.length === 0) return;
    this.busy = true;
    for (const b of Array.from(this.rootNode.querySelectorAll('button'))) b.disabled = true;
    try {
      await this.onBuy?.(tokens);
    } finally {
      this.busy = false;
    }
  }
}
