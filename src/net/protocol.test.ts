import { describe, expect, it } from 'vitest';
import {
  INPUT_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_KART_BYTES,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  snapshotBytes,
  type NetHazard,
  type NetKartPose,
} from './protocol';

function pose(id: number, over: Partial<NetKartPose> = {}): NetKartPose {
  return {
    id,
    x: 12.345,
    y: 1.5,
    z: -250.25,
    heading: 2.5,
    speed: 21.37,
    isDrifting: true,
    isBoosting: false,
    isAirborne: false,
    isSpinning: false,
    isFrozen: false,
    finished: false,
    wrongWay: false,
    driftStage: 2,
    lap: 2,
    place: 5,
    checkpointIndex: 7,
    finishTime: 0,
    isInvincible: false,
    isShrunk: true,
    isSquished: false,
    isHopping: false,
    item: 'triple_red_shell',
    itemCount: 2,
    rouletteActive: false,
    ...over,
  };
}

const noItems = { boxes: [], hazards: [] };

describe('protocol', () => {
  it('input round-trips within quantisation, including useSeq', () => {
    const buf = encodeInput({ seq: 65535, steer: -0.5, throttle: 1, brake: 0.25, drift: true, useItemHeld: false, lookBack: true, useSeq: 250 });
    expect(buf.byteLength).toBe(INPUT_BYTES);
    const i = decodeInput(buf);
    expect(i.seq).toBe(65535);
    expect(i.steer).toBeCloseTo(-0.5, 1);
    expect(i.throttle).toBe(1);
    expect(i.brake).toBeCloseTo(0.25, 1);
    expect(i.drift).toBe(true);
    expect(i.useItemHeld).toBe(false);
    expect(i.lookBack).toBe(true);
    expect(i.useSeq).toBe(250);
  });

  it('snapshot round-trips 8 karts with status + item slot', () => {
    const karts = Array.from({ length: 8 }, (_, i) => pose(i, { x: i * 10, finished: i === 0, finishTime: 95.3, place: i + 1 }));
    const buf = encodeSnapshot({ tick: 123456, phase: 2, countdown: 0, raceTime: 42.7, karts, items: noItems });
    expect(buf.byteLength).toBe(SNAPSHOT_HEADER_BYTES + 8 * SNAPSHOT_KART_BYTES + 2);
    const s = decodeSnapshot(buf)!;
    expect(s.tick).toBe(123456);
    expect(s.phase).toBe(2);
    expect(s.raceTime).toBeCloseTo(42.7, 5);
    expect(s.karts).toHaveLength(8);
    const k = s.karts[3];
    expect(k.id).toBe(3);
    expect(Math.abs(k.x - 30)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(k.z - -250.25)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(k.heading - 2.5)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(k.speed - 21.37)).toBeLessThanOrEqual(0.01);
    expect(k.isDrifting).toBe(true);
    expect(k.driftStage).toBe(2);
    expect(k.lap).toBe(2);
    expect(k.place).toBe(4);
    expect(k.checkpointIndex).toBe(7);
    expect(k.isShrunk).toBe(true);
    expect(k.isInvincible).toBe(false);
    expect(k.item).toBe('triple_red_shell');
    expect(k.itemCount).toBe(2);
    expect(s.karts[0].finished).toBe(true);
    expect(s.karts[0].finishTime).toBeCloseTo(95.3, 5);
    expect(s.items).toEqual(noItems);
  });

  it('snapshot carries item boxes bitmask and hazards', () => {
    const boxes = Array.from({ length: 20 }, (_, i) => i % 3 !== 0);
    const hazards: NetHazard[] = [
      { id: 7, kind: 'red_shell', ownerId: 2, x: 10.5, y: 0.35, z: -20.25, hidden: false, airborne: false, resting: false },
      { id: 65000, kind: 'bob_omb', ownerId: -1, x: -5, y: 3, z: 8, hidden: true, airborne: true, resting: false },
      { id: 9, kind: 'banana', ownerId: 0, x: 0, y: 0, z: 0, hidden: false, airborne: false, resting: true },
    ];
    const buf = encodeSnapshot({ tick: 1, phase: 2, countdown: 0, raceTime: 3, karts: [pose(0)], items: { boxes, hazards } });
    expect(buf.byteLength).toBe(snapshotBytes(1, 20, 3));
    const s = decodeSnapshot(buf)!;
    expect(s.items.boxes).toEqual(boxes);
    expect(s.items.hazards).toHaveLength(3);
    expect(s.items.hazards[0]).toMatchObject({ id: 7, kind: 'red_shell', ownerId: 2 });
    expect(Math.abs(s.items.hazards[0].x - 10.5)).toBeLessThanOrEqual(0.01);
    expect(s.items.hazards[1]).toMatchObject({ id: 65000, kind: 'bob_omb', ownerId: -1, hidden: true, airborne: true });
    expect(s.items.hazards[2]).toMatchObject({ kind: 'banana', resting: true });
  });

  it('heading wraps into [-pi, pi]', () => {
    const s = decodeSnapshot(encodeSnapshot({ tick: 0, phase: 1, countdown: 3, raceTime: 0, karts: [pose(0, { heading: 7 })], items: noItems }))!;
    expect(s.karts[0].heading).toBeCloseTo(7 - Math.PI * 2, 3);
    expect(s.countdown).toBe(3);
  });

  it('rejects truncated buffers', () => {
    expect(decodeSnapshot(new ArrayBuffer(3))).toBeNull();
    const buf = encodeSnapshot({ tick: 0, phase: 0, countdown: 0, raceTime: 0, karts: [pose(0)], items: noItems });
    expect(decodeSnapshot(buf.slice(0, buf.byteLength - 1))).toBeNull();
  });
});
