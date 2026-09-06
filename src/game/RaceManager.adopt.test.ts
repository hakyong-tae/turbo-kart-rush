// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../core/constants';
import { events } from '../core/events';
import { CHARACTERS } from '../kart/roster';
import { Kart } from '../kart/Kart';
import { FakeTrack } from '../net/FakeTrack';
import { RaceManager } from './RaceManager';

describe('RaceManager.adoptFromKarts', () => {
  it('continues a mirrored race: keeps laps/finishes, unfreezes, and can still finish the race', () => {
    events.clear();
    const track = new FakeTrack();
    const karts = CHARACTERS.map((c, id) => new Kart(id, c, id === 1));
    const rm = new RaceManager(track, karts, { characterId: 'pixel', trackId: 'sunny_circuit', difficulty: 'normal', laps: 3 });
    // Mirror-like state written by snapshots: kart 0 finished 1st, kart 1 (us) on lap 3 near the line, others lap 2.
    karts[0].state.finished = true;
    karts[0].state.finishTime = 88.8;
    karts[0].state.place = 1;
    karts[0].state.lap = 4;
    for (let i = 1; i < 8; i++) {
      karts[i].state.lap = i === 1 ? 3 : 2;
      karts[i].state.checkpointIndex = 0;
      karts[i].state.place = i + 1;
      karts[i].state.position.copy(track.sample(0.995).position);
      karts[i].state.trackT = 0.995;
    }
    rm.adoptFromKarts(90, 'racing');
    expect(rm.currentPhase).toBe('racing');
    expect(rm.raceTime).toBe(90);
    expect(karts[1].state.isFrozen).toBe(false);
    const standings = rm.getStandings();
    expect(standings[0].kartId).toBe(0);
    expect(standings[0].finishTime).toBeCloseTo(88.8, 5);

    // Drive kart 1 across the line: it should finish (lap 3 → done) and the finish event should fire.
    const finished: number[] = [];
    events.on('race:finish', (e) => finished.push(e.kartId));
    for (let i = 0; i < 240; i++) {
      karts[1].setInput({ ...karts[1].input, throttle: 1 });
      karts[1].update(FIXED_DT, track, karts);
      rm.update(FIXED_DT);
    }
    expect(finished).toContain(1);
    expect(karts[1].state.finished).toBe(true);
    expect(karts[1].state.place).toBe(2);
  });

  it('countdown adoption restarts the local 3-2-1 sequence', () => {
    events.clear();
    const track = new FakeTrack();
    const karts = CHARACTERS.map((c, id) => new Kart(id, c, id === 0));
    const rm = new RaceManager(track, karts, { characterId: 'zippy', trackId: 'sunny_circuit', difficulty: 'easy', laps: 3 });
    rm.adoptFromKarts(0, 'countdown');
    expect(rm.currentPhase).toBe('countdown');
    expect(karts[0].state.isFrozen).toBe(true);
  });
});
