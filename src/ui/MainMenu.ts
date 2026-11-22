/**
 * Main menu: Title → Character Select → Track Select. Pure DOM; the 3D backdrop
 * behind it is owned by Game (mirrored via onHighlight).
 */
import type { CharacterDef, Difficulty, InputState, RaceSettings, TrackDefinition, RaceMode } from '../core/types';
import { events } from '../core/events';
import { DEFAULT_LAPS, ONLINE_ENABLED } from '../core/constants';
import { PLATFORM } from '../core/platform';
import { button, cssHex, el, TextField } from './dom';
import { icon } from './icons';
import { showToast } from './toast';
import { getLang, setLang, t, t as tt, tOr, type Lang } from '../core/i18n';
import { CUPS, isCupUnlocked, type CupId } from '../core/cups';
import {
  canRace,
  entitlementsPending,
  getCoins,
  getCupProgress,
  getEntitlements,
  getLadder,
  getMissions,
  getStreak,
  getXp,
  isPremium,
  onEntitlementsChange,
  openTrackCount,
  ownsKart,
} from '../verse8/entitlements';
import { finishesToOpen, formatCoins, levelInfo } from '../core/economy';
import { setButtonContent } from './dom';
import { ensureKartThumbnails, getKartThumbnail, onKartThumbnail } from './kartThumbnails';
import { buildTrackThumbnail } from './trackThumbnails';
import { buildLogo } from './logo';
import type { IconName } from './icons';
import type { StringKey } from '../core/i18n';

/** Build stamp, or a placeholder when running somewhere the define is absent (unit tests). */
function buildStamp(): string {
  return typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
}

/** Cup labels are keyed by id at runtime; the locale test covers the same ground. */
type LocaleKey = Parameters<typeof t>[0];
const tk = (key: string): string => t(key as LocaleKey);

/** What each language calls itself. Never translated: this is how someone finds their own. */
const LANGUAGE_NAMES: readonly (readonly [Lang, string])[] = [
  ['ko', '한국어'],
  ['en', 'English'],
];

export type MenuPanel = 'title' | 'characterSelect' | 'trackSelect';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, StringKey> = { easy: 'diff.easy', normal: 'diff.normal', hard: 'diff.hard' };
const RACE_MODES: readonly RaceMode[] = ['solo', 'teamPoints', 'teamFirst'];
const MODE_LABEL: Record<RaceMode, StringKey> = { solo: 'mode.solo', teamPoints: 'mode.teamPoints', teamFirst: 'mode.teamFirst' };
const STAT_KEYS: readonly { key: keyof CharacterDef['stats']; label: StringKey }[] = [
  { key: 'speed', label: 'stat.speed' },
  { key: 'acceleration', label: 'stat.acceleration' },
  { key: 'handling', label: 'stat.handling' },
  { key: 'weight', label: 'stat.weight' },
  { key: 'miniTurbo', label: 'stat.miniTurbo' },
];
/** A stat is shown as this many blocks; a value of 0..1 lights between one and all of them. */
const STAT_BLOCKS = 5;
/** Default character-grid column count (the stylesheet drops to 2 columns on phones). */
const CHAR_COLUMNS = 4;
const TRACK_COLUMNS = 4;
/** The lobby's middle buttons sit two to a row (13-lobby-gate.css); the icon row under them is one row. */
const LOBBY_COLUMNS = 2;

export class MainMenu {
  onStart: ((settings: RaceSettings) => void) | null = null;
  /** Grand Prix: the same race settings, plus the cup whose track list to run. */
  onStartCup: ((cupId: CupId, settings: RaceSettings) => void) | null = null;
  onHighlight: ((characterId: string) => void) | null = null;
  onPanelChange: ((panel: MenuPanel) => void) | null = null;
  /** Player tried to continue with a premium kart they cannot race yet. */
  onLockedAttempt: ((character: CharacterDef) => void) | null = null;
  onRecords: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onGarage: (() => void) | null = null;
  onDaily: (() => void) | null = null;
  onOnline: (() => void) | null = null;
  onMissions: (() => void) | null = null;
  onAttendance: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly panels: Record<MenuPanel, HTMLElement>;
  private panel: MenuPanel = 'title';
  private visible = false;

  // Character select
  private readonly charCards: HTMLElement[] = [];
  /** Cards still showing a colour swatch, waiting for their kart's picture. */
  private readonly thumbTargets = new Map<string, { thumb: HTMLImageElement; card: HTMLElement }>();
  private readonly unsubThumbs: () => void;
  private charIndex = 0;
  private readonly charName: TextField;
  private readonly charTagline: TextField;
  private readonly lockBadges = new Map<string, { badge: HTMLElement; text: TextField }>();
  private readonly coinText: TextField;
  private readonly levelText: TextField;
  private readonly xpFill: HTMLElement;
  private readonly xpText: TextField;
  private readonly streakChip: HTMLElement;
  private readonly streakText: TextField;
  private missionsButton!: HTMLButtonElement;
  private attendanceButton!: HTMLButtonElement;
  /** Per stat, its five blocks in the detail strip under the racer grid. */
  private readonly statCells: HTMLElement[][] = [];
  private readonly unsubEntitlements: () => void;

  // Track select
  private readonly trackCards: HTMLElement[] = [];
  private trackIndex = 0;
  private readonly diffButtons: HTMLElement[] = [];
  private difficultyIndex = 1;
  private modeIndex = 0;
  private lobbyIndex = 0;
  private readonly langButtons: HTMLButtonElement[] = [];
  /** Which language button the keyboard cursor is on, or null while it is on the lobby buttons. */
  private langFocus: number | null = null;
  private readonly lobbyButtons: HTMLButtonElement[] = [];
  /** The lobby buttons as rows of indices into `lobbyButtons`, top to bottom, for the cursor. */
  private readonly lobbyRows: number[][] = [];
  private readonly trackLocks: { chip: HTMLElement; text: TextField }[] = [];
  private readonly modeButtons: HTMLButtonElement[] = [];
  private readonly cupButtons: HTMLButtonElement[] = [];
  private cupIndex = 0;
  private readonly startButton: HTMLElement;
  /** 0 = track cards, 1 = mode, 2 = difficulty, 3 = grand prix cups, 4 = start button. */
  private trackRow = 0;

  constructor(
    root: HTMLElement,
    private readonly characters: readonly CharacterDef[],
    private readonly tracks: readonly TrackDefinition[],
  ) {
    this.rootNode = el('div', 'screen menu hidden', undefined, root);

    // ---------------------------------------------------------------- title
    const title = el('section', 'panel-title-screen', undefined, this.rootNode);
    // Profile bar: what the player has to show for the races so far — level on a plate with the
    // bar to the next one, the wallet, and the check-in run.
    const profile = el('div', 'lobby-profile', undefined, title);
    const levelBox = el('div', 'profile-level', undefined, profile);
    this.levelText = new TextField(el('span', 'plate profile-level-plate', '', levelBox));
    const xpBox = el('div', 'profile-xp', undefined, levelBox);
    this.xpFill = el('i', '', undefined, el('div', 'profile-xp-bar', undefined, xpBox));
    this.xpText = new TextField(el('span', 'profile-xp-n', '', xpBox));
    const coinChip = el('div', 'coin-chip profile-coins', undefined, profile);
    coinChip.title = t('coin.label');
    coinChip.appendChild(icon('coin'));
    this.coinText = new TextField(el('span', 'profile-coins-n', '0', coinChip));
    this.streakChip = el('div', 'profile-streak hidden', undefined, profile);
    this.streakChip.appendChild(icon('flame'));
    this.streakText = new TextField(el('span', 'profile-streak-n', '', this.streakChip));
    buildLogo(title);
    el('div', 'logo-sub', t('title.sub'), title);
    // Lobby: one big RACE plate, the two things a race feeds (garage, missions) under it, and
    // everything else as a row of small icon buttons. Four choices to read, not eight.
    const lobby = el('nav', 'lobby', undefined, title);
    const lobbyGrid = el('div', 'lobby-grid');
    const lobbyIcons = el('div', 'lobby-icons');
    const lobbyEntry = (label: string, cls: string, host: HTMLElement, action: () => void, iconName?: IconName): HTMLButtonElement => {
      const b = button(
        label,
        cls,
        () => {
          events.emit('ui:select', {});
          action();
        },
        iconName,
      );
      b.addEventListener('pointerenter', () => this.setLobby(Math.max(0, this.lobbyButtons.indexOf(b))));
      host.appendChild(b);
      this.lobbyButtons.push(b);
      return b;
    };
    // "Single race" only means something next to an online mode.
    // Online needs the ship switch and a build target that has a relay to race over.
    const online = ONLINE_ENABLED && PLATFORM.online;
    lobbyEntry(online ? t('lobby.single') : t('lobby.race'), 'primary start lobby-btn single-toggle', lobby, () =>
      this.goTo('characterSelect', true),
    );
    lobby.append(lobbyGrid, lobbyIcons);
    lobbyEntry(t('lobby.garage'), 'lobby-btn garage-toggle', lobbyGrid, () => this.onGarage?.(), 'wrench');
    this.missionsButton = lobbyEntry(t('lobby.missions'), 'lobby-btn missions-toggle', lobbyGrid, () => this.onMissions?.(), 'target');
    if (online) lobbyEntry(t('lobby.online'), 'lobby-btn online-toggle', lobbyGrid, () => this.onOnline?.(), 'users');
    const gridEnd = this.lobbyButtons.length;
    // The icon row: its buttons keep their labels for assistive tech and as tooltips.
    const iconEntry = (label: string, cls: string, action: () => void, iconName: IconName): HTMLButtonElement => {
      const b = lobbyEntry(label, `lobby-btn lobby-icon icon-only ${cls}`, lobbyIcons, action, iconName);
      b.title = label;
      return b;
    };
    this.attendanceButton = iconEntry(t('lobby.checkin'), 'attendance-toggle', () => this.onAttendance?.(), 'flame');
    iconEntry(t('lobby.daily'), 'daily-toggle', () => this.onDaily?.(), 'calendar');
    iconEntry(t('lb.button'), 'records-toggle', () => this.onRecords?.(), 'trophy');
    iconEntry(t('lobby.settings'), 'settings-toggle', () => this.onSettings?.(), 'gear');
    this.lobbyRows.push([0]);
    for (let i = 1; i < gridEnd; i += LOBBY_COLUMNS) {
      const row: number[] = [];
      for (let k = i; k < Math.min(gridEnd, i + LOBBY_COLUMNS); k++) row.push(k);
      this.lobbyRows.push(row);
    }
    const iconRow: number[] = [];
    for (let k = gridEnd; k < this.lobbyButtons.length; k++) iconRow.push(k);
    this.lobbyRows.push(iconRow);
    this.setLobby(0);
    // Language, on the first screen and each in its own name: nobody should have to find it inside
    // a settings panel written in a language they cannot read. It sits directly above RACE, the
    // one place every player looks before doing anything. (Switching rebuilds this menu.)
    const langSeg = el('div', 'segmented lobby-lang');
    langSeg.appendChild(icon('globe'));
    for (const [lang, name] of LANGUAGE_NAMES) {
      const b = el('button', 'seg', name, langSeg);
      b.type = 'button';
      b.lang = lang;
      const on = getLang() === lang;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (getLang() === lang) return;
        events.emit('ui:select', {});
        setLang(lang);
      });
      this.langButtons.push(b);
    }
    lobby.insertBefore(langSeg, lobby.firstChild);
    // Build stamp: a QA screenshot of the lobby is then enough to say which build it shows.
    el('div', 'version', buildStamp(), title);

    // ------------------------------------------------------- character select
    const chars = el('section', 'panel-select panel-chars', undefined, this.rootNode);
    const charHead = el('header', 'select-header', undefined, chars);
    el('h2', 'panel-title', t('menu.chooseRacer'), charHead);
    const charGrid = el('div', 'card-grid char-grid', undefined, chars);
    characters.forEach((c, i) => {
      const card = this.buildCharacterCard(c, i);
      card.addEventListener('pointerenter', () => this.setCharacter(i));
      card.addEventListener('click', () => {
        if (this.charIndex === i) this.tryProceed();
        else this.setCharacter(i, true);
      });
      card.addEventListener('dblclick', () => this.tryProceed());
      charGrid.appendChild(card);
      this.charCards.push(card);
    });
    // Detail strip: the cards say who, this says what they are like. One racer's numbers at a
    // time instead of forty stat bars across the grid.
    const charFoot = el('footer', 'select-footer detail', undefined, chars);
    const charInfo = el('div', 'select-info', undefined, charFoot);
    this.charName = new TextField(el('div', 'select-info-name', '', charInfo));
    this.charTagline = new TextField(el('div', 'select-info-tagline', '', charInfo));
    const statBox = el('div', 'stats', undefined, charFoot);
    for (const s of STAT_KEYS) {
      const row = el('div', 'stat', undefined, statBox);
      el('span', 'stat-label', t(s.label), row);
      const blocks = el('span', 'stat-blocks', undefined, row);
      const cells: HTMLElement[] = [];
      for (let k = 0; k < STAT_BLOCKS; k++) cells.push(el('i', '', undefined, blocks));
      this.statCells.push(cells);
    }
    const charActions = el('div', 'actions', undefined, charFoot);
    // Paint where the kart is chosen: picking a kart used to lead straight to the circuit list,
    // so the only way to paint the kart you were about to drive was to back all the way out.
    charActions.appendChild(button(t('menu.paint'), 'ghost paint-toggle', () => this.onGarage?.(), 'spray'));
    charActions.appendChild(button(t('menu.back'), 'ghost back-btn', () => this.goTo('title', true), 'chevron-left'));
    const next = button(t('menu.continue'), 'primary next-btn', () => this.tryProceed());
    next.appendChild(icon('chevron-right'));
    charActions.appendChild(next);

    // ----------------------------------------------------------- track select
    const tr = el('section', 'panel-select panel-tracks', undefined, this.rootNode);
    const trHead = el('header', 'select-header', undefined, tr);
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
          // A tap on a locked circuit says straight away what opens it.
          if (this.isTrackLocked(i)) this.explainLock(i);
        }
      });
      trackGrid.appendChild(card);
      this.trackCards.push(card);
    });
    // Options: three groups, each a title over a segmented control. No explanatory sentences.
    const trFoot = el('footer', 'select-footer options', undefined, tr);
    const optionGroup = (cls: string, title: string): HTMLElement => {
      const wrap = el('div', `option-group ${cls}`, undefined, trFoot);
      el('div', 'option-title', title, wrap);
      return el('div', 'segmented', undefined, wrap);
    };
    // Race mode: solo / team points / team first-place.
    const modeSeg = optionGroup('race-mode', t('menu.mode'));
    RACE_MODES.forEach((m, i) => {
      const b = el('button', 'seg', t(MODE_LABEL[m]), modeSeg);
      b.type = 'button';
      b.addEventListener('pointerenter', () => {
        this.trackRow = 1;
        this.refreshTrackFocus();
      });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.trackRow = 1;
        this.setMode(i, true);
      });
      this.modeButtons.push(b);
    });
    const seg = optionGroup('difficulty', t('menu.difficulty'));
    DIFFICULTIES.forEach((d, i) => {
      const b = el('button', 'seg', t(DIFFICULTY_LABEL[d]), seg);
      b.type = 'button';
      b.addEventListener('pointerenter', () => {
        this.trackRow = 2;
        this.refreshTrackFocus();
      });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.trackRow = 2;
        this.setDifficulty(i, true);
      });
      this.diffButtons.push(b);
    });

    // Grand Prix: a run of races on one ticket, points decide it. Locked cups stay visible with a
    // padlock; pressing one says what unlocks it. A star marks a cup already finished. While the
    // cursor is on a cup, the grid above shows which circuits it runs.
    const cupSeg = optionGroup('cup-row', t('cup.label'));
    cupSeg.classList.add('cup-seg');
    CUPS.forEach((cup, i) => {
      const b = el('button', 'seg cup-chip', undefined, cupSeg);
      b.type = 'button';
      b.appendChild(icon('lock', 'cup-lock'));
      el('span', 'cup-name', tk(`cup.${cup.id}`), b);
      b.appendChild(icon('star', 'cup-star filled'));
      b.addEventListener('pointerenter', () => {
        this.trackRow = 3;
        this.cupIndex = i;
        this.refreshTrackFocus();
      });
      // A mouse that wanders off takes the cup preview with it; a finger has nowhere to wander.
      b.addEventListener('pointerleave', (ev) => {
        if (ev.pointerType !== 'mouse' || this.trackRow !== 3) return;
        this.trackRow = 0;
        this.refreshTrackFocus();
      });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.trackRow = 3;
        this.cupIndex = i;
        this.startCup();
      });
      this.cupButtons.push(b);
    });
    const trActions = el('div', 'actions', undefined, trFoot);
    trActions.appendChild(button(t('menu.back'), 'ghost back-btn', () => this.goTo('characterSelect', true), 'chevron-left'));
    this.startButton = button(t('menu.startRace'), 'primary start', () => this.start());
    this.startButton.addEventListener('pointerenter', () => {
      this.trackRow = 4;
      this.refreshTrackFocus();
    });
    trActions.appendChild(this.startButton);

    this.panels = { title, characterSelect: chars, trackSelect: tr };
    this.unsubThumbs = onKartThumbnail((id, url) => {
      const target = this.thumbTargets.get(id);
      if (!target) return;
      this.thumbTargets.delete(id);
      target.thumb.src = url;
      target.card.classList.add('has-thumb');
    });
    this.unsubEntitlements = onEntitlementsChange(() => {
      this.refreshLocks();
      this.refreshTrackLocks();
      this.refreshProfile();
    });
    this.refreshLocks();
    this.refreshTrackLocks();
    this.refreshProfile();
    this.setCharacter(0);
    this.setTrack(0);
    this.setDifficulty(1);
    this.setMode(0);
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
    this.unsubThumbs();
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
      case 'title': {
        if (this.langFocus !== null) {
          this.handleLangRow(input);
          break;
        }
        if (input.menuUp) this.moveLobby(0, -1);
        else if (input.menuDown) this.moveLobby(0, 1);
        else if (input.menuLeft) this.moveLobby(-1, 0);
        else if (input.menuRight) this.moveLobby(1, 0);
        else if (input.confirm) this.lobbyButtons[this.lobbyIndex]?.click();
        break;
      }
      case 'characterSelect': {
        const n = this.characters.length;
        if (input.menuLeft) this.setCharacter((this.charIndex - 1 + n) % n, true);
        else if (input.menuRight) this.setCharacter((this.charIndex + 1) % n, true);
        else if (input.menuUp) this.setCharacter((this.charIndex - this.charColumns() + n) % n, true);
        else if (input.menuDown) this.setCharacter((this.charIndex + this.charColumns()) % n, true);
        if (input.confirm) this.tryProceed();
        else if (input.back) this.goTo('title', true);
        break;
      }
      case 'trackSelect': {
        if (input.menuUp) this.moveTrackRow(-1);
        else if (input.menuDown) this.moveTrackRow(1);
        else if (input.menuLeft || input.menuRight) {
          const dir = input.menuRight ? 1 : -1;
          if (this.trackRow === 0) {
            const n = this.tracks.length;
            this.setTrack((this.trackIndex + dir + n) % n, true);
          } else if (this.trackRow === 1) {
            this.setMode((this.modeIndex + dir + RACE_MODES.length) % RACE_MODES.length, true);
          } else if (this.trackRow === 2) {
            this.setDifficulty((this.difficultyIndex + dir + 3) % 3, true);
          } else if (this.trackRow === 3) {
            this.cupIndex = (this.cupIndex + dir + CUPS.length) % CUPS.length;
            this.refreshTrackFocus();
            events.emit('ui:move', {});
          } else {
            events.emit('ui:move', {});
          }
        }
        if (input.confirm) {
          if (this.trackRow === 3) this.startCup();
          else this.start();
        } else if (input.back) this.goTo('characterSelect', true);
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

  private refreshProfile(): void {
    this.coinText.set(formatCoins(getCoins()));
    const info = levelInfo(getXp());
    this.levelText.set(t('profile.level', { n: info.level }));
    this.xpFill.style.width = info.need > 0 ? `${Math.round((info.into / info.need) * 100)}%` : '100%';
    this.xpText.set(info.need > 0 ? `${info.into}/${info.need}` : 'MAX');
    const streak = getStreak();
    const run = streak && (streak.claimed || !streak.canRecover) && streak.n > 0 && (streak.claimed || streak.next > 1) ? streak.n : 0;
    this.streakChip.classList.toggle('hidden', run <= 0);
    this.streakText.set(run > 0 ? t('profile.streak', { n: run }) : '');
    // Lobby buttons: missions carry their count, check-in a mark while today is unclaimed.
    const missions = getMissions();
    const done = missions ? missions.list.filter((m) => m.done).length : 0;
    setButtonContent(this.missionsButton, missions ? `${t('lobby.missions')} ${done}/${missions.list.length}` : t('lobby.missions'), 'target');
    this.attendanceButton.classList.toggle('attn', Boolean(streak) && !streak?.claimed);
  }

  private refreshLocks(): void {
    const ent = getEntitlements();
    this.charCards.forEach((card, i) => {
      const def = this.characters[i];
      if (!def || !isPremium(def.id)) return;
      const locked = !canRace(def.id);
      card.classList.toggle('locked', locked);
      const entry = this.lockBadges.get(def.id);
      if (!entry) return;
      // Owned for good, by the pass or with coins: nothing left to say on the card.
      if (ownsKart(def.id)) {
        entry.badge.classList.add('hidden');
        return;
      }
      entry.badge.classList.remove('hidden');
      // Say "checking" rather than "locked" until the account record lands — a phone on a slow
      // connection was telling players a kart they owned tickets for was unavailable.
      const pending = entitlementsPending();
      entry.text.set(pending ? t('v8.checking') : ent.premiumRaces > 0 ? t('v8.ticketsLeft', { n: ent.premiumRaces }) : t('v8.locked'));
      // Red and padlocked only when it really is locked; tickets in hand are not a warning.
      entry.badge.classList.toggle('lock', !pending && ent.premiumRaces <= 0);
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
    // The racer sheet is about to be looked at: its pictures are wanted now.
    if (panel === 'characterSelect') void ensureKartThumbnails(this.characters);
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
      revealCard(this.trackCards[this.trackIndex]);
    } else if (this.panel === 'characterSelect') {
      revealCard(this.charCards[this.charIndex]);
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
    STAT_KEYS.forEach((stat, k) => {
      const lit = Math.max(1, Math.round(Math.max(0, Math.min(1, def.stats[stat.key])) * STAT_BLOCKS));
      this.statCells[k]?.forEach((cell, n) => cell.classList.toggle('on', n < lit));
    });
    if (changed) {
      if (sound) events.emit('ui:move', {});
      this.onHighlight?.(def.id);
    }
    revealCard(this.charCards[i]);
  }

  private setTrack(i: number, sound = false): void {
    if (i < 0 || i >= this.tracks.length) return;
    const changed = i !== this.trackIndex;
    this.trackIndex = i;
    this.trackCards.forEach((c, k) => c.classList.toggle('selected', k === i));
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
    revealCard(this.trackCards[i]);
  }

  private setDifficulty(i: number, sound = false): void {
    const changed = i !== this.difficultyIndex;
    this.difficultyIndex = i;
    this.diffButtons.forEach((b, k) => b.classList.toggle('selected', k === i));
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
  }

  private setLobby(i: number): void {
    this.lobbyIndex = i;
    this.lobbyButtons.forEach((b, k) => b.classList.toggle('focused', k === i));
    this.setLangFocus(null);
  }

  private setLangFocus(i: number | null): void {
    this.langFocus = i;
    this.langButtons.forEach((b, k) => b.classList.toggle('focused', k === i));
    if (i !== null) this.lobbyButtons.forEach((b) => b.classList.remove('focused'));
  }

  /** Keyboard / gamepad on the language row above RACE: left / right pick, confirm applies. */
  private handleLangRow(input: InputState): void {
    const i = this.langFocus ?? 0;
    if (input.menuLeft || input.menuRight) {
      const next = Math.min(this.langButtons.length - 1, Math.max(0, i + (input.menuRight ? 1 : -1)));
      if (next !== i) {
        this.setLangFocus(next);
        events.emit('ui:move', {});
      }
    } else if (input.menuDown) {
      this.setLobby(0);
      events.emit('ui:move', {});
    } else if (input.menuUp) {
      this.setLobby(this.lobbyRows[this.lobbyRows.length - 1]?.[0] ?? 0);
      events.emit('ui:move', {});
    } else if (input.confirm) {
      this.langButtons[i]?.click();
    }
  }

  /**
   * Cursor movement in the lobby: button 0 is the RACE plate, the rest sit in a two-column grid
   * under it. Up / down step a row, left / right step a cell.
   */
  private moveLobby(dx: number, dy: number): void {
    const rows = this.lobbyRows;
    const i = this.lobbyIndex;
    const r = Math.max(0, rows.findIndex((row) => row.includes(i)));
    const c = Math.max(0, rows[r].indexOf(i));
    let next = i;
    if (dx !== 0) {
      next = rows[r][Math.min(rows[r].length - 1, Math.max(0, c + dx))];
    } else {
      const to = r + dy;
      if (to < 0 || to >= rows.length) {
        // Off the top or the bottom is the language row, which sits above RACE; the cursor lands
        // on the language not in use.
        if (this.langButtons.length) {
          this.setLangFocus(Math.max(0, this.langButtons.findIndex((b) => !b.classList.contains('selected'))));
          events.emit('ui:move', {});
          return;
        }
        next = rows[to < 0 ? rows.length - 1 : 0][0];
      } else {
        // Keep roughly the same place across rows of different lengths.
        const from = rows[r].length;
        const into = rows[to].length;
        next = rows[to][from > 1 ? Math.round((c * (into - 1)) / (from - 1)) : 0];
      }
    }
    if (next === i) return;
    this.setLobby(next);
    events.emit('ui:move', {});
  }

  private setMode(i: number, sound = false): void {
    const changed = i !== this.modeIndex;
    this.modeIndex = i;
    this.modeButtons.forEach((b, k) => b.classList.toggle('selected', k === i));
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
  }

  private refreshTrackFocus(): void {
    this.trackCards.forEach((c, k) => c.classList.toggle('focused', this.trackRow === 0 && k === this.trackIndex));
    this.modeButtons.forEach((b, k) => b.classList.toggle('focused', this.trackRow === 1 && k === this.modeIndex));
    this.diffButtons.forEach((b, k) =>
      b.classList.toggle('focused', this.trackRow === 2 && k === this.difficultyIndex),
    );
    this.cupButtons.forEach((b, k) => b.classList.toggle('focused', this.trackRow === 3 && k === this.cupIndex));
    this.startButton.classList.toggle('focused', this.trackRow === 4);
    // With sixteen circuits and five cups, a cup's name no longer says what is in it: dim the rest.
    const cup = this.trackRow === 3 ? CUPS[this.cupIndex] : undefined;
    this.trackCards[0]?.parentElement?.classList.toggle('cup-preview', !!cup);
    this.trackCards.forEach((c, k) => c.classList.toggle('in-cup', !!cup && cup.trackIds.includes(this.tracks[k].id)));
    this.refreshCups();
  }

  /** Lock state and best-finish marker on the cup chips; cheap enough to run with focus changes. */
  private refreshCups(): void {
    const progress = getCupProgress();
    CUPS.forEach((cup, i) => {
      const unlocked = isCupUnlocked(cup.id, progress);
      const b = this.cupButtons[i];
      if (!b) return;
      b.classList.toggle('locked', !unlocked);
      const best = progress[cup.id];
      b.dataset.best = best ? String(best) : '';
      b.title = best ? t('cup.best', { place: String(best), n: String(cup.trackIds.length) }) : '';
    });
  }

  private startCup(): void {
    const cup = CUPS[this.cupIndex];
    const character = this.characters[this.charIndex];
    if (!cup || !character) return;
    if (!isCupUnlocked(cup.id, getCupProgress())) {
      events.emit('ui:back', {});
      this.refreshCups();
      // The unlock rule is said when asked for, not printed under the row all the time.
      showToast(t('cup.locked', { cup: tk(`cup.${cup.requires ?? 'rookie'}`) }), 'info', 3200);
      return;
    }
    events.emit('ui:select', {});
    const first = this.tracks.find((tr) => tr.id === cup.trackIds[0]) ?? this.tracks[0];
    this.onStartCup?.(cup.id, {
      characterId: character.id,
      trackId: first.id,
      difficulty: DIFFICULTIES[this.difficultyIndex],
      mode: 'solo',
      laps: first.laps > 0 ? first.laps : DEFAULT_LAPS,
    });
  }

  /** Circuits open in picker order; `index` is locked while the account has not reached it. */
  private isTrackLocked(index: number): boolean {
    return index >= openTrackCount(this.tracks.length);
  }

  private explainLock(index: number): void {
    const need = finishesToOpen(index);
    showToast(t('track.locked', { n: need, i: Math.min(need, getLadder()?.finishes ?? 0) }), 'info', 3200);
  }

  /** Padlock and "2/5 races" on the circuits still to open. Cups and the daily ignore the lock. */
  private refreshTrackLocks(): void {
    const finishes = getLadder()?.finishes ?? 0;
    this.trackCards.forEach((card, i) => {
      const locked = this.isTrackLocked(i);
      card.classList.toggle('locked', locked);
      const lock = this.trackLocks[i];
      if (!lock) return;
      lock.chip.classList.toggle('hidden', !locked);
      const need = finishesToOpen(i);
      if (locked) lock.text.set(t('track.lockedChip', { i: Math.min(need, finishes), n: need }));
    });
  }

  private start(): void {
    const track = this.tracks[this.trackIndex];
    const character = this.characters[this.charIndex];
    if (!track || !character) return;
    if (this.isTrackLocked(this.trackIndex)) {
      events.emit('ui:back', {});
      this.explainLock(this.trackIndex);
      return;
    }
    events.emit('ui:select', {});
    this.onStart?.({
      characterId: character.id,
      trackId: track.id,
      difficulty: DIFFICULTIES[this.difficultyIndex],
      mode: RACE_MODES[this.modeIndex],
      laps: track.laps > 0 ? track.laps : DEFAULT_LAPS,
    });
  }

  /** Live column count of the character grid (responsive CSS changes it), for up/down navigation. */
  private charColumns(): number {
    return gridColumns(this.charCards, CHAR_COLUMNS);
  }

  private trackColumns(): number {
    return gridColumns(this.trackCards, TRACK_COLUMNS);
  }

  /**
   * Up / down among the circuit cards. Off the top of the grid lands on START, off the bottom on
   * the mode row: the same ring of rows as before, with the grid counting as one tall row.
   */
  private moveTrackRow(dir: number): void {
    if (this.trackRow === 0) {
      const next = this.trackIndex + dir * this.trackColumns();
      if (next >= 0 && next < this.tracks.length) {
        this.setTrack(next, true);
        return;
      }
    }
    this.trackRow = (this.trackRow + (dir > 0 ? 1 : 4)) % 5;
    this.refreshTrackFocus();
    if (this.trackRow === 0) revealCard(this.trackCards[this.trackIndex]);
    events.emit('ui:move', {});
  }

  /** Card: thumbnail with the weight chip (and a lock chip on premium karts), number plate, name. */
  private buildCharacterCard(c: CharacterDef, index: number): HTMLElement {
    const card = el('div', 'card char-card');
    card.tabIndex = -1;
    const swatch = el('div', 'char-swatch', undefined, card);
    // The racer's own colour, flat.
    swatch.style.background = cssHex(c.color);
    const thumb = el('img', 'char-thumb', undefined, swatch);
    thumb.alt = c.name;
    thumb.draggable = false;
    const ready = getKartThumbnail(c.id);
    if (ready) {
      thumb.src = ready;
      card.classList.add('has-thumb');
    } else {
      // Drawn later, one kart at a time (see kartThumbnails.ts): the card fills in when its turn comes.
      this.thumbTargets.set(c.id, { thumb, card });
    }
    if (c.premium) {
      card.dataset.premium = '1';
      const badge = el('div', 'chip lock lock-badge', undefined, card);
      badge.appendChild(icon('lock'));
      const text = new TextField(el('span', 'lock-text', '', badge));
      text.set(t('v8.locked'));
      this.lockBadges.set(c.id, { badge, text });
    }
    const row = el('div', 'char-row', undefined, card);
    el('span', 'plate char-plate', String(index + 1), row);
    el('div', 'card-name', c.name.toUpperCase(), row);
    // On the thumbnail, so a card is two lines tall and sixteen of them fit a screen.
    const weight = el('div', `chip char-weight weight-${c.weightClass}`, t(`weight.${c.weightClass}` as StringKey), swatch);
    weight.title = t('menu.weightClass');
    return card;
  }

  /** Card: painted thumbnail with the theme chip, name, difficulty stars, lap count. */
  private buildTrackCard(t: TrackDefinition): HTMLElement {
    const card = el('div', 'card track-card');
    card.tabIndex = -1;
    const env = t.environment;
    const art = el('div', 'track-art', undefined, card);
    art.style.background = cssHex(env.skyHorizon);
    // Painted course preview: themed horizon + the real track outline on the ground.
    const thumb = buildTrackThumbnail(t).cloneNode(false) as HTMLCanvasElement;
    thumb.className = 'track-thumb';
    thumb.getContext('2d')?.drawImage(buildTrackThumbnail(t), 0, 0);
    art.appendChild(thumb);
    el('div', 'track-theme-chip chip', tt(`theme.${t.theme}` as StringKey), art);
    // Hidden unless the circuit is still to open (refreshTrackLocks).
    const lock = el('div', 'chip lock track-lock hidden', undefined, art);
    lock.appendChild(icon('lock'));
    this.trackLocks.push({ chip: lock, text: new TextField(el('span', 'track-lock-text', '', lock)) });
    const body = el('div', 'track-body', undefined, card);
    const nameRow = el('div', 'track-name-row', undefined, body);
    el('div', 'card-name', t.name.toUpperCase(), nameRow);
    const stars = el('div', 'stars', undefined, nameRow);
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', `${t.difficulty} / 3`);
    for (let i = 0; i < 3; i++) stars.appendChild(icon('star', i < t.difficulty ? 'filled on' : 'off'));
    const meta = el('div', 'track-meta', undefined, body);
    el('span', 'chip', tt('menu.laps', { n: t.laps }), meta);
    return card;
  }
}

/** Live column count of a card grid (responsive CSS changes it), for up / down navigation. */
function gridColumns(cards: readonly HTMLElement[], fallback: number): number {
  const grid = cards[0]?.parentElement;
  if (!grid) return fallback;
  const cols = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
  return cols > 0 ? cols : fallback;
}

/**
 * Scrolls a select panel just far enough that `card` is clear of the panel's top edge and of the
 * strip pinned to its bottom. `scrollIntoView` cannot do this: it does not know about the strip.
 * Does nothing when the panel is hidden or does not scroll.
 */
function revealCard(card: HTMLElement | undefined): void {
  const panel = card?.closest<HTMLElement>('.panel-select');
  if (!card || !panel || panel.scrollHeight <= panel.clientHeight + 1) return;
  const box = card.getBoundingClientRect();
  if (box.height === 0) return;
  const view = panel.getBoundingClientRect();
  const strip = panel.querySelector<HTMLElement>('.select-footer')?.getBoundingClientRect();
  const floor = (strip && strip.top > view.top ? strip.top : view.bottom) - 8;
  const ceiling = view.top + 8;
  if (box.bottom > floor) panel.scrollTop += box.bottom - floor;
  else if (box.top < ceiling) panel.scrollTop -= ceiling - box.top;
}
