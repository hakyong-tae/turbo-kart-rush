/**
 * Post-race screen. Its job is the next race: the player's place on a big number plate, what the
 * race paid and what it opened, the one unlock that is closest, and a primary button that goes
 * straight to the next circuit. The standings sit beside all that (under it on a narrow window);
 * Race Again, Change Circuit and Lobby are the quieter buttons, records an icon.
 */
import type { InputState, RaceStanding, RaceMode, Team } from '../core/types';
import { SIDE_COLORS, computeTeamResult, isTeamMode, pointsFor, teamOf } from '../core/teams';
import { events } from '../core/events';
import { formatRaceTime } from '../core/math';
import { localOrdinal, t } from '../core/i18n';
import { unpackCosmetics } from '../core/cosmetics';
import type { CupEntry } from '../core/cups';
import { badgeElement } from './badges';
import { CHARACTERS } from '../kart/roster';
import { getLookThumbnail } from './kartThumbnails';
import { button, cssHex, el, setButtonContent, TextField } from './dom';
import { formatCoins, type LevelInfo } from '../core/economy';
import { icon } from './icons';

const CONFETTI_COUNT = 56;
/** Race yellow, white and the two greys of the palette: flag-day paper, not a rainbow. */
const CONFETTI_COLORS = ['#ffd400', '#ffffff', '#b9bdc7', '#ffd400', '#3d4049', '#ffffff'];

/** How long the coin total takes to count up. */
const COUNT_UP_MS = 900;

/** Seconds the primary button takes to fill before it starts the next race by itself. */
export const AUTO_NEXT_SECONDS = 8;
/** How long the standings take to arrive: nothing counts down before they have. */
const AUTO_SETTLE_MS = 2000;

/**
 * How long a reward block needs before the countdown may start under it: the coin count-up, each
 * unlock card's entrance and a moment to read it, a level-up, tomorrow's check-in.
 */
function readingTime(view: RewardView): number {
  if (view.state !== 'paid') return 1200;
  const cards = view.opened?.length ?? 0;
  let ms = COUNT_UP_MS + 600;
  if (cards > 0) ms = Math.max(ms, 500 + cards * 180 + 600) + cards * 900;
  if (view.xp && view.xp.levelUps > 0) ms += 1200;
  if (view.tomorrow) ms += 1500;
  return ms;
}

/**
 * The layouts `fit` tries, in order, until the screen fits its window: whether the blocks about
 * what comes next sit under the table, and how compact the rest is drawn.
 */
/** The table is never squeezed below this (about three rows) to make the panel fit. */
const MIN_TABLE_PX = 90;
const FITS: ReadonlyArray<readonly [aside: boolean, dense: number]> = [
  [false, 0],
  [true, 0],
  [false, 1],
  [true, 1],
  [false, 2],
  [true, 2],
  [false, 3],
  [true, 3],
];

/**
 * What this race paid, as far as it is known. `pending` while the server is still counting,
 * `failed` when it never answered: the screen says which, because "no coins" and "not yet" look
 * the same on an empty line.
 */
export interface RewardView {
  state: 'pending' | 'paid' | 'failed';
  /** Why nothing was paid, already worded. Absent: the server could not be reached. */
  why?: string;
  /** Coins this race paid. */
  coins?: number;
  /** Balance afterwards. */
  balance?: number;
  /** Percent of the table the race was paid at (100 / 30 / 0). */
  rate?: number;
  /** Which race of the day this was. */
  races?: number;
  /** Experience this race added, and where the level bar stands after it. */
  xp?: { earned: number; after: LevelInfo; levelUps: number; levelCoins: number };
  /** Missions this race completed, already worded, with what each paid. */
  missions?: readonly { title: string; coins: number }[];
  /** Coins of the all-three bonus, when this race earned it. */
  bonus?: number;
  /** Missions done today out of how many, after this race. */
  missionCount?: { done: number; total: number };
  /** Names of garage entries this race's level-ups awarded. */
  unlocked?: readonly string[];
  /** The "watch an ad, double the coins" offer is open for this race. */
  canDouble?: boolean;
  /** Coins a doubling added (the offer was taken). */
  doubled?: number;
  /** What this race opened: circuits and garage entries, each with a picture when there is one. */
  opened?: readonly UnlockCard[];
  /** The closest thing still to earn, with how far along it is. */
  nextUnlock?: NextUnlock | null;
  /** Tomorrow's check-in, shown on the day's second race. */
  tomorrow?: TomorrowView | null;
}

/** One thing a race opened. */
export interface UnlockCard {
  kind: 'track' | 'item';
  name: string;
  /** A circuit thumbnail (canvas) or a kart wearing the entry (image URL). */
  image?: HTMLCanvasElement | string;
}

/** "Finish 3 races 2/3 → Sparks trail". */
export interface NextUnlock {
  text: string;
  value: number;
  target: number;
  reward: string;
}

/** Tomorrow's check-in reward. */
export interface TomorrowView {
  coins: number;
  /** Name of the garage entry that comes with it, and a picture of it. */
  gift?: string;
  image?: string;
}

/** Which buttons the screen offers. */
export type ResultsFlow = 'single' | 'cup' | 'online';

/** Time left until the next UTC midnight, as `hh:mm:ss`: when tomorrow's check-in opens. */
export function untilNewDay(now = Date.now()): string {
  const left = Math.max(0, 86400000 - (now % 86400000));
  const two = (n: number): string => String(Math.floor(n)).padStart(2, '0');
  return `${two(left / 3600000)}:${two((left / 60000) % 60)}:${two((left / 1000) % 60)}`;
}

/** What the results screen needs to know about an in-progress cup. */
export interface CupView {
  table: readonly CupEntry[];
  raceIndex: number;
  raceCount: number;
  isFinal: boolean;
}

/** Button order in the foot; `activate` and the focus ring both count in it. */
const enum Action {
  Next,
  Again,
  Change,
  Lobby,
  Records,
}

export class ResultsScreen {
  /** The primary button: on to the next circuit (or the next leg of a cup). */
  onNextRace: (() => void) | null = null;
  onRaceAgain: (() => void) | null = null;
  onChangeTrack: (() => void) | null = null;
  onMainMenu: (() => void) | null = null;
  onRecords: (() => void) | null = null;
  /** Watch an ad to double this race's coins. Game owns the ad and calls `showRewards` again. */
  onDouble: (() => void | Promise<void>) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly main: HTMLElement;
  private readonly side: HTMLElement;
  private readonly onResize = (): void => this.fit();
  private readonly plate: TextField;
  private readonly heading: TextField;
  private readonly subheading: TextField;
  private readonly rankBanner: TextField;
  private readonly table: HTMLElement;
  private readonly confetti: HTMLElement;
  /** Position of the keyboard cursor among the buttons this flow shows. */
  private focusIndex = 0;
  private visible = false;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly winnerShot: HTMLImageElement;
  private readonly cupBox: HTMLElement;
  private readonly rewards: HTMLElement;
  private readonly opened: HTMLElement;
  private readonly nextUnlock: HTMLElement;
  private readonly tomorrow: HTMLElement;
  private countTimer = 0;
  private tomorrowTimer = 0;
  private flow: ResultsFlow = 'single';
  private cupView: CupView | undefined;
  private nextTrack = '';
  /**
   * Auto-advance: once what the race did has been shown, the primary button fills over
   * `AUTO_NEXT_SECONDS` and then starts the next race. Armed by the game per results screen
   * (`armAutoNext`); anything the player does here other than pressing that button calls it off
   * for good (`cancelAutoNext`), and so does the page going out of sight.
   */
  private autoTimer = 0;
  /** No countdown before this moment (ms), and none while the reward is still being counted. */
  private autoReadyAt = 0;
  private autoHold = false;
  /** When the fill started (0 = not yet). */
  private autoStartedAt = 0;
  private readonly autoCount: HTMLElement;
  private readonly onAway = (): void => {
    if (document.hidden) this.cancelAutoNext();
  };
  private readonly onBlur = (): void => this.cancelAutoNext();

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen results hidden', undefined, root);
    this.confetti = el('div', 'confetti', undefined, this.rootNode);
    this.panel = el('div', 'panel results-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('results.kicker'), this.panel);
    // Two columns where the window is wide enough: what the race did for the player on the left,
    // the table on the right. One column otherwise, in that order.
    const body = el('div', 'results-body', undefined, this.panel);
    const main = el('div', 'results-main', undefined, body);
    const side = el('div', 'results-side', undefined, body);
    this.main = main;
    this.side = side;
    // Head: where you finished, on a number plate, with the verdict beside it and the winner's
    // kart at the far end.
    const head = el('div', 'results-head', undefined, main);
    this.plate = new TextField(el('div', 'plate results-plate', '', head));
    const headText = el('div', 'results-head-text', undefined, head);
    this.heading = new TextField(el('h2', 'panel-title results-title', '', headText));
    this.subheading = new TextField(el('div', 'results-sub', '', headText));
    // The winner's actual kart, garage look and all — the reward for building one is being seen.
    this.winnerShot = el('img', 'results-winner hidden', undefined, head);
    this.rankBanner = new TextField(el('div', 'results-rank hidden', '', main));
    // What the race paid, straight under the verdict. Empty (and collapsed) for a race that pays
    // nothing, such as a dev auto-drive.
    this.rewards = el('div', 'results-rewards', undefined, main);
    // What it opened, then the closest thing still to earn, then (once a day) tomorrow's check-in.
    this.opened = el('div', 'results-opened', undefined, main);
    this.nextUnlock = el('div', 'results-next', undefined, main);
    this.tomorrow = el('div', 'results-tomorrow', undefined, main);
    this.table = el('div', 'standings', undefined, side);
    // Cup table: only filled during a Grand Prix, where the race result is half the story.
    this.cupBox = el('div', 'cup-standings hidden', undefined, side);
    const foot = el('div', 'results-foot', undefined, this.panel);
    const actions = el('div', 'actions', undefined, foot);
    this.buttons[Action.Next] = button(t('results.next'), 'primary results-next-btn', () => this.activate(Action.Next));
    this.buttons[Action.Again] = button(t('results.again'), 'results-again', () => this.activate(Action.Again));
    this.buttons[Action.Change] = button(t('results.changeTrack'), '', () => this.activate(Action.Change));
    this.buttons[Action.Lobby] = button(t('results.mainMenu'), 'ghost', () => this.activate(Action.Lobby));
    this.buttons[Action.Records] = button(t('lb.button'), 'ghost icon-only results-records', () => this.activate(Action.Records), 'trophy');
    actions.append(...this.buttons);
    this.autoCount = el('span', 'auto-count');
    // A press anywhere on the screen except the primary button means the player is doing
    // something else here: the countdown is off. (Hovering is not a press.)
    this.rootNode.addEventListener(
      'pointerdown',
      (ev) => {
        if (!this.buttons[Action.Next].contains(ev.target as Node)) this.cancelAutoNext();
      },
      true,
    );
    this.buttons.forEach((b, action) => {
      // Hover moves the cursor too, so mouse and keyboard agree on where it is.
      b.addEventListener('pointerenter', () => {
        const at = this.visibleActions().indexOf(action);
        if (at >= 0) this.setFocus(at);
      });
    });
    this.applyFlow();
  }

  /** Name of the circuit the primary button goes to. Game sets it again when a race opens a new one. */
  setNextTrack(name: string): void {
    this.nextTrack = name;
    this.labelPrimary();
  }

  /**
   * Grand Prix view for a finished race: the running table, which race this was, and whether the
   * cup ends here. Absent for a one-off race.
   */
  show(standings: readonly RaceStanding[], mode: RaceMode = 'solo', online = false, cup?: CupView): void {
    this.cancelAutoNext();
    this.autoReadyAt = Date.now() + AUTO_SETTLE_MS;
    this.autoHold = false;
    this.flow = online ? 'online' : cup ? 'cup' : 'single';
    this.cupView = cup;
    this.applyFlow();
    this.clearRewards();
    this.table.replaceChildren();
    this.confetti.replaceChildren();
    const player = standings.find((s) => s.isPlayer);
    const place = player ? player.place : standings.length;
    // Plate: the place as a bare number; podium places take their metal, a retirement goes red.
    const retired = player ? !isFinite(player.finishTime) || player.finishTime <= 0 : false;
    this.plate.set(retired ? t('results.dnf') : String(place));
    const plateNode = this.plate.node;
    plateNode.classList.toggle('red', retired);
    plateNode.classList.toggle('gold', !retired && place === 1);
    plateNode.classList.toggle('silver', !retired && place === 2);
    plateNode.classList.toggle('bronze', !retired && place === 3);
    this.showWinnerKart(standings[0]);
    this.renderCup(cup);
    const winnerTime = standings.length > 0 ? standings[0].finishTime : 0;
    const teamMode = isTeamMode(mode);
    const teamResult = teamMode ? computeTeamResult(standings, mode) : null;
    const myTeam = player ? (player.team ?? teamOf(player.kartId)) : 'red';
    const teamWon = teamResult ? teamResult.winner === myTeam : false;
    this.table.classList.toggle('team', teamMode);
    this.table.classList.toggle('points', mode === 'teamPoints');

    if (teamResult) {
      // Sides read relative to the viewer, matching the friend-or-foe colours in the HUD.
      const sideName = (tm: Team) => t(tm === myTeam ? 'team.us' : 'team.them');
      const ourPoints = myTeam === 'red' ? teamResult.red : teamResult.blue;
      const theirPoints = myTeam === 'red' ? teamResult.blue : teamResult.red;
      this.heading.set(
        teamResult.winner === 'draw' ? t('results.teamDraw') : t(teamWon ? 'results.teamWin' : 'results.teamLose', { team: sideName(teamResult.winner) }),
      );
      this.subheading.set(
        mode === 'teamPoints'
          ? `${t('team.us')} ${ourPoints}  :  ${theirPoints} ${t('team.them')}`
          : t('results.firstRule', { team: teamResult.firstTeam ? sideName(teamResult.firstTeam) : '—' }),
      );
      this.panel.classList.toggle('gold', teamWon);
      this.panel.classList.toggle('team-us', teamWon);
      this.panel.classList.toggle('team-them', teamResult.winner !== 'draw' && !teamWon);
    } else {
      this.heading.set(place === 1 ? t('results.victory') : t('results.place', { ord: localOrdinal(place).toUpperCase() }));
      this.subheading.set(
        place === 1
          ? t('results.sub.win')
          : place <= 3
            ? t('results.sub.podium')
            : place <= 5
              ? t('results.sub.mid')
              : t('results.sub.rough'),
      );
      this.panel.classList.toggle('gold', place === 1);
      this.panel.classList.remove('team-us', 'team-them');
    }
    this.rankBanner.set('');
    this.rankBanner.node.classList.add('hidden');

    standings.forEach((s, i) => {
      const row = el('div', 'standing-row', undefined, this.table);
      row.style.animationDelay = `${0.12 + i * 0.09}s`;
      if (s.isPlayer) row.classList.add('you');
      // A phone shows the top three and the player; everyone else is a row it has no room for.
      if (i >= 3 && !s.isPlayer) row.classList.add('extra');
      if (s.place <= 3) row.classList.add(`podium-${s.place}`);
      const team = s.team ?? teamOf(s.kartId);
      const ally = team === myTeam;
      if (teamMode) row.classList.add(ally ? 'side-ally' : 'side-rival');
      el('span', 'standing-place', localOrdinal(s.place), row);
      const chip = el('span', 'standing-chip', undefined, row);
      chip.style.background = cssHex(teamMode ? SIDE_COLORS[ally ? 'ally' : 'rival'] : s.color);
      const nameCell = el('span', 'standing-name', undefined, row);
      const badge = badgeElement(unpackCosmetics(s.cos).badge);
      if (badge) nameCell.appendChild(badge);
      nameCell.appendChild(document.createTextNode(s.name + (s.isPlayer ? `  ${t('results.you')}` : '')));
      const time = s.finishTime;
      const label =
        !isFinite(time) || time <= 0
          ? t('results.dnf')
          : i === 0
            ? formatRaceTime(time)
            : `+${(time - winnerTime).toFixed(3)}`;
      el('span', 'standing-time', label, row);
      if (mode === 'teamPoints') {
        const pts = pointsFor(s.place, s.finishTime);
        el('span', `standing-points${pts === 0 ? ' zero' : ''}`, t('results.points', { n: pts }), row);
      }
    });

    if (teamResult ? teamWon : place <= 3) this.spawnConfetti();

    this.setFocus(0);
    this.rootNode.classList.remove('hidden');
    this.panel.classList.remove('panel-in');
    void this.panel.offsetWidth;
    this.panel.classList.add('panel-in');
    this.visible = true;
    window.addEventListener('resize', this.onResize);
    this.fit();
    // Text set before its font has arrived is measured in the fallback face: measure again.
    void document.fonts?.ready.then(() => this.fit());
  }

  /**
   * Makes the whole screen fit its window, whatever the race dealt.
   *
   * A race can put a lot here at once: up to six unlock cards, a level-up, three missions and
   * their bonus, tomorrow's check-in. The ordinary layout holds the usual hand; the full one is
   * taller than a phone held sideways or a portal's small frame, and the panel then scrolled,
   * with the buttons under the fold. So the panel is measured, and the first of these layouts
   * that is not taller than its window is used (`FITS`; styles at the end of 20-results.css):
   *
   *   aside    the two blocks about what comes next (next unlock, tomorrow) sit under the table,
   *            where a short table leaves room. Tried at every step, kept only where it helps.
   *   dense 1  the unlock cards lose their caption and come in a size: picture and name
   *   dense 2  the head and the reward line come in a size, the verdict's second line goes
   *   dense 3  tomorrow's check-in is one line, the next unlock gives way
   *
   * Nothing the race did is dropped by any of them: every card, the coins, the level-up and each
   * mission stay on screen, and no text goes under 11 px. Where it is the table that is too tall
   * for the window, the table is what scrolls (as it always has on a desktop).
   */
  private fit(): void {
    if (!this.visible) return;
    const over = (): number => this.panel.scrollHeight - this.panel.clientHeight;
    this.table.style.maxHeight = '';
    this.table.style.overflowY = '';
    let best: { aside: boolean; dense: number; over: number } | null = null;
    for (const [aside, dense] of FITS) {
      this.layOut(aside, dense);
      const by = over();
      if (by <= 1) return;
      if (!best || by < best.over) best = { aside, dense, over: by };
    }
    // Nothing fits as it stands. Where the table is the tall column (two tables in a Grand
    // Prix, a long table beside a short left column), folding the left column is no help: the
    // least folded layout the table can make room for is used, and the table scrolls.
    for (const [aside, dense] of FITS) {
      this.layOut(aside, dense);
      const room = this.table.clientHeight - over();
      if (this.side.offsetHeight < this.main.offsetHeight || room < MIN_TABLE_PX) continue;
      this.table.style.maxHeight = `${room}px`;
      this.table.style.overflowY = 'auto';
      // The left column may be too tall as well: then this layout is not the one.
      if (over() <= 1) return;
      this.table.style.maxHeight = '';
      this.table.style.overflowY = '';
    }
    if (best) this.layOut(best.aside, best.dense);
  }

  private layOut(aside: boolean, dense: number): void {
    if (dense > 0) this.panel.dataset.dense = String(dense);
    else delete this.panel.dataset.dense;
    this.panel.toggleAttribute('data-aside', aside);
    const home = aside ? this.side : this.main;
    if (this.nextUnlock.parentNode !== home) home.append(this.nextUnlock, this.tomorrow);
  }

  hide(): void {
    window.removeEventListener('resize', this.onResize);
    this.rootNode.classList.add('hidden');
    this.confetti.replaceChildren();
    this.stopCount();
    this.stopTomorrow();
    this.cancelAutoNext();
    this.visible = false;
  }

  /**
   * Lets this results screen go on to the next race by itself. The game calls it when that is
   * wanted here (not after a retirement, a cup's last race, an online race, the daily, and not
   * when the player has turned it off or looks to have walked away).
   */
  armAutoNext(): void {
    if (!this.visible || this.autoTimer || this.flow === 'online') return;
    this.autoStartedAt = 0;
    document.addEventListener('visibilitychange', this.onAway);
    window.addEventListener('blur', this.onBlur);
    this.autoTimer = window.setInterval(() => this.tickAuto(), 100);
  }

  /** Calls the countdown off. It does not come back on this results screen. */
  cancelAutoNext(): void {
    if (!this.autoTimer) return;
    window.clearInterval(this.autoTimer);
    this.autoTimer = 0;
    this.autoStartedAt = 0;
    document.removeEventListener('visibilitychange', this.onAway);
    window.removeEventListener('blur', this.onBlur);
    const b = this.buttons[Action.Next];
    b.classList.remove('auto');
    b.style.removeProperty('--auto');
    this.autoCount.remove();
  }

  /** Seconds until the next race starts by itself; null when no countdown is running. */
  get autoNextLeft(): number | null {
    if (!this.autoTimer || !this.autoStartedAt) return null;
    return Math.max(0, AUTO_NEXT_SECONDS - (Date.now() - this.autoStartedAt) / 1000);
  }

  private tickAuto(): void {
    if (!this.autoTimer) return;
    if (document.hidden) {
      this.cancelAutoNext();
      return;
    }
    const now = Date.now();
    if (this.autoHold || now < this.autoReadyAt) return;
    const b = this.buttons[Action.Next];
    if (!this.autoStartedAt) {
      this.autoStartedAt = now;
      b.classList.add('auto');
    }
    const left = AUTO_NEXT_SECONDS * 1000 - (now - this.autoStartedAt);
    b.style.setProperty('--auto', String(Math.min(1, 1 - left / (AUTO_NEXT_SECONDS * 1000))));
    this.autoCount.textContent = String(Math.max(0, Math.ceil(left / 1000)));
    if (this.autoCount.parentElement !== b) b.appendChild(this.autoCount);
    if (left <= 0) {
      this.cancelAutoNext();
      this.activate(Action.Next);
    }
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.menuLeft || input.menuUp) {
      this.cancelAutoNext();
      if (this.setFocus(this.focusIndex - 1)) events.emit('ui:move', {});
    } else if (input.menuRight || input.menuDown) {
      this.cancelAutoNext();
      if (this.setFocus(this.focusIndex + 1)) events.emit('ui:move', {});
    }
    if (input.confirm) this.activate(this.visibleActions()[this.focusIndex] ?? Action.Lobby);
    else if (input.back) this.activate(Action.Lobby);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.stopCount();
    this.stopTomorrow();
    this.cancelAutoNext();
    this.rootNode.remove();
  }

  /** Show a one-line "RANK #n!" under the subheading once the server has ranked the run. */
  showRankBanner(text: string): void {
    this.rankBanner.set(text);
    this.rankBanner.node.classList.remove('hidden');
    this.fit();
  }

  /**
   * Fills the reward line. Called again when the server's answer lands after the screen opened.
   */
  showRewards(view: RewardView): void {
    // The countdown waits for the reward: none while it is still being counted, and a block
    // that has just been (re)drawn gets its time on screen first.
    this.autoHold = view.state === 'pending';
    this.autoReadyAt = Math.max(this.autoReadyAt, Date.now() + readingTime(view));
    if (this.autoStartedAt) {
      this.autoStartedAt = 0;
      this.buttons[Action.Next].classList.remove('auto');
      this.autoCount.remove();
    }
    this.clearRewards();
    const row = el('div', `reward-row reward-${view.state}`, undefined, this.rewards);
    if (view.state !== 'paid') {
      el('span', 'reward-note', view.state === 'pending' ? t('rewards.pending') : (view.why ?? t('rewards.failed')), row);
      this.fit();
      return;
    }
    this.renderOpened(view.opened ?? []);
    this.renderNextUnlock(view.nextUnlock ?? null);
    this.renderTomorrow(view.tomorrow ?? null);
    const doubled = Math.max(0, Math.floor(view.doubled ?? 0));
    const coins = Math.max(0, Math.floor(view.coins ?? 0)) + doubled;
    el('span', 'reward-label', t('rewards.race'), row);
    const amount = el('span', 'reward-amount', undefined, row);
    amount.appendChild(icon('coin'));
    const number = el('span', 'reward-number', `+${formatCoins(coins)}`, amount);
    // The number counts up from zero. It is given the width of where it ends now, so that the
    // line is laid out once: measured at "+0", an offer that fitted beside it wrapped under it
    // a second later, and a screen that had been made to fit no longer did.
    // In ems, because the layouts `fit` tries draw the number at different sizes.
    const size = parseFloat(getComputedStyle(number).fontSize) || 0;
    if (size > 0) number.style.minWidth = `${(number.getBoundingClientRect().width / size).toFixed(3)}em`;
    number.textContent = '+0';
    if (view.xp) {
      // Level plate, the bar toward the next one, and what this race put into it.
      const xp = el('span', 'reward-xp', undefined, row);
      el('span', 'plate reward-level', t('profile.level', { n: view.xp.after.level }), xp);
      const fill = el('i', '', undefined, el('span', 'reward-xp-bar', undefined, xp));
      fill.style.width = view.xp.after.need > 0 ? `${Math.round((view.xp.after.into / view.xp.after.need) * 100)}%` : '100%';
      el('span', 'reward-xp-n', t('rewards.xp', { n: view.xp.earned }), xp);
    }
    if (view.balance !== undefined) el('span', 'reward-balance', t('rewards.balance', { n: formatCoins(view.balance) }), row);
    if (view.canDouble) {
      const b = button(t('rewards.double'), 'reward-double', () => void this.double(b), 'ad');
      row.appendChild(b);
    }

    // Everything else the race did, one short line each: they wrap, and on a phone they scroll.
    const notes = el('div', 'reward-notes', undefined, this.rewards);
    const note = (text: string, cls = ''): HTMLElement => el('span', `reward-note${cls ? ` ${cls}` : ''}`, text, notes);
    if (doubled > 0) note(t('rewards.doubled', { n: formatCoins(doubled) }), 'good');
    if (view.xp && view.xp.levelUps > 0) {
      note(t('rewards.levelUp', { n: view.xp.after.level, coins: formatCoins(view.xp.levelCoins) }), 'level-up');
    }
    for (const m of view.missions ?? []) note(t('rewards.mission', { name: m.title, n: formatCoins(m.coins) }), 'good');
    if (view.bonus) note(t('rewards.bonus', { n: formatCoins(view.bonus) }), 'good');
    // Anything opened that has no card of its own (a caller that sent names only) is still said.
    if (!view.opened?.length) for (const name of view.unlocked ?? []) note(t('rewards.unlocked', { name }), 'good');
    if (view.missionCount) note(t('rewards.missions', { done: view.missionCount.done, n: view.missionCount.total }));
    if (view.rate !== undefined && view.rate < 100) {
      note(t(view.rate > 0 ? 'rewards.reduced' : 'rewards.capped', { n: String(view.races ?? 0), pct: String(view.rate) }));
    }
    // Counted on a timer, not on animation frames: a results screen opened in a background tab
    // must still end up showing the real number.
    const started = Date.now();
    const tick = (): void => {
      const k = Math.min(1, (Date.now() - started) / COUNT_UP_MS);
      number.textContent = `+${formatCoins(Math.round(coins * (1 - (1 - k) * (1 - k))))}`;
      if (k >= 1) this.stopCount();
    };
    this.countTimer = window.setInterval(tick, 40);
    tick();
    this.fit();
  }

  private async double(b: HTMLButtonElement): Promise<void> {
    this.cancelAutoNext();
    if (b.disabled) return;
    b.disabled = true;
    try {
      await this.onDouble?.();
    } finally {
      // Game redraws the line on success; on a declined ad the same offer is live again.
      if (b.isConnected) b.disabled = false;
    }
  }

  private stopCount(): void {
    if (this.countTimer) window.clearInterval(this.countTimer);
    this.countTimer = 0;
  }

  private clearRewards(): void {
    this.stopCount();
    this.stopTomorrow();
    this.rewards.replaceChildren();
    this.opened.replaceChildren();
    this.nextUnlock.replaceChildren();
    this.tomorrow.replaceChildren();
  }

  /** "NEW CIRCUIT · Dune Drift", "NEW IN THE GARAGE · Checker livery": one card each. */
  private renderOpened(cards: readonly UnlockCard[]): void {
    this.opened.replaceChildren();
    cards.forEach((card, i) => {
      const node = el('div', `unlock-card ${card.kind}`, undefined, this.opened);
      node.style.animationDelay = `${0.5 + i * 0.18}s`;
      const art = el('div', 'unlock-art', undefined, node);
      if (typeof card.image === 'string') {
        const img = el('img', '', undefined, art);
        img.src = card.image;
        img.alt = '';
        img.draggable = false;
      } else if (card.image) {
        art.appendChild(card.image);
      } else {
        art.appendChild(icon(card.kind === 'track' ? 'flag' : 'star'));
      }
      const text = el('div', 'unlock-text', undefined, node);
      el('span', 'unlock-label', t(card.kind === 'track' ? 'results.newTrack' : 'results.newItem'), text);
      el('span', 'unlock-name', card.name, text);
    });
  }

  private renderNextUnlock(next: NextUnlock | null): void {
    this.nextUnlock.replaceChildren();
    if (!next) return;
    el('span', 'next-label', t('results.nextUnlock'), this.nextUnlock);
    el('span', 'next-text', next.text, this.nextUnlock);
    const fill = el('i', '', undefined, el('span', 'next-bar', undefined, this.nextUnlock));
    fill.style.width = `${Math.round((Math.min(next.value, next.target) / Math.max(1, next.target)) * 100)}%`;
    el('span', 'next-count', `${Math.min(next.value, next.target)}/${next.target}`, this.nextUnlock);
    const reward = el('span', 'next-reward', undefined, this.nextUnlock);
    reward.append(icon('chevron-right'), document.createTextNode(next.reward));
  }

  /** Tomorrow's check-in: what it pays, what comes with it, and how long until it opens. */
  private renderTomorrow(view: TomorrowView | null): void {
    this.stopTomorrow();
    this.tomorrow.replaceChildren();
    if (!view) return;
    if (view.image) {
      const img = el('img', 'tomorrow-art', undefined, this.tomorrow);
      img.src = view.image;
      img.alt = '';
      img.draggable = false;
    }
    const text = el('div', 'tomorrow-text', undefined, this.tomorrow);
    el('span', 'tomorrow-label', t('tomorrow.title'), text);
    el(
      'span',
      'tomorrow-what',
      view.gift ? t('tomorrow.gift', { n: formatCoins(view.coins), name: view.gift }) : t('tomorrow.coins', { n: formatCoins(view.coins) }),
      text,
    );
    const clock = el('span', 'tomorrow-in', '', text);
    const tick = (): void => {
      clock.textContent = t('tomorrow.in', { time: untilNewDay() });
    };
    tick();
    this.tomorrowTimer = window.setInterval(tick, 1000);
  }

  private stopTomorrow(): void {
    if (this.tomorrowTimer) window.clearInterval(this.tomorrowTimer);
    this.tomorrowTimer = 0;
  }

  /** The buttons this flow offers, in focus order. */
  private visibleActions(): Action[] {
    if (this.flow === 'online') return [Action.Again, Action.Change, Action.Lobby];
    if (this.flow === 'cup') return [Action.Next, Action.Change, Action.Lobby, Action.Records];
    return [Action.Next, Action.Again, Action.Change, Action.Lobby, Action.Records];
  }

  /**
   * A one-off race: NEXT RACE first, RACE AGAIN beside it. A cup: the primary carries the cup
   * through and there is nothing to race again. Online: back to the room is the one way on.
   */
  private applyFlow(): void {
    const shown = this.visibleActions();
    this.buttons.forEach((b, i) => {
      b.hidden = !shown.includes(i);
    });
    this.buttons[Action.Again].classList.toggle('primary', this.flow === 'online');
    this.setFocus(0);
    this.labelPrimary();
  }

  /** Moves the keyboard cursor (wrapping). False when it was already there. */
  private setFocus(i: number): boolean {
    const shown = this.visibleActions();
    const n = shown.length;
    const at = ((i % n) + n) % n;
    const target = this.buttons[shown[at]];
    const moved = at !== this.focusIndex || !target.classList.contains('focused');
    this.buttons.forEach((b) => b.classList.toggle('focused', b === target));
    this.focusIndex = at;
    return moved;
  }

  private labelPrimary(): void {
    const cup = this.flow === 'cup' ? this.cupView : undefined;
    const label = cup
      ? cup.isFinal
        ? t('cup.finish')
        : t('cup.next')
      : this.nextTrack
        ? t('results.nextOn', { name: this.nextTrack.toUpperCase() })
        : t('results.next');
    setButtonContent(this.buttons[Action.Next], label);
    // The label was rebuilt: the seconds beside it go back in while a countdown is running.
    if (this.autoStartedAt) this.buttons[Action.Next].appendChild(this.autoCount);
  }

  private activate(action: Action): void {
    this.cancelAutoNext();
    events.emit(action === Action.Lobby ? 'ui:back' : 'ui:select', {});
    if (action === Action.Next) this.onNextRace?.();
    else if (action === Action.Again) this.onRaceAgain?.();
    else if (action === Action.Change) this.onChangeTrack?.();
    else if (action === Action.Records) this.onRecords?.();
    else this.onMainMenu?.();
  }

  private renderCup(cup: CupView | undefined): void {
    this.cupBox.replaceChildren();
    this.cupBox.classList.toggle('hidden', !cup);
    if (!cup) return;
    const head = el('div', 'cup-standings-head', undefined, this.cupBox);
    el('span', 'cup-standings-title', t('cup.standings'), head);
    el('span', 'cup-standings-round', t('cup.race', { i: String(cup.raceIndex + 1), n: String(cup.raceCount) }), head);
    for (let i = 0; i < cup.table.length; i++) {
      const e = cup.table[i];
      const row = el('div', 'cup-standing' + (e.isPlayer ? ' you' : ''), undefined, this.cupBox);
      el('span', 'cup-standing-place', String(i + 1), row);
      const name = el('span', 'cup-standing-name', undefined, row);
      const badge = badgeElement(unpackCosmetics(e.cos).badge);
      if (badge) name.appendChild(badge);
      name.appendChild(document.createTextNode(e.name));
      el('span', 'cup-standing-points', t('cup.points', { n: String(e.points) }), row);
    }
  }

  /** Shows the winner's kart when they were wearing something; hidden for a bare default look. */
  private showWinnerKart(winner: RaceStanding | undefined): void {
    const url = winner?.characterId
      ? getLookThumbnail(winner.characterId, winner.cos, CHARACTERS.find((c) => c.id === winner.characterId))
      : undefined;
    this.winnerShot.classList.toggle('hidden', !url);
    if (url) this.winnerShot.src = url;
  }

  private spawnConfetti(): void {
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const piece = el('span', 'confetti-piece', undefined, this.confetti);
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDelay = `${Math.random() * 2.5}s`;
      piece.style.animationDuration = `${3 + Math.random() * 2.5}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.style.width = `${6 + Math.random() * 8}px`;
      piece.style.height = `${10 + Math.random() * 10}px`;
    }
  }
}
