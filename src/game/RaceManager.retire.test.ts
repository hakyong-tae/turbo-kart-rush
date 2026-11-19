// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../core/balance';
import { FIXED_DT, KART_COUNT } from '../core/constants';
import { events } from '../core/events';
import type { RaceSettings } from '../core/types';
import { CHARACTERS } from '../kart/roster';
import { Kart } from '../kart/Kart';
import { FakeTrack } from '../net/FakeTrack';
import { RaceManager } from './RaceManager';

const OFFLINE: RaceSettings = { characterId: 'pixel', trackId: 'sunny_circuit', difficulty: 'normal', laps: 3 };

/**
 * A race whose winner (kart 0) is home, with the player (kart 1) on the last lap and the other
 * six a lap behind. `sinceWinner` is how long ago the winner finished.
 */
function lateRace(settings: RaceSettings, sinceWinner: number, playerT = 0.5) {
  events.clear();
  const track = new FakeTrack();
  const karts = CHARACTERS.slice(0, KART_COUNT).map((c, id) => new Kart(id, c, id === 1));
  const rm = new RaceManager(track, karts, settings);
  karts[0].state.finished = true;
  karts[0].state.finishTime = 80;
  karts[0].state.place = 1;
  karts[0].state.lap = 4;
  for (let i = 1; i < KART_COUNT; i++) {
    const t = i === 1 ? playerT : 0.3;
    karts[i].state.lap = i === 1 ? 3 : 2;
    karts[i].state.checkpointIndex = 0;
    karts[i].state.place = i + 1;
    karts[i].state.position.copy(track.sample(t).position);
    karts[i].state.trackT = t;
  }
  rm.adoptFromKarts(80 + sinceWinner, 'racing');
  // Adoption forgets when the winner came home (a migrated host restarts that clock); put it back.
  (rm as unknown as { firstFinishedAt: number }).firstFinishedAt = 80;
  const finishes: { kartId: number; place: number; retired: boolean }[] = [];
  events.on('race:finish', (e) => finishes.push({ kartId: e.kartId, place: e.place, retired: Boolean(e.retired) }));
  let over = false;
  events.on('race:allFinished', () => {
    over = true;
  });
  return { track, karts, rm, finishes, isOver: () => over };
}

describe('RaceManager: the player outlasts the field', () => {
  it('the field behind the player is retired at its limit; the player drives on and takes the place ahead of them', () => {
    const { track, karts, rm, finishes, isOver } = lateRace(OFFLINE, BALANCE.race.retireSeconds, 0.995);
    rm.update(FIXED_DT);
    // Six karts behind, retired into the last six places; the player is still racing in 2nd.
    expect(finishes.filter((f) => f.retired).map((f) => f.place).sort()).toEqual([3, 4, 5, 6, 7, 8]);
    expect(finishes.some((f) => f.kartId === 1)).toBe(false);
    expect(karts[1].state.finished).toBe(false);
    expect(karts[1].state.place).toBe(2);
    expect(isOver()).toBe(false);
    for (let i = 0; i < 240 && !karts[1].state.finished; i++) {
      karts[1].setInput({ ...karts[1].input, throttle: 1 });
      karts[1].update(FIXED_DT, track, karts);
      rm.update(FIXED_DT);
    }
    expect(karts[1].state.finished).toBe(true);
    expect(karts[1].state.finishTime).toBeGreaterThan(0);
    expect(karts[1].state.place).toBe(2);
    rm.update(FIXED_DT);
    expect(isOver()).toBe(true);
    // The table reads finishers first, the retired after them, every place used once.
    expect(rm.getStandings().map((s) => s.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rm.getStandings()[1]).toMatchObject({ kartId: 1, isPlayer: true });
  });

  it('a player who is still making ground is not retired at the longer limit; one who has stopped is', () => {
    const { karts, rm, isOver } = lateRace(OFFLINE, BALANCE.race.playerRetireSeconds - 0.01);
    // Standing still from here on: the stall window has to run out first.
    const steps = Math.ceil((BALANCE.race.playerStallSeconds + 0.1) / FIXED_DT);
    for (let i = 0; i < steps / 2; i++) rm.update(FIXED_DT);
    expect(karts[1].state.finished).toBe(false);
    expect(isOver()).toBe(false);
    for (let i = 0; i < steps / 2 + 2; i++) rm.update(FIXED_DT);
    expect(isOver()).toBe(true);
    expect(karts[1].state.finishTime).toBe(-1);
    // Retired last, but still classified ahead of the six retired before them.
    expect(karts[1].state.place).toBe(2);
  });

  it('nobody is waited for past the cap', () => {
    const { karts, rm, isOver } = lateRace(OFFLINE, BALANCE.race.playerRetireCap);
    rm.update(FIXED_DT);
    expect(isOver()).toBe(true);
    expect(karts[1].state.finishTime).toBe(-1);
  });

  it('an online race keeps the one limit for everyone', () => {
    const online = { ...OFFLINE, online: { role: 'host', roster: [], localKartId: 1, items: false } } as unknown as RaceSettings;
    const { karts, rm, finishes, isOver } = lateRace(online, BALANCE.race.retireSeconds);
    rm.update(FIXED_DT);
    expect(isOver()).toBe(true);
    expect(finishes).toHaveLength(7);
    expect(karts[1].state.finishTime).toBe(-1);
    expect(karts[1].state.place).toBe(2);
  });
});
