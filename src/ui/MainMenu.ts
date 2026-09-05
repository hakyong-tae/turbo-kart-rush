/**
 * Main menu: Title → Character Select → Track Select. Pure DOM; the 3D backdrop
 * behind it is owned by Game (mirrored via onHighlight).
 */
import type { CharacterDef, Difficulty, InputState, RaceSettings, TrackDefinition } from '../core/types';
import { events } from '../core/events';
import { GAME_TITLE, DEFAULT_LAPS } from '../core/constants';
import { button, cssHex, cssRgba, el, TextField } from './dom';
import { t, t as tt, tOr } from '../core/i18n';
import { canRace, getEntitlements, isPremium, onEntitlementsChange } from '../verse8/entitlements';
import type { StringKey } from '../core/i18n';

export type MenuPanel = 'title' | 'characterSelect' | 'trackSelect';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, StringKey> = { easy: 'diff.easy', normal: 'diff.normal', hard: 'diff.hard' };
const DIFFICULTY_BLURB: Record<Difficulty, StringKey> = {
  easy: 'diff.easy.blurb',
  normal: 'diff.normal.blurb',
  hard: 'diff.hard.blurb',
};
const STAT_KEYS: readonly { key: keyof CharacterDef['stats']; label: StringKey }[] = [
  { key: 'speed', label: 'stat.speed' },
  { key: 'acceleration', label: 'stat.acceleration' },
  { key: 'handling', label: 'stat.handling' },
  { key: 'weight', label: 'stat.weight' },
  { key: 'miniTurbo', label: 'stat.miniTurbo' },
];
const TIER_KEYS: readonly StringKey[] = ['tier.rookie', 'tier.pro', 'tier.expert'];
const CHAR_COLUMNS = 4;

export class MainMenu {
  onStart: ((settings: RaceSettings) => void) | null = null;
  onHighlight: ((characterId: string) => void) | null = null;
  onPanelChange: ((panel: MenuPanel) => void) | null = null;
  /** Player tried to continue with a premium kart they cannot race yet. */
  onLockedAttempt: ((character: CharacterDef) => void) | null = null;
  onRecords: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onOnline: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly panels: Record<MenuPanel, HTMLElement>;
  private panel: MenuPanel = 'title';
  private visible = false;

  // Character select
  private readonly charCards: HTMLElement[] = [];
  private charIndex = 0;
  private readonly charName: TextField;
  private readonly charTagline: TextField;
  private readonly lockBadges = new Map<string, HTMLElement>();
  private readonly unsubEntitlements: () => void;

  // Track select
  private readonly trackCards: HTMLElement[] = [];
  private trackIndex = 0;
  private readonly diffButtons: HTMLElement[] = [];
  private difficultyIndex = 1;
  private readonly diffBlurb: TextField;
  private readonly startButton: HTMLElement;
  /** 0 = track cards row, 1 = difficulty row, 2 = start button. */
  private trackRow = 0;

  constructor(
    root: HTMLElement,
    private readonly characters: readonly CharacterDef[],
    private readonly tracks: readonly TrackDefinition[],
  ) {
    this.rootNode = el('div', 'screen menu hidden', undefined, root);

    // ---------------------------------------------------------------- title
    const title = el('section', 'panel-title-screen', undefined, this.rootNode);
    const settingsBtn = button('⚙', 'ghost title-corner settings-toggle', () => this.onSettings?.());
    settingsBtn.title = t('settings.title');
    title.appendChild(settingsBtn);
    const recordsBtn = button(t('lb.button'), 'ghost title-corner records-toggle', () => this.onRecords?.());
    title.appendChild(recordsBtn);
    const onlineBtn = button(t('online.button'), 'primary title-corner online-toggle', () => this.onOnline?.());
    title.appendChild(onlineBtn);
    const logoWrap = el('div', 'logo', undefined, title);
    const words = GAME_TITLE.split(' ');
    words.forEach((w, i) => {
      const line = el('span', `logo-word logo-word-${i}`, undefined, logoWrap);
      line.dataset.text = w;
      line.textContent = w;
    });
    el('div', 'logo-sub', t('title.sub'), title);
    const prompt = el('div', 'press-start', undefined, title);
    el(
      'span',
      'press-start-text',
      window.matchMedia?.('(pointer: coarse)').matches ? t('title.tapStart') : t('title.pressStart'),
      prompt,
    );
    const legend = el('div', 'controls-legend glass', undefined, title);
    const keys: [string, string][] = [
      ['W / ↑', t('legend.throttle')],
      ['S / ↓', t('legend.brake')],
      ['A D / ← →', t('legend.steer')],
      ['SPACE / SHIFT', t('legend.drift')],
      ['E / CTRL', t('legend.item')],
      ['Q', t('legend.lookBack')],
      ['ESC / P', t('legend.pause')],
      ['M', t('legend.mute')],
    ];
    for (const [k, v] of keys) {
      const row = el('div', 'legend-row', undefined, legend);
      el('kbd', '', k, row);
      el('span', '', v, row);
    }
    el('div', 'version', t('title.version'), title);
    title.addEventListener('click', () => {
      if (this.panel === 'title') this.goTo('characterSelect', true);
    });

    // ------------------------------------------------------- character select
    const chars = el('section', 'panel-select panel-chars', undefined, this.rootNode);
    const charHead = el('header', 'select-header', undefined, chars);
    el('div', 'panel-kicker', t('menu.step1'), charHead);
    el('h2', 'panel-title', t('menu.chooseRacer'), charHead);
    const charGrid = el('div', 'card-grid char-grid', undefined, chars);
    characters.forEach((c, i) => {
      const card = this.buildCharacterCard(c);
      card.addEventListener('pointerenter', () => this.setCharacter(i));
      card.addEventListener('click', () => {
        if (this.charIndex === i) this.tryProceed();
        else this.setCharacter(i, true);
      });
      card.addEventListener('dblclick', () => this.tryProceed());
      charGrid.appendChild(card);
      this.charCards.push(card);
    });
    const charFoot = el('footer', 'select-footer glass', undefined, chars);
    const charInfo = el('div', 'select-info', undefined, charFoot);
    this.charName = new TextField(el('div', 'select-info-name', '', charInfo));
    this.charTagline = new TextField(el('div', 'select-info-tagline', '', charInfo));
    const charActions = el('div', 'actions', undefined, charFoot);
    charActions.appendChild(button(t('menu.back'), 'ghost', () => this.goTo('title', true)));
    charActions.appendChild(button(t('menu.continue'), 'primary', () => this.tryProceed()));

    // ----------------------------------------------------------- track select
    const tr = el('section', 'panel-select panel-tracks', undefined, this.rootNode);
    const trHead = el('header', 'select-header', undefined, tr);
    el('div', 'panel-kicker', t('menu.step2'), trHead);
    el('h2', 'panel-title', t('menu.pickCircuit'), trHead);
    const trackGrid = el('div', 'card-grid track-grid', undefined, tr);
    tracks.forEach((t, i) => {
      const card = this.buildTrackCard(t);
      card.addEventListener('pointerenter', () => {
        this.trackRow = 0;
        this.setTrack(i);
      });
      card.addEventListener('click', () => {
        if (this.trackIndex === i && this.trackRow === 0) this.start();
        else {
          this.trackRow = 0;
          this.setTrack(i, true);
        }
      });
      trackGrid.appendChild(card);
      this.trackCards.push(card);
    });
    const trFoot = el('footer', 'select-footer glass', undefined, tr);
    const diffWrap = el('div', 'difficulty', undefined, trFoot);
    el('div', 'difficulty-label', t('menu.difficulty'), diffWrap);
    const seg = el('div', 'segmented', undefined, diffWrap);
    DIFFICULTIES.forEach((d, i) => {
      const b = el('button', 'seg', t(DIFFICULTY_LABEL[d]), seg);
      b.type = 'button';
      b.addEventListener('pointerenter', () => {
        this.trackRow = 1;
        this.refreshTrackFocus();
      });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.trackRow = 1;
        this.setDifficulty(i, true);
      });
      this.diffButtons.push(b);
    });
    this.diffBlurb = new TextField(el('div', 'difficulty-blurb', '', diffWrap));
    const trActions = el('div', 'actions', undefined, trFoot);
    trActions.appendChild(button(t('menu.back'), 'ghost', () => this.goTo('characterSelect', true)));
    this.startButton = button(t('menu.startRace'), 'primary start', () => this.start());
    this.startButton.addEventListener('pointerenter', () => {
      this.trackRow = 2;
      this.refreshTrackFocus();
    });
    trActions.appendChild(this.startButton);

    this.panels = { title, characterSelect: chars, trackSelect: tr };
    this.unsubEntitlements = onEntitlementsChange(() => this.refreshLocks());
    this.refreshLocks();
    this.setCharacter(0);
    this.setTrack(0);
    this.setDifficulty(1);
    this.applyPanel();
  }

  // ------------------------------------------------------------------ public

  get currentPanel(): MenuPanel {
    return this.panel;
  }

  get highlightedCharacter(): CharacterDef {
    return this.characters[this.charIndex];
  }

  show(panel: MenuPanel = 'title'): void {
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    this.goTo(panel, false);
    this.onHighlight?.(this.highlightedCharacter.id);
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  dispose(): void {
    this.unsubEntitlements();
    this.rootNode.remove();
  }

  /** Continue past character select after a lock was resolved (ad watched / purchase made). */
  proceedFromCharacter(): void {
    if (this.panel === 'characterSelect') this.goTo('trackSelect', true);
  }

  /** Drive navigation from the InputState edges (keyboard / gamepad). */
  handleInput(input: InputState): void {
    if (!this.visible) return;
    switch (this.panel) {
      case 'title':
        if (input.confirm) this.goTo('characterSelect', true);
        break;
      case 'characterSelect': {
        const n = this.characters.length;
        if (input.menuLeft) this.setCharacter((this.charIndex - 1 + n) % n, true);
        else if (input.menuRight) this.setCharacter((this.charIndex + 1) % n, true);
        else if (input.menuUp) this.setCharacter((this.charIndex - CHAR_COLUMNS + n) % n, true);
        else if (input.menuDown) this.setCharacter((this.charIndex + CHAR_COLUMNS) % n, true);
        if (input.confirm) this.tryProceed();
        else if (input.back) this.goTo('title', true);
        break;
      }
      case 'trackSelect': {
        if (input.menuUp) {
          this.trackRow = (this.trackRow + 2) % 3;
          this.refreshTrackFocus();
          events.emit('ui:move', {});
        } else if (input.menuDown) {
          this.trackRow = (this.trackRow + 1) % 3;
          this.refreshTrackFocus();
          events.emit('ui:move', {});
        } else if (input.menuLeft || input.menuRight) {
          const dir = input.menuRight ? 1 : -1;
          if (this.trackRow === 0) {
            const n = this.tracks.length;
            this.setTrack((this.trackIndex + dir + n) % n, true);
          } else if (this.trackRow === 1) {
            this.setDifficulty((this.difficultyIndex + dir + 3) % 3, true);
          } else {
            events.emit('ui:move', {});
          }
        }
        if (input.confirm) this.start();
        else if (input.back) this.goTo('characterSelect', true);
        break;
      }
    }
  }

  // ----------------------------------------------------------------- private

  private tryProceed(): void {
    const def = this.characters[this.charIndex];
    if (!def) return;
    if (!canRace(def.id)) {
      events.emit('ui:back', {});
      this.onLockedAttempt?.(def);
      return;
    }
    this.goTo('trackSelect', true);
  }

  private refreshLocks(): void {
    const ent = getEntitlements();
    this.charCards.forEach((card, i) => {
      const def = this.characters[i];
      if (!def || !isPremium(def.id)) return;
      const locked = !canRace(def.id);
      card.classList.toggle('locked', locked);
      const badge = this.lockBadges.get(def.id);
      if (!badge) return;
      if (ent.adsRemoved) badge.classList.add('hidden');
      else {
        badge.classList.remove('hidden');
        badge.textContent = ent.premiumRaces > 0 ? t('v8.ticketsLeft', { n: ent.premiumRaces }) : t('v8.locked');
      }
    });
  }

  private goTo(panel: MenuPanel, sound: boolean): void {
    if (sound) {
      const forward =
        (this.panel === 'title' && panel !== 'title') || (this.panel === 'characterSelect' && panel === 'trackSelect');
      events.emit(forward ? 'ui:select' : 'ui:back', {});
    }
    const changed = panel !== this.panel;
    this.panel = panel;
    this.applyPanel();
    if (changed) this.onPanelChange?.(panel);
  }

  private applyPanel(): void {
    for (const key of Object.keys(this.panels) as MenuPanel[]) {
      const node = this.panels[key];
      const active = key === this.panel;
      node.classList.toggle('active', active);
      if (active) {
        node.classList.remove('panel-in');
        void node.offsetWidth;
        node.classList.add('panel-in');
      }
    }
    if (this.panel === 'trackSelect') {
      this.trackRow = 0;
      this.refreshTrackFocus();
    }
  }

  private setCharacter(i: number, sound = false): void {
    if (i < 0 || i >= this.characters.length) return;
    const changed = i !== this.charIndex;
    this.charIndex = i;
    this.charCards.forEach((c, k) => {
      c.classList.toggle('selected', k === i);
      c.classList.toggle('focused', k === i);
    });
    const def = this.characters[i];
    this.charName.set(def.name.toUpperCase());
    this.charTagline.set(tOr(`char.${def.id}.tagline`, def.tagline));
    if (changed) {
      if (sound) events.emit('ui:move', {});
      this.onHighlight?.(def.id);
    }
  }

  private setTrack(i: number, sound = false): void {
    if (i < 0 || i >= this.tracks.length) return;
    const changed = i !== this.trackIndex;
    this.trackIndex = i;
    this.trackCards.forEach((c, k) => c.classList.toggle('selected', k === i));
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
  }

  private setDifficulty(i: number, sound = false): void {
    const changed = i !== this.difficultyIndex;
    this.difficultyIndex = i;
    this.diffButtons.forEach((b, k) => b.classList.toggle('selected', k === i));
    this.diffBlurb.set(t(DIFFICULTY_BLURB[DIFFICULTIES[i]]));
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
  }

  private refreshTrackFocus(): void {
    this.trackCards.forEach((c, k) => c.classList.toggle('focused', this.trackRow === 0 && k === this.trackIndex));
    this.diffButtons.forEach((b, k) =>
      b.classList.toggle('focused', this.trackRow === 1 && k === this.difficultyIndex),
    );
    this.startButton.classList.toggle('focused', this.trackRow === 2);
  }

  private start(): void {
    const track = this.tracks[this.trackIndex];
    const character = this.characters[this.charIndex];
    if (!track || !character) return;
    events.emit('ui:select', {});
    this.onStart?.({
      characterId: character.id,
      trackId: track.id,
      difficulty: DIFFICULTIES[this.difficultyIndex],
      laps: track.laps > 0 ? track.laps : DEFAULT_LAPS,
    });
  }

  private buildCharacterCard(c: CharacterDef): HTMLElement {
    const card = el('div', 'card char-card glass');
    card.tabIndex = -1;
    card.style.setProperty('--card-accent', cssHex(c.color));
    card.style.setProperty('--card-accent-2', cssHex(c.accent));
    card.style.setProperty('--card-glow', cssRgba(c.color, 0.55));
    const swatch = el('div', 'char-swatch', undefined, card);
    swatch.style.background = `linear-gradient(145deg, ${cssHex(c.color)} 0%, ${cssHex(c.accent)} 100%)`;
    const helmet = el('div', 'char-helmet', undefined, swatch);
    helmet.style.background = `radial-gradient(circle at 35% 35%, #fff 0%, ${cssHex(c.driverColor)} 45%, ${cssHex(
      c.accent,
    )} 100%)`;
    el('div', 'char-wheel char-wheel-l', undefined, swatch);
    el('div', 'char-wheel char-wheel-r', undefined, swatch);
    el('div', 'card-name', c.name.toUpperCase(), card);
    if (c.premium) {
      card.dataset.premium = '1';
      this.lockBadges.set(c.id, el('div', 'lock-badge', t('v8.locked'), card));
    }
    el('div', 'card-tag', tOr(`char.${c.id}.tagline`, c.tagline), card);
    const pill = el('div', `pill weight-${c.weightClass}`, t(`weight.${c.weightClass}` as StringKey), card);
    pill.title = t('menu.weightClass');
    const stats = el('div', 'stats', undefined, card);
    for (const s of STAT_KEYS) {
      const row = el('div', 'stat', undefined, stats);
      el('span', 'stat-label', t(s.label), row);
      const bar = el('div', 'stat-bar', undefined, row);
      const fill = el('div', 'stat-fill', undefined, bar);
      const v = Math.max(0, Math.min(1, c.stats[s.key]));
      fill.style.width = `${Math.round(v * 100)}%`;
    }
    return card;
  }

  private buildTrackCard(t: TrackDefinition): HTMLElement {
    const card = el('div', 'card track-card glass');
    card.tabIndex = -1;
    const env = t.environment;
    card.style.setProperty('--card-accent', cssHex(env.skyHorizon));
    card.style.setProperty('--card-glow', cssRgba(env.skyHorizon, 0.5));
    const art = el('div', 'track-art', undefined, card);
    art.style.background = `linear-gradient(180deg, ${cssHex(env.skyTop)} 0%, ${cssHex(env.skyHorizon)} 55%, ${cssHex(
      t.palette.ground,
    )} 56%, ${cssHex(t.palette.ground)} 100%)`;
    const road = el('div', 'track-art-road', undefined, art);
    road.style.background = cssHex(t.palette.road);
    road.style.borderColor = cssHex(t.palette.curb);
    el('div', 'track-theme-pill pill', tt(`theme.${t.theme}` as StringKey), art);
    const body = el('div', 'track-body', undefined, card);
    const nameRow = el('div', 'track-name-row', undefined, body);
    el('div', 'card-name', t.name.toUpperCase(), nameRow);
    const stars = el('div', 'stars', undefined, nameRow);
    for (let i = 0; i < 3; i++) el('span', i < t.difficulty ? 'star on' : 'star', '★', stars);
    el('div', 'card-tag', tOr(`track.${t.id}.desc`, t.description), body);
    const meta = el('div', 'track-meta', undefined, body);
    el('span', 'pill', tt('menu.laps', { n: t.laps }), meta);
    el('span', 'pill', tt(TIER_KEYS[t.difficulty - 1] ?? 'tier.pro'), meta);
    return card;
  }
}
