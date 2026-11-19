import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { events } from '../core/events';
import { RaceStatsTracker } from './RaceStatsTracker';

const at = new THREE.Vector3();

describe('RaceStatsTracker', () => {
  afterEach(() => events.clear());

  it('counts what the local kart did, and nothing anyone else did', () => {
    const tracker = new RaceStatsTracker(3);
    const seen: string[] = [];
    tracker.onChange = (stat) => seen.push(stat);

    events.emit('kart:driftEnd', { kartId: 3, boostStage: 1 }); // a stage 1 flick does not count
    events.emit('kart:driftEnd', { kartId: 3, boostStage: 2 });
    events.emit('kart:driftEnd', { kartId: 3, boostStage: 3 });
    events.emit('kart:driftEnd', { kartId: 0, boostStage: 3 });
    events.emit('kart:draftEnd', { kartId: 3, burst: true });
    events.emit('kart:draftEnd', { kartId: 3, burst: false }); // fell out of the wake
    events.emit('kart:boost', { kartId: 3, strength: 1, duration: 1, source: 'start' });
    events.emit('kart:boost', { kartId: 3, strength: 1, duration: 1, source: 'pad' });
    events.emit('item:use', { kartId: 3, item: 'nitro', position: at, isPlayer: true });
    events.emit('item:use', { kartId: 1, item: 'nitro', position: at, isPlayer: false });
    // A hit counts for whoever fired it, on someone else.
    events.emit('item:hit', { kartId: 5, item: 'nitro', position: at, sourceKartId: 3, isPlayer: false });
    events.emit('item:hit', { kartId: 3, item: 'nitro', position: at, sourceKartId: 3, isPlayer: true });
    events.emit('item:hit', { kartId: 3, item: 'nitro', position: at, sourceKartId: 5, isPlayer: true });
    // Walls only: trading paint with another kart is not a wall hit.
    events.emit('kart:collision', { kartId: 3, otherId: null, impulse: 2, position: at });
    events.emit('kart:collision', { kartId: 3, otherId: 4, impulse: 2, position: at });
    events.emit('kart:trick', { kartId: 3, landed: false });
    events.emit('kart:trick', { kartId: 3, landed: true });

    expect(tracker.stats).toEqual({ drift: 2, draft: 1, start: 1, items: 1, hits: 1, walls: 1, tricks: 1 });
    expect(seen).toEqual(['drift', 'drift', 'draft', 'start', 'items', 'hits', 'walls', 'tricks']);
  });

  it('stops at the cap the server would clamp to, and stops listening when disposed', () => {
    const tracker = new RaceStatsTracker(0);
    events.emit('kart:boost', { kartId: 0, strength: 1, duration: 1, source: 'start' });
    events.emit('kart:boost', { kartId: 0, strength: 1, duration: 1, source: 'start' });
    expect(tracker.stats.start).toBe(1);
    tracker.dispose();
    events.emit('kart:trick', { kartId: 0, landed: true });
    expect(tracker.stats.tricks).toBe(0);
  });
});
