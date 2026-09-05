/**
 * Wire format. INPUT and SNAPSHOT are binary (ArrayBuffer; the transport base64-wraps them for
 * the JSON relay). Everything else is plain JSON.
 */
export const MSG = {
  INPUT: 'in', // client → host, hot
  SNAPSHOT: 'snap', // host → all, hot
  START: 'start', // host → all: race settings + roster
  LOADED: 'loaded', // client → host: my race is built
  RESULTS: 'results', // host → all: final standings
  LEAVE: 'leave', // anyone → all: leaving the room / race
  PING: 'ping', // client → host: my relay RTT
} as const;
export type MsgKind = (typeof MSG)[keyof typeof MSG];

export interface NetInput {
  seq: number;
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
  drift: boolean;
  useItemHeld: boolean;
  lookBack: boolean;
}

export const INPUT_BYTES = 6;

export function encodeInput(i: NetInput): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const v = new DataView(buf);
  v.setInt8(0, Math.round(clamp(i.steer, -1, 1) * 127));
  v.setUint8(1, Math.round(clamp(i.throttle, 0, 1) * 255));
  v.setUint8(2, Math.round(clamp(i.brake, 0, 1) * 255));
  v.setUint8(3, (i.drift ? 1 : 0) | (i.useItemHeld ? 2 : 0) | (i.lookBack ? 4 : 0));
  v.setUint16(4, i.seq & 0xffff);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): NetInput {
  const v = new DataView(buf);
  const flags = v.getUint8(3);
  return {
    steer: v.getInt8(0) / 127,
    throttle: v.getUint8(1) / 255,
    brake: v.getUint8(2) / 255,
    drift: (flags & 1) !== 0,
    useItemHeld: (flags & 2) !== 0,
    lookBack: (flags & 4) !== 0,
    seq: v.getUint16(4),
  };
}

export type RacePhase = 0 | 1 | 2 | 3; // grid, countdown, racing, complete
export const PHASE = { grid: 0, countdown: 1, racing: 2, complete: 3 } as const;

export interface NetKartPose {
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  isDrifting: boolean;
  isBoosting: boolean;
  isAirborne: boolean;
  isSpinning: boolean;
  isFrozen: boolean;
  finished: boolean;
  wrongWay: boolean;
  driftStage: 0 | 1 | 2 | 3;
  lap: number;
  place: number;
  checkpointIndex: number;
  finishTime: number;
}

export interface Snapshot {
  tick: number;
  phase: RacePhase;
  countdown: number;
  raceTime: number;
  karts: NetKartPose[];
}

export const SNAPSHOT_HEADER_BYTES = 9;
export const SNAPSHOT_KART_BYTES = 18;

const F_DRIFT = 1;
const F_BOOST = 2;
const F_AIR = 4;
const F_SPIN = 8;
const F_FROZEN = 16;
const F_FINISHED = 32;
const F_WRONGWAY = 64;

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const buf = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + SNAPSHOT_KART_BYTES * s.karts.length);
  const v = new DataView(buf);
  v.setUint32(0, s.tick >>> 0);
  v.setUint8(4, s.phase);
  v.setUint8(5, clamp(Math.round(s.countdown), 0, 255));
  v.setUint16(6, clamp(Math.round(s.raceTime * 10), 0, 65535));
  v.setUint8(8, s.karts.length);
  let o = SNAPSHOT_HEADER_BYTES;
  for (const k of s.karts) {
    v.setUint8(o, k.id);
    v.setInt16(o + 1, cm(k.x));
    v.setInt16(o + 3, cm(k.y));
    v.setInt16(o + 5, cm(k.z));
    v.setInt16(o + 7, Math.round(wrapAngle(k.heading) * 10000));
    v.setInt16(o + 9, clamp(Math.round(k.speed * 100), -32768, 32767));
    v.setUint8(
      o + 11,
      (k.isDrifting ? F_DRIFT : 0) |
        (k.isBoosting ? F_BOOST : 0) |
        (k.isAirborne ? F_AIR : 0) |
        (k.isSpinning ? F_SPIN : 0) |
        (k.isFrozen ? F_FROZEN : 0) |
        (k.finished ? F_FINISHED : 0) |
        (k.wrongWay ? F_WRONGWAY : 0),
    );
    v.setUint8(o + 12, k.driftStage);
    v.setUint8(o + 13, clamp(k.lap, 0, 255));
    v.setUint8(o + 14, clamp(k.place, 0, 255));
    v.setUint8(o + 15, clamp(k.checkpointIndex, 0, 255));
    v.setUint16(o + 16, clamp(Math.round(k.finishTime * 10), 0, 65535));
    o += SNAPSHOT_KART_BYTES;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (buf.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  const v = new DataView(buf);
  const n = v.getUint8(8);
  if (buf.byteLength < SNAPSHOT_HEADER_BYTES + n * SNAPSHOT_KART_BYTES) return null;
  const karts: NetKartPose[] = [];
  let o = SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const flags = v.getUint8(o + 11);
    karts.push({
      id: v.getUint8(o),
      x: v.getInt16(o + 1) / 100,
      y: v.getInt16(o + 3) / 100,
      z: v.getInt16(o + 5) / 100,
      heading: v.getInt16(o + 7) / 10000,
      speed: v.getInt16(o + 9) / 100,
      isDrifting: (flags & F_DRIFT) !== 0,
      isBoosting: (flags & F_BOOST) !== 0,
      isAirborne: (flags & F_AIR) !== 0,
      isSpinning: (flags & F_SPIN) !== 0,
      isFrozen: (flags & F_FROZEN) !== 0,
      finished: (flags & F_FINISHED) !== 0,
      wrongWay: (flags & F_WRONGWAY) !== 0,
      driftStage: (v.getUint8(o + 12) & 3) as 0 | 1 | 2 | 3,
      lap: v.getUint8(o + 13),
      place: v.getUint8(o + 14),
      checkpointIndex: v.getUint8(o + 15),
      finishTime: v.getUint16(o + 16) / 10,
    });
    o += SNAPSHOT_KART_BYTES;
  }
  return {
    tick: v.getUint32(0),
    phase: (v.getUint8(4) & 3) as RacePhase,
    countdown: v.getUint8(5),
    raceTime: v.getUint16(6) / 10,
    karts,
  };
}

// JSON message payloads --------------------------------------------------------

export interface RosterEntry {
  account: string;
  nick: string;
  characterId: string;
  kartId: number;
}

export interface StartMsg {
  trackId: string;
  difficulty: string;
  laps: number;
  roster: RosterEntry[];
  hostEpoch: number;
}

export interface StandingMsg {
  kartId: number;
  name: string;
  color: number;
  place: number;
  finishTime: number;
  account?: string;
}

export interface ResultsMsg {
  standings: StandingMsg[];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function cm(m: number): number {
  return clamp(Math.round(m * 100), -32768, 32767);
}
function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
