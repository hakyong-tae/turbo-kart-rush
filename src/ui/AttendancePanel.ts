/**
 * Daily check-in: seven cells, one per day of the cycle, today's lit.
 *
 * Opens by itself the first time the lobby is reached on a day that has not been claimed. The
 * server decides what day of the run it is; this panel only draws that answer. A run broken by
 * exactly one missed day gets a choice instead of a claim button: watch an ad and carry on, or
 * start again from day 1.
 */
import { STREAK_COINS, STREAK_REWARDS, formatCoins, streakCoins } from '../core/economy';
import { t } from '../core/i18n';
import type { InputState } from '../core/types';
import { getStreak, onEntitlementsChange } from '../verse8/entitlements';
import { button, el, setButtonContent } from './dom';
import { icon } from './icons';
import { tokenName } from './progression/text';

export class AttendancePanel {
  onClose: (() => void) | null = null;
  /** Claim today. `recover`: true after an ad, false to restart, undefined for an unbroken run. */
  onClaim: ((recover?: boolean) => void | Promise<void>) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly total: HTMLElement;
  private readonly cells: HTMLElement;
  private readonly message: HTMLElement;
  private readonly milestone: HTMLElement;
  private readonly claimBtn: HTMLButtonElement;
  private readonly recoverBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly unsub: () => void;
  private visible = false;
  private busy = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen attendance hidden', undefined, root);
    const panel = el('div', 'panel attendance-panel', undefined, this.rootNode);
    const head = el('div', 'attendance-head', undefined, panel);
    el('div', 'panel-kicker', t('att.title'), head);
    this.total = el('span', 'attendance-total', '', head);
    this.cells = el('div', 'attendance-cells', undefined, panel);
    this.message = el('p', 'attendance-message', '', panel);
    this.milestone = el('div', 'attendance-milestone', '', panel);
    const actions = el('div', 'actions', undefined, panel);
    this.claimBtn = button('', 'primary attendance-claim', () => void this.run(undefined), 'coin');
    this.recoverBtn = button(t('att.recover'), 'primary attendance-recover', () => void this.run(true), 'ad');
    this.restartBtn = button(t('att.restart'), 'attendance-restart', () => void this.run(false));
    actions.append(this.claimBtn, this.recoverBtn, this.restartBtn, button(t('buy.close'), 'ghost attendance-close', () => this.close()));
    this.unsub = onEntitlementsChange(() => {
      if (this.visible) this.render();
    });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.busy = false;
    this.render();
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
    else if (input.confirm && !this.claimBtn.classList.contains('hidden')) this.claimBtn.click();
  }

  dispose(): void {
    this.unsub();
    this.rootNode.remove();
  }

  private close(): void {
    this.hide();
    this.onClose?.();
  }

  private render(): void {
    const st = getStreak();
    const claimed = st?.claimed ?? false;
    const broken = !claimed && (st?.canRecover ?? false);
    // A broken run is drawn as it would continue: that is what the ad is being offered for.
    const day = !st ? 1 : broken ? st.n + 1 : Math.max(1, st.next);
    const cell = (day - 1) % STREAK_COINS.length;

    this.total.textContent = t('att.total', { n: st?.total ?? 0 });
    this.cells.replaceChildren();
    // The cycle the run is in: day 9 of a run is cell 2 of its second week.
    const weekStart = day - cell;
    STREAK_COINS.forEach((coins, i) => {
      const done = i < cell || (i === cell && claimed);
      const node = el('div', `attendance-cell${done ? ' done' : ''}${i === cell && !claimed ? ' today' : ''}`, undefined, this.cells);
      el('span', 'attendance-day', t('att.day', { n: weekStart + i }), node);
      const amount = el('span', 'coin-chip attendance-coins', undefined, node);
      amount.append(icon(done ? 'check' : 'coin'), document.createTextNode(formatCoins(coins)));
    });

    this.message.textContent = claimed ? t('att.claimed') : broken ? t('att.broken', { n: st?.n ?? 0 }) : '';
    this.message.classList.toggle('hidden', !claimed && !broken);
    const total = st?.total ?? 0;
    const next = Object.keys(STREAK_REWARDS)
      .map(Number)
      .sort((a, b) => a - b)
      .find((at) => at > total);
    this.milestone.textContent = next ? t('att.nextReward', { n: next, name: tokenName(STREAK_REWARDS[next]) }) : '';

    setButtonContent(this.claimBtn, t('att.claim', { n: formatCoins(streakCoins(day)) }), 'coin');
    this.claimBtn.classList.toggle('hidden', claimed || broken);
    this.recoverBtn.classList.toggle('hidden', !broken);
    this.restartBtn.classList.toggle('hidden', !broken);
    for (const b of [this.claimBtn, this.recoverBtn, this.restartBtn]) b.disabled = this.busy;
  }

  private async run(recover: boolean | undefined): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.onClaim?.(recover);
    } finally {
      this.busy = false;
      if (this.visible) this.render();
    }
  }
}
