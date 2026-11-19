/**
 * Daily check-in: seven cells, one per day of the cycle, today's lit.
 *
 * Opens by itself the first time the lobby is reached on a day that has not been claimed. The
 * server decides what day of the run it is; this panel only draws that answer. A run broken by
 * exactly one missed day gets a choice instead of a claim button: watch an ad and carry on, or
 * start again from day 1.
 */
import { LADDER, STREAK_COINS, STREAK_REWARDS, formatCoins, streakCoins, streakGift } from '../core/economy';
import { t } from '../core/i18n';
import { PLATFORM } from '../core/platform';
import type { InputState } from '../core/types';
import { getStreak, onEntitlementsChange } from '../verse8/entitlements';
import { button, el, setButtonContent } from './dom';
import { icon } from './icons';
import { tokenFullName } from './progression/text';
import { untilNewDay } from './ResultsScreen';

export class AttendancePanel {
  onClose: (() => void) | null = null;
  /** Claim today. `recover`: true after an ad, false to restart, undefined for an unbroken run. */
  onClaim: ((recover?: boolean) => void | Promise<void>) | null = null;
  /** A picture of a garage entry (the player's kart wearing it), for the gift lines. */
  pictureOf: ((token: string) => string | undefined) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly total: HTMLElement;
  private readonly cells: HTMLElement;
  private readonly message: HTMLElement;
  private readonly milestone: HTMLElement;
  private readonly tomorrow: HTMLElement;
  private timer = 0;
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
    this.tomorrow = el('div', 'attendance-tomorrow hidden', undefined, panel);
    this.milestone = el('div', 'attendance-milestone', '', panel);
    const actions = el('div', 'actions', undefined, panel);
    this.claimBtn = button('', 'primary attendance-claim', () => void this.run(undefined), 'coin');
    // Carrying a broken run on costs an ad where there are ads, and nothing where there are none.
    this.recoverBtn = button(t('att.recover'), 'primary attendance-recover', () => void this.run(true), PLATFORM.rewardedAds ? 'ad' : undefined);
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
    // The "new day in hh:mm:ss" clock on the tomorrow line.
    if (!this.timer) this.timer = window.setInterval(() => this.tick(), 1000);
  }

  hide(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
    else if (input.confirm && !this.claimBtn.classList.contains('hidden')) this.claimBtn.click();
  }

  dispose(): void {
    this.hide();
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
    // Days checked in once today's claim is in: the cell for today is this total.
    const totalAfterToday = (st?.total ?? 0) + (claimed ? 0 : 1);
    this.cells.replaceChildren();
    // The cycle the run is in: day 9 of a run is cell 2 of its second week.
    const weekStart = day - cell;
    STREAK_COINS.forEach((coins, i) => {
      const done = i < cell || (i === cell && claimed);
      const node = el('div', `attendance-cell${done ? ' done' : ''}${i === cell && !claimed ? ' today' : ''}`, undefined, this.cells);
      el('span', 'attendance-day', t('att.day', { n: weekStart + i }), node);
      const amount = el('span', 'coin-chip attendance-coins', undefined, node);
      amount.append(icon(done ? 'check' : 'coin'), document.createTextNode(formatCoins(coins)));
      // A day that also hands over a garage entry says so: gifts go by days checked in, in total.
      const gift = streakGift(totalAfterToday + (i - cell));
      if (gift && !done) {
        node.classList.add('gift');
        el('span', 'attendance-gift', tokenFullName(gift), node);
      }
    });

    this.message.textContent = claimed ? t('att.claimed') : broken ? t('att.broken', { n: st?.n ?? 0 }) : '';
    this.message.classList.toggle('hidden', !claimed && !broken);
    // Tomorrow, once today is done: what it pays, what comes with it, when it opens.
    this.tomorrow.replaceChildren();
    this.tomorrow.classList.toggle('hidden', !claimed);
    if (claimed && st) {
      const gift = streakGift(st.total + 1);
      const url = gift ? this.pictureOf?.(gift) : undefined;
      if (url) {
        const img = el('img', 'tomorrow-art', undefined, this.tomorrow);
        img.src = url;
        img.alt = '';
        img.draggable = false;
      }
      const text = el('div', 'tomorrow-text', undefined, this.tomorrow);
      el('span', 'tomorrow-label', t('tomorrow.title'), text);
      const coins = formatCoins(streakCoins(st.n + 1));
      el('span', 'tomorrow-what', gift ? t('tomorrow.gift', { n: coins, name: tokenFullName(gift) }) : t('tomorrow.coins', { n: coins }), text);
      el('span', 'tomorrow-in', t('tomorrow.in', { time: untilNewDay() }), text);
    }
    // The next day (in total) that hands over a garage entry, named and pictured.
    const total = st?.total ?? 0;
    const giftDays = [...Object.keys(STREAK_REWARDS).map(Number), ...LADDER.filter((s) => s.stat === 'days').map((s) => s.at)].sort((a, b) => a - b);
    const next = giftDays.find((at) => at > total);
    const nextToken = next ? streakGift(next) : null;
    this.milestone.replaceChildren();
    // Tomorrow's gift is already on the tomorrow line: do not say it twice.
    if (next && nextToken && !(claimed && next === total + 1)) {
      const url = this.pictureOf?.(nextToken);
      if (url) {
        const img = el('img', 'attendance-gift-art', undefined, this.milestone);
        img.src = url;
        img.alt = '';
        img.draggable = false;
      }
      el('span', '', t('att.dayGift', { n: next, name: tokenFullName(nextToken) }), this.milestone);
    }

    setButtonContent(this.claimBtn, t('att.claim', { n: formatCoins(streakCoins(day)) }), 'coin');
    this.claimBtn.classList.toggle('hidden', claimed || broken);
    this.recoverBtn.classList.toggle('hidden', !broken);
    this.restartBtn.classList.toggle('hidden', !broken);
    for (const b of [this.claimBtn, this.recoverBtn, this.restartBtn]) b.disabled = this.busy;
  }

  private tick(): void {
    const clock = this.tomorrow.querySelector('.tomorrow-in');
    if (clock) clock.textContent = t('tomorrow.in', { time: untilNewDay() });
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
