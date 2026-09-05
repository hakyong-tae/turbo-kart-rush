import { describe, expect, it } from 'vitest';
import { Lobby } from './lobby';
import { createLoopbackHub } from './loopback';

const defaults = { trackId: 'sunny_circuit', difficulty: 'normal' as const, laps: 3 };

describe('Lobby', () => {
  it('first joiner becomes host with default settings; second joiner is a plain player', async () => {
    const hub = createLoopbackHub();
    const a = new Lobby(hub.endpoint('A'), { nick: 'Ay', characterId: 'zippy' }, defaults);
    const b = new Lobby(hub.endpoint('B'), { nick: 'Bee', characterId: 'max' }, defaults);
    const key = await a.quickJoin();
    expect(key).toBe('LOOP');
    expect(a.view.isHost).toBe(true);
    expect(a.view.trackId).toBe('sunny_circuit');
    expect(a.view.canStart).toBe(false); // alone
    await b.joinCode('loop');
    expect(b.view.isHost).toBe(false);
    expect(b.view.players.map((p) => p.account)).toEqual(['A', 'B']);
    expect(a.view.players).toHaveLength(2);
    a.dispose();
    b.dispose();
  });

  it('canStart needs every non-host player ready; character change clears ready', async () => {
    const hub = createLoopbackHub();
    const a = new Lobby(hub.endpoint('A'), { nick: 'Ay', characterId: 'zippy' }, defaults);
    const b = new Lobby(hub.endpoint('B'), { nick: 'Bee', characterId: 'max' }, defaults);
    await a.create();
    await b.joinCode('LOOP');
    expect(a.view.canStart).toBe(false);
    await b.setReady(true);
    expect(a.view.canStart).toBe(true);
    await b.setCharacter('rosa');
    expect(a.view.canStart).toBe(false);
    expect(a.view.players.find((p) => p.account === 'B')?.characterId).toBe('rosa');
    a.dispose();
    b.dispose();
  });

  it('only the host can change settings; leaving removes the player', async () => {
    const hub = createLoopbackHub();
    const a = new Lobby(hub.endpoint('A'), { nick: 'Ay', characterId: 'zippy' }, defaults);
    const b = new Lobby(hub.endpoint('B'), { nick: 'Bee', characterId: 'max' }, defaults);
    await a.create();
    await b.joinCode('LOOP');
    await b.setSettings({ trackId: 'magma_ridge' });
    expect(a.view.trackId).toBe('sunny_circuit');
    await a.setSettings({ trackId: 'magma_ridge', laps: 2 });
    expect(b.view.trackId).toBe('magma_ridge');
    expect(b.view.laps).toBe(2);
    await b.leave();
    expect(a.view.players.map((p) => p.account)).toEqual(['A']);
    expect(b.view.roomKey).toBeNull();
    a.dispose();
    b.dispose();
  });

  it('a late joiner into a room whose host left takes over as host', async () => {
    const hub = createLoopbackHub();
    const a = new Lobby(hub.endpoint('A'), { nick: 'Ay', characterId: 'zippy' }, defaults);
    await a.create();
    await a.setSettings({ trackId: 'neon_nexus' });
    await a.leave();
    const b = new Lobby(hub.endpoint('B'), { nick: 'Bee', characterId: 'max' }, defaults);
    await b.quickJoin();
    expect(b.view.isHost).toBe(true);
    expect(b.view.trackId).toBe('neon_nexus'); // settings survive, host does not
    a.dispose();
    b.dispose();
  });
});
