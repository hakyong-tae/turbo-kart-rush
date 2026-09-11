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

  it('latency does not steal the client\'s own progress', async () => {
    // The reported "tick delay": on a real connection the pose a client reconciles against is
    // RTT/2 + a snapshot period old, and the reconciler used to blend toward it without replaying
    // the inputs applied since. The kart is therefore dragged backwards every tick while the
    // player drives forwards. A zero-latency loopback cannot show this, so both directions are
    // delayed here, and the measure is simply: the same inputs must move the networked kart as
    // far as they move an offline one.
    const DELAY_TICKS = 30; // 250 ms each way at 120 Hz
    const JITTER_TICKS = 12; // relay jitter on a phone
    const hub = createLoopbackHub();
    const clock = { tick: 0 };
    const delayed = (t: ReturnType<typeof hub.endpoint>) => {
      const queue: { at: number; args: [string, unknown, boolean | undefined] }[] = [];
      const wrapped = Object.create(t) as typeof t & { pump(): void };
      wrapped.send = (event: string, payload: unknown, hot?: boolean) => {
        const jitter = Math.floor(((Math.sin(clock.tick * 12.9898) * 43758.5453) % 1 + 1) / 2 * JITTER_TICKS);
        queue.push({ at: clock.tick + DELAY_TICKS + jitter, args: [event, payload, hot] });
      };
      // The real transport can measure its round trip; the reconciler uses it to tell how old
      // the host's view is. Model that here or the test is kinder than a phone.
      wrapped.ping = () => Promise.resolve((DELAY_TICKS * 2 * 1000) / 120);
      wrapped.pump = () => {
        while (queue.length > 0 && queue[0].at <= clock.tick) {
          const m = queue.shift()!;
          t.send(...m.args);
        }
      };
      return wrapped;
    };

    const hostT = delayed(hub.endpoint('H'));
    const cliT = delayed(hub.endpoint('C'));
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);

    const track = new FakeTrack();
    const hostKarts = makeKarts(0, track);
    const cliKarts = makeKarts(1, track);
    const host = new HostSession(hostT, roster);
    host.attach({
      karts: hostKarts,
      phase: () => PHASE.racing,
      countdown: () => 0,
      raceTime: () => now / 1000,
      standings: () => hostKarts.map((k, i) => ({ kartId: i, name: k.state.character.name, color: 0, place: i + 1, finishTime: -1 })),
    });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({
      karts: cliKarts,
      totalLaps: 3,
      replay: (kart, input) => {
        kart.setInput(input);
        kart.update(FIXED_DT, track, []);
      },
    });

    // Reference: the same kart, same inputs, no networking at all.
    const refKarts = makeKarts(1, track);
    // What the player actually sees: the simulated position plus whatever offset the model is
    // currently carrying to hide a network correction.
    const seen = (k: Kart) => k.state.position.clone().add(k.netOffset);
    const start = seen(cliKarts[1]);
    (globalThis as unknown as { __rewindMiss?: number }).__rewindMiss = 0;
    const anomalies: number[] = [];
    let drift = 0;
    let prev = seen(cliKarts[1]);
    let prevSpeed = cliKarts[1].state.speed;

    for (let tick = 0; tick < 720; tick++) {
      clock.tick = tick;
      now += FIXED_DT * 1000;
      hostT.pump();
      cliT.pump();

      hostKarts[0].setInput(fullThrottle);
      const remoteIn = host.inputFor(1);
      if (remoteIn) hostKarts[1].setInput(remoteIn);
      for (const k of hostKarts) k.update(FIXED_DT, track, hostKarts);
      host.tick60();

      cliKarts[1].setInput(fullThrottle);
      cliKarts[1].update(FIXED_DT, track, cliKarts);
      client.tick60(fullThrottle);

      refKarts[1].setInput(fullThrottle);
      refKarts[1].update(FIXED_DT, track, refKarts);

      if (tick > 180) {
        const d = seen(cliKarts[1]).distanceTo(prev);
        // Compare each tick against what its own speed says it should be: the kart accelerates
        // through the run, so measuring against a single median calls honest speed-up a stutter.
        // Averaged across the tick: on a braking tick the end-of-tick speed alone understates
        // the ground actually covered, and honest braking would read as a jolt.
        const expected = ((Math.abs(prevSpeed) + Math.abs(cliKarts[1].state.speed)) / 2) * FIXED_DT;
        anomalies.push(Math.abs(d - expected));
        drift = Math.max(drift, cliKarts[1].state.position.distanceTo(hostKarts[1].state.position));
      }
      prev = seen(cliKarts[1]);
      prevSpeed = cliKarts[1].state.speed;
      // Let the transport's ping settle: in the game these ticks are spread across frames.
      await Promise.resolve();
    }

    const travelled = seen(cliKarts[1]).distanceTo(start);
    const reference = refKarts[1].state.position.distanceTo(start);
    const hostCopy = hostKarts[1].state.position.distanceTo(start);
    const worstAnomaly = Math.max(...anomalies);
    const visibleJolts = anomalies.filter((a) => a > 0.02).length;
    expect(reference).toBeGreaterThan(20);
    // Latency must not cost the player their own driving. Rollback settles the disagreement
    // exactly instead of dragging the kart toward a stale pose, so the networked client covers
    // the same ground as an offline one: 0.998 here, against 0.973 for the blend it replaced.
    expect(travelled).toBeGreaterThan(reference * 0.99);
    // And the corrections must not be visible. Every tick is checked against the ground its own
    // speed says it covered; anything left over is a jolt the player would feel. Measured on this
    // harness: 0.127 m worst and 24 such ticks with the blend, 0.023 m and 2 with rollback and
    // the model absorbing what is left.
    expect(worstAnomaly).toBeLessThan(0.04);
    expect(visibleJolts).toBeLessThan(6);
    // The client runs ahead of the host by exactly the trip time — that is prediction working,
    // not drift. This harness delays 30 ticks each way plus jitter, so at ~17 m/s a little over
    // 8 m is right; far more would mean the two simulations had genuinely parted company.
    expect(drift).toBeLessThan(12);
  });

  it('a client that steers constantly stays with the host (batched per-tick input)', () => {
    // The regression this guards: the relay only lets a client speak every 50 ms, and the host
    // used to hold whichever sample arrived and apply it for the whole window. Steering that
    // moved inside a window was invisible to the host, so its version of the kart drifted away
    // from the one the player was driving and the reconciler dragged them back — the "tick delay"
    // clients reported. With every tick's input carried in the batch, the two agree.
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);

    const track = new FakeTrack();
    const hostKarts = makeKarts(0, track);
    const cliKarts = makeKarts(1, track);
    const host = new HostSession(hostT, roster);
    host.attach({
      karts: hostKarts,
      phase: () => PHASE.racing,
      countdown: () => 0,
      raceTime: () => now / 1000,
      standings: () => hostKarts.map((k, i) => ({ kartId: i, name: k.state.character.name, color: 0, place: i + 1, finishTime: -1 })),
    });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({ karts: cliKarts, totalLaps: 3 });

    let worst = 0;
    for (let tick = 0; tick < 600; tick++) {
      now += FIXED_DT * 1000;
      // Steering that reverses several times inside every 58 ms send window.
      const steer = Math.sin(tick * 0.55);
      const input = { ...createEmptyInput(), throttle: 1, steer };

      hostKarts[0].setInput(fullThrottle);
      const remoteIn = host.inputFor(1);
      if (remoteIn) hostKarts[1].setInput(remoteIn);
      for (const k of hostKarts) k.update(FIXED_DT, track, hostKarts);
      host.tick60();

      cliKarts[1].setInput(input);
      cliKarts[1].update(FIXED_DT, track, cliKarts);
      client.tick60(input);

      if (tick > 120) worst = Math.max(worst, hostKarts[1].state.position.distanceTo(cliKarts[1].state.position));
    }
    // Both ends drove the same signal, so they end up in the same place rather than fighting.
    expect(worst).toBeLessThan(1.5);
    expect(hostKarts[1].state.position.length()).toBeGreaterThan(5);
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
