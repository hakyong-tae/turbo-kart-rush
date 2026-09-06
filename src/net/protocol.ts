/**
 * Wire format. INPUT and SNAPSHOT are binary (ArrayBuffer; the transport base64-wraps them for
 * the JSON relay). Everything else is plain JSON.
 */
import { ALL_ITEM_TYPES, type ItemType, type NetHazard, type NetItems, type NetKartPose } from '../core/types';

export type { NetHazard, NetItems, NetKartPose };

export const MSG = {
  INPUT: 'in', // client → host, hot
  SNAPSHOT: 'snap', // host → all, hot
  FX: 'fx', // host → all: batched item events for audio/particles/HUD
  START: 'start', // host → all: race settings + roster
  LOADED: 'loaded', // client → host: my race is built
  RESULTS: 'results', // host → all: final standings
  LEAVE: 'leave', // anyone → all: leaving the room / race
  PING: 'ping', // client → host: my relay RTT
} as const;
export type MsgKind = (typeof MSG)[keyof typeof MSG];

// ── INPUT ────────────────────────────────────────────────────────────────────

export interface NetInput {
  seq: number;
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
  drift: boolean;
  useItemHeld: boolean;
  lookBack: boolean;
  /** Increments on every item-use press; the host fires requestUse when it changes. */
  useSeq: number;
}

export const INPUT_BYTES = 7;

export function encodeInput(i: NetInput): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const v = new DataView(buf);
  v.setInt8(0, Math.round(clamp(i.steer, -1, 1) * 127));
  v.setUint8(1, Math.round(clamp(i.throttle, 0, 1) * 255));
  v.setUint8(2, Math.round(clamp(i.brake, 0, 1) * 255));
  v.setUint8(3, (i.drift ? 1 : 0) | (i.useItemHeld ? 2 : 0) | (i.lookBack ? 4 : 0));
  v.setUint16(4, i.seq & 0xffff);
  v.setUint8(6, i.useSeq & 0xff);
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
    useSeq: buf.byteLength >= 7 ? v.getUint8(6) : 0,
  };
}

// ── SNAPSHOT ─────────────────────────────────────────────────────────────────

export type RacePhase = 0 | 1 | 2 | 3; // grid, countdown, racing, complete
export const PHASE = { grid: 0, countdown: 1, racing: 2, complete: 3 } as const;

export interface Snapshot {
  tick: number;
  phase: RacePhase;
  countdown: number;
  raceTime: number;
  karts: NetKartPose[];
  items: NetItems;
}

export const SNAPSHOT_HEADER_BYTES = 9;
export const SNAPSHOT_KART_BYTES = 21;
export const SNAPSHOT_HAZARD_BYTES = 11;

const F_DRIFT = 1;
const F_BOOST = 2;
const F_AIR = 4;
const F_SPIN = 8;
const F_FROZEN = 16;
const F_FINISHED = 32;
const F_WRONGWAY = 64;

const G_INVINCIBLE = 1;
const G_SHRUNK = 2;
const G_SQUISHED = 4;
const G_HOPPING = 8;
const G_ROULETTE = 16;

const H_HIDDEN = 1;
const H_AIRBORNE = 2;
const H_RESTING = 4;

/** Item code table: 0 = none, then ALL_ITEM_TYPES in order. */
export const ITEM_CODES: readonly ItemType[] = ['none', ...ALL_ITEM_TYPES];
export const HAZARD_KINDS: readonly NetHazard['kind'][] = ['banana', 'green_shell', 'red_shell', 'blue_shell', 'bob_omb'];

export function snapshotBytes(kartCount: number, boxCount: number, hazardCount: number): number {
  return SNAPSHOT_HEADER_BYTES + SNAPSHOT_KART_BYTES * kartCount + 1 + Math.ceil(boxCount / 8) + 1 + SNAPSHOT_HAZARD_BYTES * hazardCount;
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const boxes = s.items.boxes;
  const hazards = s.items.hazards.slice(0, 255);
  const buf = new ArrayBuffer(snapshotBytes(s.karts.length, boxes.length, hazards.length));
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
    v.setUint8(
      o + 18,
      (k.isInvincible ? G_INVINCIBLE : 0) |
        (k.isShrunk ? G_SHRUNK : 0) |
        (k.isSquished ? G_SQUISHED : 0) |
        (k.isHopping ? G_HOPPING : 0) |
        (k.rouletteActive ? G_ROULETTE : 0),
    );
    v.setUint8(o + 19, Math.max(0, ITEM_CODES.indexOf(k.item)));
    v.setUint8(o + 20, clamp(k.itemCount, 0, 255));
    o += SNAPSHOT_KART_BYTES;
  }
  v.setUint8(o, clamp(boxes.length, 0, 255));
  o += 1;
  const maskBytes = Math.ceil(boxes.length / 8);
  for (let i = 0; i < maskBytes; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const idx = i * 8 + bit;
      if (idx < boxes.length && boxes[idx]) byte |= 1 << bit;
    }
    v.setUint8(o + i, byte);
  }
  o += maskBytes;
  v.setUint8(o, hazards.length);
  o += 1;
  for (const h of hazards) {
    v.setUint16(o, h.id & 0xffff);
    v.setUint8(o + 2, Math.max(0, HAZARD_KINDS.indexOf(h.kind)));
    v.setUint8(o + 3, h.ownerId < 0 || h.ownerId > 254 ? 255 : h.ownerId);
    v.setInt16(o + 4, cm(h.x));
    v.setInt16(o + 6, cm(h.y));
    v.setInt16(o + 8, cm(h.z));
    v.setUint8(o + 10, (h.hidden ? H_HIDDEN : 0) | (h.airborne ? H_AIRBORNE : 0) | (h.resting ? H_RESTING : 0));
    o += SNAPSHOT_HAZARD_BYTES;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (buf.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  const v = new DataView(buf);
  const n = v.getUint8(8);
  if (buf.byteLength < SNAPSHOT_HEADER_BYTES + n * SNAPSHOT_KART_BYTES + 2) return null;
  const karts: NetKartPose[] = [];
  let o = SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const flags = v.getUint8(o + 11);
    const g = v.getUint8(o + 18);
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
      isInvincible: (g & G_INVINCIBLE) !== 0,
      isShrunk: (g & G_SHRUNK) !== 0,
      isSquished: (g & G_SQUISHED) !== 0,
      isHopping: (g & G_HOPPING) !== 0,
      rouletteActive: (g & G_ROULETTE) !== 0,
      item: ITEM_CODES[v.getUint8(o + 19)] ?? 'none',
      itemCount: v.getUint8(o + 20),
    });
    o += SNAPSHOT_KART_BYTES;
  }
  const boxCount = v.getUint8(o);
  o += 1;
  const maskBytes = Math.ceil(boxCount / 8);
  if (buf.byteLength < o + maskBytes + 1) return null;
  const boxes: boolean[] = [];
  for (let i = 0; i < boxCount; i++) boxes.push((v.getUint8(o + (i >> 3)) & (1 << (i & 7))) !== 0);
  o += maskBytes;
  const hazardCount = v.getUint8(o);
  o += 1;
  if (buf.byteLength < o + hazardCount * SNAPSHOT_HAZARD_BYTES) return null;
  const hazards: NetHazard[] = [];
  for (let i = 0; i < hazardCount; i++) {
    const hf = v.getUint8(o + 10);
    const owner = v.getUint8(o + 3);
    hazards.push({
      id: v.getUint16(o),
      kind: HAZARD_KINDS[v.getUint8(o + 2)] ?? 'banana',
      ownerId: owner === 255 ? -1 : owner,
      x: v.getInt16(o + 4) / 100,
      y: v.getInt16(o + 6) / 100,
      z: v.getInt16(o + 8) / 100,
      hidden: (hf & H_HIDDEN) !== 0,
      airborne: (hf & H_AIRBORNE) !== 0,
      resting: (hf & H_RESTING) !== 0,
    });
    o += SNAPSHOT_HAZARD_BYTES;
  }
  return {
    tick: v.getUint32(0),
    phase: (v.getUint8(4) & 3) as RacePhase,
    countdown: v.getUint8(5),
    raceTime: v.getUint16(6) / 10,
    karts,
    items: { boxes, hazards },
  };
}

// ── JSON message payloads ────────────────────────────────────────────────────

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
  /** Items on (phase 2). Missing = false for old hosts. */
  items?: boolean;
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

/** One batched item event (host → clients), re-emitted on the client's event bus. */
export interface NetFx {
  e: 'pickup' | 'rouletteEnd' | 'use' | 'hit' | 'destroyed' | 'shellBounce' | 'explosion' | 'lightning' | 'boxRespawn';
  k?: number; // kartId
  s?: number; // sourceKartId
  i?: ItemType;
  p?: [number, number, number];
  r?: number; // radius
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
