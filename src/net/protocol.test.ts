import { describe, expect, it } from 'vitest';
import {
  INPUT_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_KART_BYTES,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
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
    ...over,
  };
}

describe('protocol', () => {
  it('input round-trips within quantisation', () => {
    const buf = encodeInput({ seq: 65535, steer: -0.5, throttle: 1, brake: 0.25, drift: true, useItemHeld: false, lookBack: true });
    expect(buf.byteLength).toBe(INPUT_BYTES);
    const i = decodeInput(buf);
    expect(i.seq).toBe(65535);
    expect(i.steer).toBeCloseTo(-0.5, 1);
    expect(i.throttle).toBe(1);
    expect(i.brake).toBeCloseTo(0.25, 1);
    expect(i.drift).toBe(true);
    expect(i.useItemHeld).toBe(false);
    expect(i.lookBack).toBe(true);
  });

  it('snapshot round-trips 8 karts in 153 bytes', () => {
    const karts = Array.from({ length: 8 }, (_, i) => pose(i, { x: i * 10, finished: i === 0, finishTime: 95.3, place: i + 1 }));
    const buf = encodeSnapshot({ tick: 123456, phase: 2, countdown: 0, raceTime: 42.7, karts });
    expect(buf.byteLength).toBe(SNAPSHOT_HEADER_BYTES + 8 * SNAPSHOT_KART_BYTES);
    expect(buf.byteLength).toBe(153);
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
    expect(s.karts[0].finished).toBe(true);
    expect(s.karts[0].finishTime).toBeCloseTo(95.3, 5);
    expect(s.karts[1].finished).toBe(false);
  });

  it('heading wraps into [-pi, pi]', () => {
    const s = decodeSnapshot(encodeSnapshot({ tick: 0, phase: 1, countdown: 3, raceTime: 0, karts: [pose(0, { heading: 7 })] }))!;
    expect(s.karts[0].heading).toBeCloseTo(7 - Math.PI * 2, 3);
    expect(s.countdown).toBe(3);
  });

  it('rejects truncated buffers', () => {
    expect(decodeSnapshot(new ArrayBuffer(3))).toBeNull();
    const buf = encodeSnapshot({ tick: 0, phase: 0, countdown: 0, raceTime: 0, karts: [pose(0)] });
    expect(decodeSnapshot(buf.slice(0, buf.byteLength - 1))).toBeNull();
  });
});
