/**
 * Daily challenge: today's seeded circuit, rule and kart class, one attempt, one board.
 *
 * The whole thing is derived from the date (src/core/daily.ts), so this panel authors nothing —
 * it reads the challenge, shows who has beaten it today, and hands the player a kart that is
 * eligible. Only eligible karts are offered: a class restriction the player can select past is
 * just a rejected race.
 */
import { dailyChallenge, allowsCharacter, dayKey, type DailyChallenge } from '../core/daily';
import { t } from '../core/i18n';
import type { CharacterDef, InputState, TrackDefinition } from '../core/types';
import { formatRaceTime } from '../core/math';
import { inVerse8Host } from '../verse8/embed';
import { canRace } from '../verse8/entitlements';
import { fetchDailyTop, type DailyTop } from '../verse8/server';
import { badgeElement } from './badges';
import { unpackCosmetics } from '../core/cosmetics';
import { button, el, TextField } from './dom';
import { getKartThumbnail, getLookThumbnail } from './kartThumbnails';

type LocaleKey = Parameters<typeof t>[0];
const tk = (key: string): string => t(key as LocaleKey);

export class DailyPanel {
  onClose: (() => void) | null = null;
  /** Start today's run with this character. Game turns it into a race. */
  onStart: ((challenge: DailyChallenge, characterId: string) => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly summary: TextField;
  private readonly rule: TextField;
  private readonly status: TextField;
  private readonly kartRow: HTMLElement;
  private readonly table: HTMLElement;
  private challenge: DailyChallenge;
  private requestSeq = 0;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly tracks: readonly TrackDefinition[],
    private readonly characters: readonly CharacterDef[],
  ) {
    this.challenge = this.today();
    this.rootNode = el('div', 'screen daily hidden', undefined, root);
    const panel = el('div', 'glass panel daily-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('daily.title'), panel);
    this.summary = new TextField(el('h2', 'panel-title daily-track', '', panel));
    this.rule = new TextField(el('div', 'daily-rule', '', panel));
    this.status = new TextField(el('div', 'daily-status', '', panel));
    this.kartRow = el('div', 'daily-karts', undefined, panel);
    this.table = el('div', 'daily-board', undefined, panel);
    const actions = el('div', 'actions', undefined, panel);
    actions.appendChild(button(t('menu.back'), 'ghost', () => this.close()));
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.challenge = this.today();
    this.renderChallenge();
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    void this.refresh();
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
  }

  dispose(): void {
    this.rootNode.remove();
  }

  private close(): void {
    this.hide();
    this.onClose?.();
  }

  private today(): DailyChallenge {
    return dailyChallenge(dayKey(), this.tracks);
  }

  private renderChallenge(): void {
    const c = this.challenge;
    const track = this.tracks.find((tr) => tr.id === c.trackId);
    this.summary.set(track ? track.name.toUpperCase() : c.trackId);
    this.rule.set(
      `${tk(`daily.rule.${c.rule.id}`)} · ${t('daily.laps', { n: String(c.laps) })} · ${tk(`daily.class.${c.klass}`)}`,
    );
  }

  /** Rebuilds the kart row; `used` greys the whole thing out once today's attempt is spent. */
  private renderKarts(used: boolean): void {
    this.kartRow.replaceChildren();
    const eligible = this.characters.filter((ch) => allowsCharacter(this.challenge, ch.weightClass));
    for (const ch of eligible) {
      const locked = !canRace(ch.id);
      const b = el('button', `daily-kart${locked || used ? ' disabled' : ''}`, undefined, this.kartRow);
      b.type = 'button';
      b.disabled = used || locked;
      // A garage look if this kart has one, else the plain character thumbnail from the sheet.
      const thumb = getLookThumbnail(ch.id, undefined, ch) ?? getKartThumbnail(ch.id);
      if (thumb) {
        const img = el('img', undefined, undefined, b);
        img.src = thumb;
        img.alt = ch.name;
      }
      el('span', 'daily-kart-name', ch.name, b);
      b.addEventListener('click', () => {
        if (b.disabled) return;
        this.onStart?.(this.challenge, ch.id);
      });
    }
  }

  private async refresh(): Promise<void> {
    const seq = ++this.requestSeq;
    this.status.set(t('daily.loading'));
    this.table.replaceChildren();
    this.renderKarts(false);
    // Outside the host there is no board to fetch; say so at once rather than after a timeout.
    const top = inVerse8Host() ? await fetchDailyTop(20) : null;
    if (seq !== this.requestSeq || !this.visible) return;
    // Offline (or outside the host) the board is unreachable, but the run itself still works.
    if (!top) {
      this.status.set(t('daily.offline'));
      this.renderKarts(false);
      return;
    }
    this.status.set(
      top.used
        ? t('daily.done', { time: formatRaceTime(top.myTimeMs / 1000), rank: String(top.myRank ?? 0) })
        : t('daily.ready', { n: String(top.entries) }),
    );
    this.renderKarts(top.used);
    this.renderBoard(top);
  }

  private renderBoard(top: DailyTop): void {
    this.table.replaceChildren();
    if (top.rows.length === 0) {
      el('div', 'daily-empty', t('daily.empty'), this.table);
      return;
    }
    top.rows.forEach((row, i) => {
      const line = el('div', 'daily-row', undefined, this.table);
      if (top.myRank === i + 1) line.classList.add('you');
      el('span', 'daily-rank', String(i + 1), line);
      const kart = this.characters.find((c) => c.id === row.characterId);
      const look = getLookThumbnail(row.characterId, row.cos, kart);
      if (look) {
        const img = el('img', 'daily-thumb', undefined, line);
        img.src = look;
        img.alt = kart?.name ?? row.characterId;
      } else {
        el('span', 'daily-thumb', undefined, line);
      }
      const name = el('span', 'daily-name', undefined, line);
      const badge = badgeElement(unpackCosmetics(row.cos).badge);
      if (badge) name.appendChild(badge);
      name.appendChild(document.createTextNode(row.name));
      el('span', 'daily-time', formatRaceTime(row.timeMs / 1000), line);
    });
  }
}
