/**
 * Left-hand standings board: every racer by current place, the player highlighted, team colours
 * in team modes. Re-renders only when the order / finish flags change (numeric signature, no
 * per-frame allocations — the sort buffer is reused).
 */
import type { IKart, RaceMode } from '../../core/types';
import { TEAM_COLORS, isTeamMode, teamOf } from '../../core/teams';
import { TextField, cssHex, el } from '../dom';

interface Row {
  row: HTMLElement;
  place: TextField;
  chip: HTMLElement;
  name: TextField;
}

export class StandingsBoard {
  readonly root: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly sorted: IKart[] = [];
  private signature = -1;
  private mode: RaceMode = 'solo';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-standings glass', undefined, parent);
  }

  setMode(mode: RaceMode): void {
    this.mode = mode;
    this.signature = -1;
  }

  update(karts: readonly IKart[], playerId: number): void {
    // Copy + insertion sort in place (8 karts).
    const sorted = this.sorted;
    sorted.length = karts.length;
    for (let i = 0; i < karts.length; i++) sorted[i] = karts[i];
    for (let i = 1; i < sorted.length; i++) {
      const k = sorted[i];
      let j = i - 1;
      while (j >= 0 && sorted[j].state.place > k.state.place) {
        sorted[j + 1] = sorted[j];
        j--;
      }
      sorted[j + 1] = k;
    }
    // Signature: kart id + finish state per slot, packed into one number.
    let sig = 7;
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i].state;
      const flag = s.finished ? (s.finishTime > 0 ? 1 : 2) : 0;
      sig = (sig * 31 + s.id * 3 + flag) | 0;
    }
    if (sig === this.signature) return;
    this.signature = sig;

    while (this.rows.length < sorted.length) {
      const row = el('div', 'hud-standing', undefined, this.root);
      const place = new TextField(el('span', 'hud-standing-place', '', row));
      const chip = el('span', 'hud-standing-chip', undefined, row);
      const name = new TextField(el('span', 'hud-standing-name', '', row));
      this.rows.push({ row, place, chip, name });
    }
    const team = isTeamMode(this.mode);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i].state;
      const r = this.rows[i];
      r.row.hidden = false;
      r.row.classList.toggle('you', s.id === playerId);
      r.row.classList.toggle('dnf', s.finished && s.finishTime <= 0);
      r.row.classList.toggle('done', s.finished && s.finishTime > 0);
      r.place.set(String(i + 1));
      r.chip.style.background = cssHex(team ? TEAM_COLORS[teamOf(s.id)] : s.character.color);
      r.name.set(s.character.name.toUpperCase());
    }
    for (let i = sorted.length; i < this.rows.length; i++) this.rows[i].row.hidden = true;
  }
}
