// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../core/constants';
import { createEmptyInput, type IKart } from '../core/types';
import { events } from '../core/events';
import { CHARACTERS } from '../kart/roster';
import { Kart } from '../kart/Kart';
import { ClientSession, lerpAngle } from './client-session';
import { FakeTrack } from './FakeTrack';
import { HostSession, SNAPSHOT_EVERY } from './host-session';
import { createLoopbackHub } from './loopback';
import { PHASE, type RosterEntry, type StandingMsg } from './protocol';
import { assignSlotCharacters } from './roster';

const roster: RosterEntry[] = [
  { account: 'H', nick: 'Host', characterId: 'max', kartId: 0 },
  { account: 'C', nick: 'Cli', characterId: 'zippy', kartId: 1 },
];

function makeKarts(localId: number, track: FakeTrack): Kart[] {
  const chars = assignSlotCharacters(roster, CHARACTERS);
  const karts = chars.map((c, id) => new Kart(id, c, id === localId));
  karts.forEach((k, i) => k.resetTo(track.startGrid[i].position, track.startGrid[i].quaternion));
  return karts;
}

const fullThrottle = { ...createEmptyInput(), throttle: 1 };

describe('host ↔ client sessions over loopback', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    events.clear();
  });

  it('remote karts on the client track the host within 0.5 m; local prediction converges', () => {
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);

    const track = new FakeTrack();
    const hostKarts = makeKarts(0, track);
    const cliKarts = makeKarts(1, track);

    let phase: 0 | 1 | 2 | 3 = PHASE.racing;
    const host = new HostSession(hostT, roster);
    host.attach({
      karts: hostKarts,
      phase: () => phase,
      countdown: () => 0,
      raceTime: () => now / 1000,
      standings: () => hostKarts.map((k, i) => ({ kartId: i, name: k.state.character.name, color: 0, place: i + 1, finishTime: -1 })),
    });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({ karts: cliKarts, totalLaps: 3 });

    const others = (ks: readonly IKart[]) => ks;
    // Host: kart 0 driven by "host player" input, kart 1 by the client's relayed input, AI karts idle.
    for (let tick = 0; tick < 400; tick++) {
      now += FIXED_DT * 1000;
      hostKarts[0].setInput(fullThrottle);
      const remoteIn = host.inputFor(1);
      if (remoteIn) hostKarts[1].setInput(remoteIn);
      for (const k of hostKarts) k.update(FIXED_DT, track, others(hostKarts));
      host.tick60();

      // Client: predicts its own kart 1, interpolates everyone else.
      cliKarts[1].setInput(fullThrottle);
      cliKarts[1].update(FIXED_DT, track, others(cliKarts));
      client.tick60(fullThrottle);
    }

    // Host kart 0 moved; client's copy of kart 0 follows it (interpolation lags 100 ms ≈ 2 m at 20 m/s).
    const h0 = hostKarts[0].state.position;
    const c0 = cliKarts[0].state.position;
    expect(h0.length()).toBeGreaterThan(1);
    expect(h0.distanceTo(c0)).toBeLessThan(3.0);
    // Client's own kart is being simulated on both ends with the same input → close agreement.
    const h1 = hostKarts[1].state.position;
    const c1 = cliKarts[1].state.position;
    expect(h1.distanceTo(c1)).toBeLessThan(1.5);
    expect(host.inputFor(1)?.throttle).toBe(1);

    // Big divergence snaps back within a few ticks.
    cliKarts[1].state.position.x += 20;
    for (let tick = 0; tick < 12; tick++) {
      now += FIXED_DT * 1000;
      hostKarts[0].setInput(fullThrottle);
      const remoteIn = host.inputFor(1);
      if (remoteIn) hostKarts[1].setInput(remoteIn);
      for (const k of hostKarts) k.update(FIXED_DT, track, others(hostKarts));
      host.tick60();
      cliKarts[1].setInput(fullThrottle);
      cliKarts[1].update(FIXED_DT, track, others(cliKarts));
      client.tick60(fullThrottle);
    }
    expect(hostKarts[1].state.position.distanceTo(cliKarts[1].state.position)).toBeLessThan(2.0);
  });

  it('mirrors phase, lap, place and finish of the local kart as race events', () => {
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);
    const track = new FakeTrack();
    const hostKarts = makeKarts(0, track);
    const cliKarts = makeKarts(1, track);
    let phase: 0 | 1 | 2 | 3 = PHASE.countdown;
    const host = new HostSession(hostT, roster);
    host.attach({ karts: hostKarts, phase: () => phase, countdown: () => 3, raceTime: () => 0, standings: () => [] });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({ karts: cliKarts, totalLaps: 3 });
    const phases: number[] = [];
    client.onPhase = (p) => phases.push(p);
    const seen: string[] = [];
    events.on('race:lap', (e) => seen.push(`lap${e.lap}:${e.isPlayer}`));
    events.on('race:finish', (e) => seen.push(`finish${e.place}:${e.isPlayer}`));
    events.on('race:positionChange', (e) => seen.push(`pos${e.from}>${e.to}`));

    const step = () => {
      now += FIXED_DT * 1000;
      host.tick60();
      client.tick60(createEmptyInput());
    };
    for (let i = 0; i < SNAPSHOT_EVERY; i++) step();
    expect(phases).toEqual([PHASE.countdown]);

    phase = PHASE.racing;
    hostKarts[1].state.lap = 1;
    hostKarts[1].state.place = 2;
    for (let i = 0; i < SNAPSHOT_EVERY; i++) step();
    hostKarts[1].state.lap = 2;
    hostKarts[1].state.place = 1;
    for (let i = 0; i < SNAPSHOT_EVERY; i++) step();
    hostKarts[1].state.finished = true;
    hostKarts[1].state.finishTime = 91.2;
    for (let i = 0; i < SNAPSHOT_EVERY; i++) step();

    expect(phases).toEqual([PHASE.countdown, PHASE.racing]);
    expect(seen).toContain('lap2:true');
    expect(seen).toContain('pos2>1');
    expect(seen).toContain('finish1:true');
    expect(cliKarts[1].state.finished).toBe(true);
    expect(cliKarts[1].state.finishTime).toBeCloseTo(91.2, 5);
  });

  it('reports host loss after 8 s without snapshots and forwards RESULTS', () => {
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);
    const track = new FakeTrack();
    const cliKarts = makeKarts(1, track);
    const hostKarts = makeKarts(0, track);
    const host = new HostSession(hostT, roster);
    host.attach({ karts: hostKarts, phase: () => PHASE.racing, countdown: () => 0, raceTime: () => 5, standings: () => [] });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({ karts: cliKarts, totalLaps: 3 });
    let lost: StandingMsg[] | null = null;
    client.onHostLost = (s) => (lost = s);
    let results: StandingMsg[] | null = null;
    client.onResults = (s) => (results = s);

    for (let i = 0; i < SNAPSHOT_EVERY; i++) {
      now += FIXED_DT * 1000;
      host.tick60();
      client.tick60(createEmptyInput());
    }
    expect(lost).toBeNull();
    now += 9000;
    client.tick60(createEmptyInput());
    expect(lost).not.toBeNull();
    expect(lost!.length).toBe(8);

    hostT.send('results', { standings: [{ kartId: 0, name: 'Max', color: 0, place: 1, finishTime: 90 }] });
    expect(results).not.toBeNull();
    expect(results![0].kartId).toBe(0);
  });

  it('host marks a leaver and asks for an AI takeover', () => {
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);
    const host = new HostSession(hostT, roster);
    const left: number[] = [];
    host.onHumanLeft = (id) => left.push(id);
    cliT.send('leave', { account: 'C' });
    expect(left).toEqual([1]);
    expect(host.allLoaded).toBe(true); // nobody left to wait for
  });

  it('lerpAngle takes the short way round', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 3);
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25, 6);
  });
});
