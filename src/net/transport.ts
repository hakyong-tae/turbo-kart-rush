/**
 * Real agent8 transport (ported from soldat-web/src/net/transport.ts). Connection lifecycle is
 * delegated to src/verse8/server.ts (SDK store based — never GameServer.connect() directly).
 * Binary payloads are base64-wrapped because the relay JSON-serialises payloads.
 */
import { GameServer } from '@agent8/gameserver';
import { ensureConnected } from '../verse8/server';
import type { MessageHandler, RoomListing, RoomState, Transport } from './types';

const TIMEOUT_MS = 4000;

interface B64Wrapped {
  __b64: string;
}
function isBinary(v: unknown): v is ArrayBuffer | ArrayBufferView {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}
function isWrapped(v: unknown): v is B64Wrapped {
  return typeof v === 'object' && v !== null && typeof (v as B64Wrapped).__b64 === 'string';
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export function wrapForRelay(payload: unknown): unknown {
  if (!isBinary(payload)) return payload;
  const bytes =
    payload instanceof ArrayBuffer ? new Uint8Array(payload) : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  return { __b64: bytesToBase64(bytes) } satisfies B64Wrapped;
}
export function unwrapFromRelay(payload: unknown): unknown {
  return isWrapped(payload) ? base64ToArrayBuffer(payload.__b64) : payload;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('net timeout')), ms))]);

type Server = {
  account?: string;
  remoteFunction: (name: string, args: unknown[], opts?: object) => Promise<unknown>;
  onRoomMessage: (roomId: string, event: string, cb: (m: unknown) => void) => void;
};

export function makeAgent8Transport(): Transport {
  let server: Server | null = null;
  let roomKey: string | null = null;
  let msgHandler: MessageHandler = () => {};
  let stateHandler: (s: RoomState) => void = () => {};

  const t: Transport = {
    account: '',
    status: 'offline',
    async connect() {
      const set = (v: Transport['status']) => {
        (t as { status: Transport['status'] }).status = v;
      };
      set('connecting');
      const ok = await ensureConnected(10000);
      if (!ok) {
        set('offline');
        return t.status;
      }
      server = (GameServer as any).getInstance() as Server;
      let account = server.account ?? '';
      try {
        const { useGameServerStore } = await import('@agent8/gameserver/dist/src/store/useGameServerStore');
        account = useGameServerStore.getState().account || account;
        useGameServerStore.subscribe(({ connected }: { connected: boolean }) => {
          if (t.status === 'offline') return;
          set(connected ? 'online' : 'connecting');
        });
      } catch {
        /* store unavailable — status mirroring only */
      }
      (t as { account: string }).account = account || 'me';
      set('online');
      return t.status;
    },
    async listRooms() {
      if (t.status !== 'online' || !server) return [];
      return ((await withTimeout(server.remoteFunction('listRooms', []), TIMEOUT_MS)) as RoomListing[]) ?? [];
    },
    async ping() {
      if (t.status !== 'online' || !server) return 0;
      const t0 = Date.now();
      await withTimeout(server.remoteFunction('now', []), TIMEOUT_MS);
      return Date.now() - t0;
    },
    async joinRoom(key) {
      if (t.status !== 'online' || !server) throw new Error('offline');
      const res = (await withTimeout(server.remoteFunction('joinRoom', [key]), TIMEOUT_MS)) as { roomId: string };
      return this._bind(res.roomId);
    },
    async createRoom() {
      if (t.status !== 'online' || !server) throw new Error('offline');
      const res = (await withTimeout(server.remoteFunction('createRoom', []), TIMEOUT_MS)) as { roomId: string };
      return this._bind(res.roomId);
    },
    async leaveRoom() {
      if (t.status !== 'online' || !server) return;
      await server.remoteFunction('leaveRoom', []).catch(() => {});
      roomKey = null;
    },
    async touchRoom(key, trackId, started) {
      if (t.status !== 'online' || !server) return;
      await withTimeout(server.remoteFunction('touchRoom', [key, trackId, started]), TIMEOUT_MS);
    },
    async getRoomState() {
      if (t.status !== 'online' || !server) return {};
      return ((await server.remoteFunction('getRoomState', [])) as RoomState) ?? {};
    },
    async updateRoomState(patch) {
      if (t.status !== 'online' || !server) return;
      // Relay WS can flap; fire-and-forget writes get lost. needResponse + 3 retries.
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await withTimeout(server.remoteFunction('updateRoomState', [patch], { needResponse: true }), TIMEOUT_MS);
          return;
        } catch (e) {
          lastErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      console.warn('[net] updateRoomState failed after retries:', lastErr);
      throw lastErr;
    },
    send(event, payload, hot) {
      if (t.status !== 'online' || !server || !roomKey) return;
      if (hot) {
        void server.remoteFunction('relayHot', [event, wrapForRelay(payload)], { throttle: 50, needResponse: false });
      } else {
        void server.remoteFunction('relay', [event, wrapForRelay(payload)], { needResponse: false });
      }
    },
    onMessage(h) {
      msgHandler = h;
    },
    onRoomState(h) {
      stateHandler = h;
    },
  } as Transport & { _bind(key: string): string };

  (t as Transport & { _bind(key: string): string })._bind = (key: string): string => {
    roomKey = key;
    server!.onRoomMessage(key, 'relay', (m) => {
      const { event, payload, from } = m as { event: string; payload: unknown; from: string };
      msgHandler(event, unwrapFromRelay(payload), from);
    });
    server!.onRoomMessage(key, 'state', (m) => stateHandler(m as RoomState));
    return key;
  };
  return t;
}
