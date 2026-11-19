/**
 * Event feed: one short line each time the player does something worth saying out loud — a drift
 * boost, an overtake, a hit, a slipstream — and, in the same place, how far a mission has come.
 * Words only; what a race pays is unchanged.
 *
 * Lines stack newest-first and fade on their own. A repeat of the line already on top restarts it
 * instead of adding another, so a run of drift boosts reads as one beat, not a column.
 */
import { events } from '../../core/events';
import { t } from '../../core/i18n';
import { el } from '../dom';

const LINE_SECONDS = 1.7;
const MAX_LINES = 3;

interface Line {
  node: HTMLElement;
  key: string;
  ttl: number;
}

export class EventFeed {
  private readonly rootNode: HTMLElement;
  private readonly lines: Line[] = [];
  private readonly unsubs: (() => void)[];
  private playerId = 0;

  constructor(parent: HTMLElement) {
    this.rootNode = el('div', 'hud-feed', undefined, parent);
    const mine = (kartId: number): boolean => kartId === this.playerId;
    this.unsubs = [
      events.on('kart:driftEnd', (e) => {
        if (mine(e.kartId) && e.boostStage >= 1) this.push(t(e.boostStage >= 2 ? 'feed.driftBig' : 'feed.drift'), 'drift');
      }),
      events.on('kart:draftEnd', (e) => {
        if (mine(e.kartId) && e.burst) this.push(t('feed.draft'), 'draft');
      }),
      events.on('kart:boost', (e) => {
        if (mine(e.kartId) && e.source === 'start') this.push(t('feed.start'), 'start');
      }),
      events.on('kart:trick', (e) => {
        if (mine(e.kartId) && e.landed) this.push(t('feed.trick'), 'trick');
      }),
      events.on('item:hit', (e) => {
        if (mine(e.sourceKartId) && !mine(e.kartId)) this.push(t('feed.hit'), 'hit');
      }),
      events.on('race:positionChange', (e) => {
        if (e.isPlayer && e.to < e.from) this.push(t('feed.pass'), 'pass');
      }),
    ];
  }

  setPlayer(kartId: number): void {
    this.playerId = kartId;
  }

  /** A mission counter moved: "Items 5/8". */
  mission(name: string, value: number, target: number): void {
    this.push(t('feed.mission', { name, i: value, n: target }), `mission:${name}`, 'mission');
  }

  update(dt: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      line.ttl -= dt;
      if (line.ttl > 0) continue;
      line.node.remove();
      this.lines.splice(i, 1);
    }
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.rootNode.remove();
  }

  private push(text: string, key: string, cls = ''): void {
    const top = this.lines[this.lines.length - 1];
    if (top && top.key === key) {
      // The same thing again: refresh the line (a mission count changes its text).
      top.node.textContent = text;
      top.ttl = LINE_SECONDS;
      top.node.classList.remove('feed-in');
      void top.node.offsetWidth;
      top.node.classList.add('feed-in');
      return;
    }
    const node = el('div', `feed-line feed-in${cls ? ` ${cls}` : ''}`, text);
    this.rootNode.prepend(node);
    this.lines.push({ node, key, ttl: LINE_SECONDS });
    while (this.lines.length > MAX_LINES) this.lines.shift()?.node.remove();
  }
}
