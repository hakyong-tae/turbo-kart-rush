// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../core/constants';
import { createEmptyInput, type IKart } from '../core/types';
import { events } from '../core/events';
import { ItemManager } from '../items/ItemManager';
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
  { account: 'C', nick: 'Cli', characterId: 'zippy', kartId: 1 },
];

function makeKarts(localId: number, track: FakeTrack): Kart[] {
  const chars = assignSlotCharacters(roster, CHARACTERS);
  const karts = chars.map((c, id) => new Kart(id, c, id === localId));
  karts.forEach((k, i) => k.resetTo(track.startGrid[i].position, track.startGrid[i].quaternion));
  return karts;
}

describe('item sync (host authority → client mirror)', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    events.clear();
  });

  it('client mirrors boxes and hazards from the host and replays FX events; useSeq triggers requestUse on the host', () => {
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);
    const track = new FakeTrack();

    const hostKarts = makeKarts(0, track);
    const hostItems = new ItemManager(null);
    hostItems.init(track, hostKarts);
    const cliKarts = makeKarts(1, track);
    const cliItems = new ItemManager(null);
    cliItems.init(track, cliKarts);
    cliItems.setNetMode('mirror');

    const host = new HostSession(hostT, roster);
    host.attach({
      karts: hostKarts,
      phase: () => PHASE.racing,
      countdown: () => 0,
      raceTime: () => now / 1000,
      standings: () => [],
      items: () => hostItems.getNetItems(),
    });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({ karts: cliKarts, totalLaps: 3, items: cliItems });

    const seenOnClient: string[] = [];
    events.on('item:use', (e) => seenOnClient.push(`use:${e.item}:${e.kartId}:${e.isPlayer}`));
    events.on('item:pickup', (e) => seenOnClient.push(`pickup:${e.kartId}`));

    // Give the client's kart (host copy, id 1) a banana and press "use" on the client.
    hostKarts[1].state.item = 'banana';
    hostKarts[1].state.itemCount = 1;
    const pressing = { ...createEmptyInput(), useItem: true, throttle: 1 };
    const idle = { ...createEmptyInput(), throttle: 1 };

    const step = (input = idle) => {
      now += FIXED_DT * 1000;
      const remote = host.inputFor(1);
      if (remote) hostKarts[1].setInput(remote);
      for (const k of hostKarts) k.update(FIXED_DT, track, hostKarts);
      for (const req of host.takeUseRequests()) hostItems.requestUse(hostKarts[req.kartId], req.aimBack);
      hostItems.update(FIXED_DT);
      host.tick60();
      cliKarts[1].setInput(input);
      cliKarts[1].update(FIXED_DT, track, cliKarts);
      client.tick60(input);
      cliItems.update(FIXED_DT);
    };

    // Establish a baseline useSeq on the host first, then press once.
    for (let i = 0; i < SNAPSHOT_EVERY * 2; i++) step();
    step(pressing);
    // Interpolation renders 100 ms behind → give it ~40 ticks (330 ms) to surface.
    for (let i = 0; i < 40; i++) step();

    // Host spawned the banana hazard; the client now has a mirrored hazard mesh at (about) the same spot.
    const hostHaz = hostItems.getHazards();
    expect(hostHaz.length).toBe(1);
    expect(hostHaz[0].type).toBe('banana');
    const cliHaz = cliItems.getHazards();
    expect(cliHaz.length).toBe(1);
    expect(cliHaz[0].id).toBe(hostHaz[0].id);
    expect(cliHaz[0].position.distanceTo(hostHaz[0].position)).toBeLessThan(0.6);
    // Item slot on the client's own kart follows the host (banana consumed).
    expect(cliKarts[1].state.item).toBe('none');
    // FX replay reached the client bus, flagged as the local player.
    expect(seenOnClient).toContain('use:banana:1:true');

    // Boxes: mark one inactive on the host → client mirrors it.
    const hostBoxes = hostItems.getNetItems().boxes;
    expect(hostBoxes.length).toBeGreaterThan(0);
    const hostBox0 = (hostItems as unknown as { boxes: { active: boolean; respawnTimer: number }[] }).boxes[0];
    hostBox0.active = false;
    hostBox0.respawnTimer = 30; // keep it collected long enough to observe on the client
    for (let i = 0; i < 40; i++) step();
    expect(cliItems.getNetItems().boxes[0]).toBe(false);
    expect(cliItems.getActiveBoxPositions().length).toBe(hostBoxes.length - 1);

    // Mirror never simulates: requestUse on the client is a no-op.
    cliKarts[1].state.item = 'banana';
    cliKarts[1].state.itemCount = 1;
    cliItems.requestUse(cliKarts[1], false);
    expect(cliItems.getHazards().length).toBe(1);

    hostItems.dispose();
    cliItems.dispose();
  });

  it('hazards removed on the host disappear on the client', () => {
    const hub = createLoopbackHub();
    const hostT = hub.endpoint('H');
    const cliT = hub.endpoint('C');
    void hostT.joinRoom(null);
    void cliT.joinRoom(null);
    const track = new FakeTrack();
    const hostKarts = makeKarts(0, track);
    const hostItems = new ItemManager(null);
    hostItems.init(track, hostKarts);
    const cliKarts = makeKarts(1, track);
    const cliItems = new ItemManager(null);
    cliItems.init(track, cliKarts);
    cliItems.setNetMode('mirror');
    const host = new HostSession(hostT, roster);
    host.attach({ karts: hostKarts, phase: () => PHASE.racing, countdown: () => 0, raceTime: () => 0, standings: () => [], items: () => hostItems.getNetItems() });
    const client = new ClientSession(cliT, roster, 1, () => now);
    client.attach({ karts: cliKarts, totalLaps: 3, items: cliItems });
    const step = () => {
      now += FIXED_DT * 1000;
      hostItems.update(FIXED_DT);
      host.tick60();
      client.tick60(createEmptyInput());
    };
    hostKarts[0].state.item = 'banana';
    hostKarts[0].state.itemCount = 1;
    hostItems.requestUse(hostKarts[0], true);
    for (let i = 0; i < 40; i++) step();
    expect(cliItems.getHazards().length).toBe(1);
    hostItems.reset(); // clears hazards on the host
    for (let i = 0; i < 40; i++) step();
    expect(cliItems.getHazards().length).toBe(0);
    const karts: IKart[] = cliKarts;
    expect(karts.length).toBe(8);
  });
});
