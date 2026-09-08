/**
 * Top-centre team read-out for team races: provisional points by current place (points mode)
 * or which team currently holds P1 (first-place mode). Hidden in solo.
 */
import type { IKart, RaceMode } from '../../core/types';
import { t } from '../../core/i18n';
import { isTeamMode, pointsFor, teamOf } from '../../core/teams';
import { TextField, el } from '../dom';

export class TeamTally {
  readonly root: HTMLElement;
  private readonly red: TextField;
  private readonly mid: TextField;
  private readonly blue: TextField;
  private mode: RaceMode = 'solo';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-team glass', undefined, parent);
    this.red = new TextField(el('span', 'hud-team-red', '', this.root));
    this.mid = new TextField(el('span', 'hud-team-mid', '', this.root));
    this.blue = new TextField(el('span', 'hud-team-blue', '', this.root));
  }

  setMode(mode: RaceMode): void {
    this.mode = mode;
    this.root.classList.toggle('visible', isTeamMode(mode));
    this.mid.set(mode === 'teamFirst' ? t('hud.team.first') : ':');
  }

  update(karts: readonly IKart[]): void {
    if (!isTeamMode(this.mode)) return;
    if (this.mode === 'teamPoints') {
      let red = 0;
      let blue = 0;
      for (let i = 0; i < karts.length; i++) {
        const s = karts[i].state;
        const pts = s.finished ? pointsFor(s.place, s.finishTime) : pointsFor(s.place, 1);
        if (teamOf(s.id) === 'red') red += pts;
        else blue += pts;
      }
      this.red.set(`${t('team.red')} ${red}`);
      this.blue.set(`${blue} ${t('team.blue')}`);
      this.root.classList.toggle('lead-red', red > blue);
      this.root.classList.toggle('lead-blue', blue > red);
    } else {
      let leaderId = -1;
      for (let i = 0; i < karts.length; i++) if (karts[i].state.place === 1) leaderId = karts[i].state.id;
      const team = leaderId >= 0 ? teamOf(leaderId) : null;
      this.red.set(team === 'red' ? t('team.red') : '');
      this.blue.set(team === 'blue' ? t('team.blue') : '');
      this.root.classList.toggle('lead-red', team === 'red');
      this.root.classList.toggle('lead-blue', team === 'blue');
    }
  }
}
