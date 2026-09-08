/**
 * Track records panel: one tab per track, top 10 times, the caller's rank/best.
 * Falls back to the on-device best when the Verse8 gameserver is not reachable.
 */
import type { CharacterDef, InputState, TrackDefinition } from '../core/types';
import { t } from '../core/i18n';
import type { StringKey } from '../core/i18n';
import { formatRaceTime } from '../core/math';
import { getEntitlements } from '../verse8/entitlements';
import { inVerse8Host } from '../verse8/embed';
import { fetchTopTimes, type SubmitResult } from '../verse8/server';
import { button, el, TextField } from './dom';

const ROWS = 10;

export function localBestKey(trackId: string): string {
  return `tkr.best.${trackId}`;
}

export function readLocalBest(trackId: string): number | null {
  try {
    const v = Number(localStorage.getItem(localBestKey(trackId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export class LeaderboardPanel {
  onSetNickname: (() => void) | null = null;
  onClose: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly table: HTMLElement;
  private readonly status: TextField;
  private readonly mine: TextField;
  private readonly nickLink: HTMLButtonElement;
  private trackId = '';
  private requestSeq = 0;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly tracks: readonly TrackDefinition[],
    private readonly characters: readonly CharacterDef[],
  ) {
    this.rootNode = el('div', 'screen lb hidden', undefined, root);
    const panel = el('div', 'glass panel lb-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('lb.title'), panel);
    const tabRow = el('div', 'lb-tabs', undefined, panel);
    for (const tr of tracks) {
      const b = el('button', 'seg lb-tab', tr.name.toUpperCase(), tabRow);
      b.type = 'button';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void this.load(tr.id);
      });
      this.tabs.push(b);
    }
    this.table = el('div', 'lb-table', undefined, panel);
    this.status = new TextField(el('div', 'lb-status', '', panel));
    this.mine = new TextField(el('div', 'lb-mine', '', panel));
    const foot = el('div', 'actions', undefined, panel);
    this.nickLink = button(t('lb.setNickname'), 'ghost lb-nick', () => this.onSetNickname?.());
    foot.appendChild(this.nickLink);
    foot.appendChild(button(t('lb.close'), 'primary', () => this.close()));
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(trackId: string, opts: { submit?: SubmitResult | null } = {}): void {
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    this.nickLink.classList.toggle('hidden', getEntitlements().nickname !== '');
    void this.load(trackId, opts.submit ?? null);
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
    else if (input.menuLeft || input.menuRight) {
      const i = this.tracks.findIndex((tr) => tr.id === this.trackId);
      const n = this.tracks.length;
      const next = (i + (input.menuRight ? 1 : -1) + n) % n;
      void this.load(this.tracks[next].id);
    }
  }

  dispose(): void {
    this.rootNode.remove();
  }

  private close(): void {
    this.hide();
    this.onClose?.();
  }

  private async load(trackId: string, submit: SubmitResult | null = null): Promise<void> {
    this.trackId = trackId;
    this.tabs.forEach((b, i) => b.classList.toggle('selected', this.tracks[i].id === trackId));
    this.table.replaceChildren();
    this.mine.set('');
    const seq = ++this.requestSeq;

    const localBest = readLocalBest(trackId);
    // Outside the host there is no server at all. Inside it we always try: the socket may
    // still be connecting, and fetchTopTimes() waits for it.
    if (!inVerse8Host()) {
      this.status.set(t('lb.offline'));
      this.mine.set(localBest !== null ? t('lb.localBest', { time: formatRaceTime(localBest / 1000) }) : t('lb.noEntry'));
      return;
    }

    this.status.set(t('lb.loading'));
    const top = await fetchTopTimes(trackId, ROWS);
    if (seq !== this.requestSeq || !this.visible) return; // a newer tab request superseded this one
    if (!top) {
      this.status.set(t('lb.error'));
      this.mine.set(localBest !== null ? t('lb.localBest', { time: formatRaceTime(localBest / 1000) }) : '');
      return;
    }
    this.status.set(top.rows.length === 0 ? t('lb.empty') : '');
    const myName = getEntitlements().nickname;
    top.rows.forEach((row, i) => {
      const line = el('div', 'lb-row', undefined, this.table);
      const isMe = top.myRank === i + 1 && (myName === '' || row.name === myName || row.timeMs === top.myBest);
      if (isMe) line.classList.add('you');
      el('span', 'lb-cell lb-rank', String(i + 1), line);
      el('span', 'lb-cell lb-name', row.name, line);
      el('span', 'lb-cell lb-time', formatRaceTime(row.timeMs / 1000), line);
      const kart = this.characters.find((c) => c.id === row.characterId);
      el('span', 'lb-cell lb-kart', kart ? kart.name : row.characterId, line);
      el('span', 'lb-cell lb-diff', t(`diff.${row.difficulty}` as StringKey), line);
    });
    if (submit?.updated && submit.rank) {
      this.mine.set(t('lb.newRank', { rank: submit.rank }));
    } else if (top.myBest !== null && top.myRank !== null) {
      this.mine.set(t('lb.myBest', { time: formatRaceTime(top.myBest / 1000), rank: top.myRank }));
    } else {
      this.mine.set(t('lb.noEntry'));
    }
  }
}
