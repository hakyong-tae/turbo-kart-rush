/**
 * Post-race standings table with staggered row animation, confetti for a podium
 * finish and Race Again / Change Track / Main Menu actions.
 */
import type { InputState, RaceStanding, RaceMode, Team } from '../core/types';
import { SIDE_COLORS, computeTeamResult, isTeamMode, pointsFor, teamOf } from '../core/teams';
import { events } from '../core/events';
import { formatRaceTime } from '../core/math';
import { localOrdinal, t } from '../core/i18n';
import { unpackCosmetics } from '../core/cosmetics';
import { badgeElement } from './badges';
import { CHARACTERS } from '../kart/roster';
import { getLookThumbnail } from './kartThumbnails';
import { button, cssHex, el, FocusRing, TextField } from './dom';

const CONFETTI_COUNT = 56;
const CONFETTI_COLORS = ['#ffd23f', '#ff3ab8', '#37a8ff', '#7cff6b', '#ff7a2f', '#ffffff'];

export class ResultsScreen {
  onRaceAgain: (() => void) | null = null;
  onChangeTrack: (() => void) | null = null;
  onMainMenu: (() => void) | null = null;
  onRecords: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly heading: TextField;
  private readonly subheading: TextField;
  private readonly rankBanner: TextField;
  private readonly table: HTMLElement;
  private readonly confetti: HTMLElement;
  private readonly focus: FocusRing;
  private visible = false;
  private recordsButton!: HTMLButtonElement;
  private readonly winnerShot: HTMLImageElement;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen results hidden', undefined, root);
    this.confetti = el('div', 'confetti', undefined, this.rootNode);
    this.panel = el('div', 'glass panel results-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('results.kicker'), this.panel);
    // The winner's actual kart, garage look and all — the reward for building one is being seen.
    this.winnerShot = el('img', 'results-winner hidden', undefined, this.panel);
    this.heading = new TextField(el('h2', 'panel-title results-title', '', this.panel));
    this.subheading = new TextField(el('div', 'results-sub', '', this.panel));
    this.rankBanner = new TextField(el('div', 'results-rank hidden', '', this.panel));
    this.table = el('div', 'standings', undefined, this.panel);
    const actions = el('div', 'actions', undefined, this.panel);
    this.focus = new FocusRing((i) => this.activate(i));
    const again = button(t('results.again'), 'primary', () => this.activate(0));
    const change = button(t('results.changeTrack'), '', () => this.activate(1));
    const menu = button(t('results.mainMenu'), 'ghost', () => this.activate(2));
    const records = button(t('lb.button'), 'ghost', () => this.activate(3));
    this.recordsButton = records;
    actions.append(records, again, change, menu);
    this.focus.add(again);
    this.focus.add(change);
    this.focus.add(menu);
    this.focus.add(records);
  }

  show(standings: readonly RaceStanding[], mode: RaceMode = 'solo', online = false): void {
    this.recordsButton.hidden = online;
    this.table.replaceChildren();
    this.confetti.replaceChildren();
    const player = standings.find((s) => s.isPlayer);
    const place = player ? player.place : standings.length;
    this.showWinnerKart(standings[0]);
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
    this.rootNode.remove();
  }

  /** Show a one-line "RANK #n!" under the subheading once the server has ranked the run. */
  showRankBanner(text: string): void {
    this.rankBanner.set(text);
    this.rankBanner.node.classList.remove('hidden');
  }

  private activate(i: number): void {
    events.emit(i === 2 ? 'ui:back' : 'ui:select', {});
    if (i === 0) this.onRaceAgain?.();
    else if (i === 1) this.onChangeTrack?.();
    else if (i === 3) this.onRecords?.();
    else this.onMainMenu?.();
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
