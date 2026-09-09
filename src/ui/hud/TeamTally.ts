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
  private readonly ours: TextField;
  private readonly mid: TextField;
  private readonly theirs: TextField;
  private mode: RaceMode = 'solo';
  private localKartId = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-team glass', undefined, parent);
    this.ours = new TextField(el('span', 'hud-team-us', '', this.root));
    this.mid = new TextField(el('span', 'hud-team-mid', '', this.root));
    this.theirs = new TextField(el('span', 'hud-team-them', '', this.root));
  }

  setMode(mode: RaceMode, localKartId: number): void {
    this.mode = mode;
    this.localKartId = localKartId;
    this.root.classList.toggle('visible', isTeamMode(mode));
    this.mid.set(mode === 'teamFirst' ? t('hud.team.first') : ':');
  }

  update(karts: readonly IKart[]): void {
    if (!isTeamMode(this.mode)) return;
    if (this.mode === 'teamPoints') {
      // Sides are relative to this player: ours on the left, theirs on the right.
      let us = 0;
      let them = 0;
      for (let i = 0; i < karts.length; i++) {
        const s = karts[i].state;
        const pts = s.finished ? pointsFor(s.place, s.finishTime) : pointsFor(s.place, 1);
        if (teamOf(s.id) === teamOf(this.localKartId)) us += pts;
        else them += pts;
      }
      this.ours.set(`${t('team.us')} ${us}`);
      this.theirs.set(`${them} ${t('team.them')}`);
      this.root.classList.toggle('lead-us', us > them);
      this.root.classList.toggle('lead-them', them > us);
    } else {
      let leaderId = -1;
      for (let i = 0; i < karts.length; i++) if (karts[i].state.place === 1) leaderId = karts[i].state.id;
      const ours = leaderId >= 0 ? teamOf(leaderId) === teamOf(this.localKartId) : null;
      this.ours.set(ours === true ? t('team.us') : '');
      this.theirs.set(ours === false ? t('team.them') : '');
      this.root.classList.toggle('lead-us', ours === true);
      this.root.classList.toggle('lead-them', ours === false);
    }
  }
}
