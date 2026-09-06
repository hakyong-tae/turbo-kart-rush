// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../core/constants';
import { createEmptyInput } from '../core/types';
import { CHARACTERS } from '../kart/roster';
import { Kart } from '../kart/Kart';
import { ClientSession } from './client-session';
import { FakeTrack } from './FakeTrack';
import { HostSession, SNAPSHOT_EVERY } from './host-session';
import { createLoopbackHub } from './loopback';
import { PHASE, type RosterEntry } from './protocol';
import { assignSlotCharacters } from './roster';

const roster: RosterEntry[] = [
  { account: 'H', nick: 'Host', characterId: 'max', kartId: 0 },
  { account: 'A', nick: 'Ay', characterId: 'zippy', kartId: 1 },
  { account: 'B', nick: 'Bee', characterId: 'kai', kartId: 2 },
];

function karts(localId: number, track: FakeTrack): Kart[] {
  const chars = assignSlotCharacters(roster, CHARACTERS);
  const ks = chars.map((c, id) => new Kart(id, c, id === localId));
  ks.forEach((k, i) => k.resetTo(track.startGrid[i].position, track.startGrid[i].quaternion));
  return ks;
}

describe('host migration epoch guard', () => {
  it('client B follows the newer epoch host (A) and ignores the stale one (H)', () => {
    const hub = createLoopbackHub();
    const hT = hub.endpoint('H');
    const aT = hub.endpoint('A');
    const bT = hub.endpoint('B');
    for (const t of [hT, aT, bT]) void t.joinRoom(null);
    const track = new FakeTrack();
    let now = 0;
    const view = (ks: Kart[]) => ({ karts: ks, phase: () => PHASE.racing as 2, countdown: () => 0, raceTime: () => now / 1000, standings: () => [] });

    const hostH = new HostSession(hT, roster, 1);
    const hKarts = karts(0, track);
    hostH.attach(view(hKarts));
    const bKarts = karts(2, track);
    const clientB = new ClientSession(bT, roster, 2, () => now);
    clientB.attach({ karts: bKarts, totalLaps: 3 });
    const changes: string[] = [];
    clientB.onHostChanged = (acct, epoch) => changes.push(`${acct}@${epoch}`);
    let lost = 0;
    clientB.onHostLost = () => lost++;

    // H hosts for a while; move kart 0 so we can tell whose snapshots B applies.
    for (let i = 0; i < SNAPSHOT_EVERY * 4; i++) {
      now += FIXED_DT * 1000;
      hKarts[0].state.position.x = 100;
      hostH.tick60();
      clientB.tick60(createEmptyInput());
    }
    expect(clientB.currentHost).toEqual({ account: 'H', hostEpoch: 1 });

    // H vanishes. After the timeout B reports host loss.
    now += 9000;
    clientB.tick60(createEmptyInput());
    expect(lost).toBe(1);

    // A promotes itself with epoch 2 and starts sending snapshots with kart 0 elsewhere.
    const hostA = new HostSession(aT, roster, 2);
    hostA.markGone(['H']);
    hostA.markAllLoaded();
    const aKarts = karts(1, track);
    aKarts[0].state.position.x = -100;
    hostA.attach(view(aKarts));
    hostA.announce();
    for (let i = 0; i < SNAPSHOT_EVERY * 12; i++) {
      now += FIXED_DT * 1000;
      hostA.tick60();
      // Stale H comes back with epoch 1 → must be ignored.
      hostH.tick60();
      clientB.tick60(createEmptyInput());
    }
    expect(changes).toEqual(['A@2']);
    expect(clientB.currentHost).toEqual({ account: 'A', hostEpoch: 2 });
    expect(bKarts[0].state.position.x).toBeLessThan(-50); // followed A, not H
    expect(hostA.allLoaded).toBe(true);
    expect(lost).toBe(1); // no second host-loss while A is alive
  });
});
