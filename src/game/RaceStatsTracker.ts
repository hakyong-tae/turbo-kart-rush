/**
 * Counts what the local player did in one race, for the daily missions.
 *
 * It listens to the event bus rather than reaching into the kart, so it works the same for an
 * offline race, a hosted online race and a mirrored client race. The totals go to the server in
 * the finish report, which clamps them and decides what they are worth; the copy kept here also
 * lets a counter mission be announced the moment it is reached.
 */
import { STAT_CAP, emptyStats, type MissionStat, type RaceStats } from '../core/economy';
import { events } from '../core/events';

export class RaceStatsTracker {
  readonly stats: RaceStats = emptyStats();
  /** Called after a counter moved. */
  onChange: ((stat: MissionStat) => void) | null = null;
  private readonly unsubs: (() => void)[];

  constructor(localKartId: number) {
    const mine = (kartId: number): boolean => kartId === localKartId;
    this.unsubs = [
      // Stage 2 and 3 mini-turbos only: a stage 1 flick is not what the mission asks for.
      events.on('kart:driftEnd', (e) => {
        if (mine(e.kartId) && e.boostStage >= 2) this.bump('drift');
      }),
      events.on('kart:draftEnd', (e) => {
        if (mine(e.kartId) && e.burst) this.bump('draft');
      }),
      events.on('kart:boost', (e) => {
        if (mine(e.kartId) && e.source === 'start') this.bump('start');
      }),
      events.on('item:use', (e) => {
        if (mine(e.kartId)) this.bump('items');
      }),
      events.on('item:hit', (e) => {
        if (mine(e.sourceKartId) && !mine(e.kartId)) this.bump('hits');
      }),
      events.on('kart:collision', (e) => {
        if (mine(e.kartId) && e.otherId === null) this.bump('walls');
      }),
      events.on('kart:trick', (e) => {
        if (mine(e.kartId) && e.landed) this.bump('tricks');
      }),
    ];
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
  }

  private bump(stat: MissionStat): void {
    if (this.stats[stat] >= STAT_CAP[stat]) return;
    this.stats[stat] += 1;
    this.onChange?.(stat);
  }
}
