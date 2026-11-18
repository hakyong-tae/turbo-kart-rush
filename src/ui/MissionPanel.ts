/**
 * Daily missions: the three the server picked for today, how far along each is, what each pays.
 *
 * Nothing is claimed here. A mission pays the moment the race that completes it is settled, so
 * this panel is a notice board: read it, go race. The one action is trading a mission away after
 * a rewarded ad, once a day.
 */
import { formatCoins } from '../core/economy';
import { t } from '../core/i18n';
import type { InputState } from '../core/types';
import { getMissions, onEntitlementsChange, refreshEntitlements } from '../verse8/entitlements';
import type { MissionView } from '../verse8/server';
import { button, el } from './dom';
import { icon } from './icons';
import { missionTitle, type TrackNamer } from './progression/text';

const TIER_LABEL = ['diff.easy', 'diff.normal', 'diff.hard'] as const;

/** Time left until the next UTC midnight, as `hh:mm:ss`. */
function untilReset(now = Date.now()): string {
  const left = Math.max(0, 86400000 - (now % 86400000));
  const two = (n: number): string => String(Math.floor(n)).padStart(2, '0');
  return `${two(left / 3600000)}:${two((left / 60000) % 60)}:${two((left / 1000) % 60)}`;
}

export class MissionPanel {
  onClose: (() => void) | null = null;
  /** Watch an ad, then trade mission `index`. Game owns the ad; the panel re-renders on the reply. */
  onSwap: ((index: number) => void | Promise<void>) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly list: HTMLElement;
  private readonly bonus: HTMLElement;
  private readonly reset: HTMLElement;
  private readonly unsub: () => void;
  private timer = 0;
  private visible = false;
  private busy = false;
  private shownDay = '';

  constructor(
    root: HTMLElement,
    private readonly trackName: TrackNamer,
  ) {
    this.rootNode = el('div', 'screen missions hidden', undefined, root);
    const panel = el('div', 'panel missions-panel', undefined, this.rootNode);
    const head = el('div', 'missions-head', undefined, panel);
    el('div', 'panel-kicker', t('mis.title'), head);
    this.reset = el('span', 'missions-reset', '', head);
    this.list = el('div', 'missions-list', undefined, panel);
    this.bonus = el('div', 'missions-bonus', '', panel);
    const actions = el('div', 'actions', undefined, panel);
    actions.appendChild(button(t('menu.back'), 'ghost', () => this.close(), 'chevron-left'));
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
    // A set read yesterday is not today's: ask again whenever the panel opens without one.
    if (!getMissions()) void refreshEntitlements();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  hide(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (this.visible && input.back) this.close();
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

  private tick(): void {
    this.reset.textContent = t('mis.reset', { time: untilReset() });
    // Midnight UTC passed while the panel was open: yesterday's cards are no longer the truth.
    if (this.shownDay && this.shownDay !== new Date().toISOString().slice(0, 10)) {
      this.shownDay = '';
      void refreshEntitlements();
    }
  }

  private render(): void {
    const missions = getMissions();
    this.reset.textContent = t('mis.reset', { time: untilReset() });
    this.list.replaceChildren();
    if (!missions) {
      el('div', 'missions-empty', t('mis.offline'), this.list);
      this.bonus.textContent = '';
      return;
    }
    this.shownDay = missions.day;
    missions.list.forEach((m, i) => this.card(m, i, missions.swapsLeft > 0));
    this.bonus.textContent = missions.bonus ? t('mis.bonusDone') : t('mis.bonus', { n: formatCoins(missions.bonusCoins) });
    this.bonus.classList.toggle('done', missions.bonus);
  }

  private card(m: MissionView, index: number, canSwap: boolean): void {
    const card = el('div', `mission-card tier-${m.tier}${m.done ? ' done' : ''}`, undefined, this.list);
    const top = el('div', 'mission-top', undefined, card);
    el('span', 'chip mission-tier', t(TIER_LABEL[m.tier] ?? 'diff.normal'), top);
    el('span', 'mission-title', missionTitle(m.key, this.trackName), top);
    const bottom = el('div', 'mission-bottom', undefined, card);
    const bar = el('div', 'mission-bar', undefined, bottom);
    const fill = el('i', '', undefined, bar);
    fill.style.width = `${Math.round((Math.min(m.progress, m.target) / Math.max(1, m.target)) * 100)}%`;
    el('span', 'mission-count', `${Math.min(m.progress, m.target)}/${m.target}`, bottom);
    const reward = el('span', 'coin-chip mission-reward', undefined, bottom);
    reward.append(icon('coin'), document.createTextNode(formatCoins(m.coins)));
    el('span', 'mission-xp', t('mis.xp', { n: m.xp }), bottom);
    if (m.done) {
      const done = el('span', 'mission-done', undefined, bottom);
      done.append(icon('check'), document.createTextNode(t('mis.done')));
    } else if (canSwap) {
      const swap = button(t('mis.swap'), 'mission-swap', () => void this.swap(index), 'ad');
      swap.disabled = this.busy;
      bottom.appendChild(swap);
    }
  }

  private async swap(index: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.onSwap?.(index);
    } finally {
      this.busy = false;
      if (this.visible) this.render();
    }
  }
}
