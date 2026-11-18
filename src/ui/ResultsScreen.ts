/**
 * Post-race screen: the player's place on a big number plate, the standings table, confetti for
 * a podium finish and Race Again / Change Circuit / Lobby actions (records as an icon button).
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
import { button, cssHex, el, FocusRing, setButtonContent, TextField } from './dom';
import { formatCoins } from '../core/economy';
import { icon } from './icons';

const CONFETTI_COUNT = 56;
/** Race yellow, white and the two greys of the palette: flag-day paper, not a rainbow. */
const CONFETTI_COLORS = ['#ffd400', '#ffffff', '#b9bdc7', '#ffd400', '#3d4049', '#ffffff'];

/** How long the coin total takes to count up. */
const COUNT_UP_MS = 900;

/**
 * What this race paid, as far as it is known. `pending` while the server is still counting,
 * `failed` when it never answered: the screen says which, because "no coins" and "not yet" look
 * the same on an empty line.
 */
export interface RewardView {
  state: 'pending' | 'paid' | 'failed';
  /** Coins this race paid. */
  coins?: number;
  /** Balance afterwards. */
  balance?: number;
  /** Percent of the table the race was paid at (100 / 30 / 0). */
  rate?: number;
  /** Which race of the day this was. */
  races?: number;
}

/** What the results screen needs to know about an in-progress cup. */
export interface CupView {
  table: readonly CupEntry[];
  raceIndex: number;
  raceCount: number;
  isFinal: boolean;
}

export class ResultsScreen {
  onRaceAgain: (() => void) | null = null;
  onChangeTrack: (() => void) | null = null;
  onMainMenu: (() => void) | null = null;
  onRecords: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly plate: TextField;
  private readonly heading: TextField;
  private readonly subheading: TextField;
  private readonly rankBanner: TextField;
  private readonly table: HTMLElement;
  private readonly confetti: HTMLElement;
  private readonly focus: FocusRing;
  private visible = false;
  private recordsButton!: HTMLButtonElement;
  private againButton!: HTMLButtonElement;
  private readonly winnerShot: HTMLImageElement;
  private readonly cupBox: HTMLElement;
  private readonly rewards: HTMLElement;
  private countTimer = 0;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen results hidden', undefined, root);
    this.confetti = el('div', 'confetti', undefined, this.rootNode);
    this.panel = el('div', 'panel results-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('results.kicker'), this.panel);
    // Head: the one thing this screen is for — where you finished — on a number plate, with the
    // verdict beside it and the winner's kart at the far end.
    const head = el('div', 'results-head', undefined, this.panel);
    this.plate = new TextField(el('div', 'plate results-plate', '', head));
    const headText = el('div', 'results-head-text', undefined, head);
    this.heading = new TextField(el('h2', 'panel-title results-title', '', headText));
    this.subheading = new TextField(el('div', 'results-sub', '', headText));
    // The winner's actual kart, garage look and all — the reward for building one is being seen.
    this.winnerShot = el('img', 'results-winner hidden', undefined, head);
    this.rankBanner = new TextField(el('div', 'results-rank hidden', '', this.panel));
    this.table = el('div', 'standings', undefined, this.panel);
    // Cup table: only filled during a Grand Prix, where the race result is half the story.
    this.cupBox = el('div', 'cup-standings hidden', undefined, this.panel);
    // What the race paid: between the table and the buttons. Empty (and collapsed) for a race
    // that pays nothing, such as a dev auto-drive.
    // It shares the sticky foot with the buttons, so it stays on screen when the tables scroll.
    const foot = el('div', 'results-foot', undefined, this.panel);
    this.rewards = el('div', 'results-rewards', undefined, foot);
    const actions = el('div', 'actions', undefined, foot);
    this.focus = new FocusRing((i) => this.activate(i));
    const again = button(t('results.again'), 'primary', () => this.activate(0));
    this.againButton = again;
    const change = button(t('results.changeTrack'), '', () => this.activate(1));
    const menu = button(t('results.mainMenu'), 'ghost', () => this.activate(2));
    const records = button(t('lb.button'), 'ghost icon-only results-records', () => this.activate(3), 'trophy');
    this.recordsButton = records;
    actions.append(again, change, menu, records);
    this.focus.add(again);
    this.focus.add(change);
    this.focus.add(menu);
    this.focus.add(records);
  }

  /**
   * Grand Prix view for a finished race: the running table, which race this was, and whether the
   * cup ends here. Absent for a one-off race.
   */
  show(standings: readonly RaceStanding[], mode: RaceMode = 'solo', online = false, cup?: CupView): void {
    this.recordsButton.hidden = online;
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

    this.focus.set(0);
    this.rootNode.classList.remove('hidden');
    this.panel.classList.remove('panel-in');
    void this.panel.offsetWidth;
    this.panel.classList.add('panel-in');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.confetti.replaceChildren();
    this.stopCount();
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.menuLeft || input.menuUp) {
      if (this.focus.move(-1)) events.emit('ui:move', {});
    } else if (input.menuRight || input.menuDown) {
      if (this.focus.move(1)) events.emit('ui:move', {});
    }
    if (input.confirm) this.focus.activate();
    else if (input.back) this.activate(2);
  }

  dispose(): void {
    this.stopCount();
    this.rootNode.remove();
  }

  /** Show a one-line "RANK #n!" under the subheading once the server has ranked the run. */
  showRankBanner(text: string): void {
    this.rankBanner.set(text);
    this.rankBanner.node.classList.remove('hidden');
  }

  /**
   * Fills the reward line. Called again when the server's answer lands after the screen opened.
   */
  showRewards(view: RewardView): void {
    this.clearRewards();
    const row = el('div', `reward-row reward-${view.state}`, undefined, this.rewards);
    if (view.state !== 'paid') {
      el('span', 'reward-note', t(view.state === 'pending' ? 'rewards.pending' : 'rewards.failed'), row);
      return;
    }
    const coins = Math.max(0, Math.floor(view.coins ?? 0));
    el('span', 'reward-label', t('rewards.race'), row);
    const amount = el('span', 'reward-amount', undefined, row);
    amount.appendChild(icon('coin'));
    const number = el('span', 'reward-number', '+0', amount);
    if (view.balance !== undefined) el('span', 'reward-balance', t('rewards.balance', { n: formatCoins(view.balance) }), row);
    if (view.rate !== undefined && view.rate < 100) {
      el(
        'div',
        'reward-note',
        t(view.rate > 0 ? 'rewards.reduced' : 'rewards.capped', { n: String(view.races ?? 0), pct: String(view.rate) }),
        this.rewards,
      );
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
  }

  private stopCount(): void {
    if (this.countTimer) window.clearInterval(this.countTimer);
    this.countTimer = 0;
  }

  private clearRewards(): void {
    this.stopCount();
    this.rewards.replaceChildren();
  }

  private activate(i: number): void {
    events.emit(i === 2 ? 'ui:back' : 'ui:select', {});
    if (i === 0) this.onRaceAgain?.();
    else if (i === 1) this.onChangeTrack?.();
    else if (i === 3) this.onRecords?.();
    else this.onMainMenu?.();
  }

  private renderCup(cup: CupView | undefined): void {
    this.cupBox.replaceChildren();
    this.cupBox.classList.toggle('hidden', !cup);
    // The primary action carries the cup through: another race, or the final tally.
    setButtonContent(this.againButton, cup ? (cup.isFinal ? t('cup.finish') : t('cup.next')) : t('results.again'));
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
