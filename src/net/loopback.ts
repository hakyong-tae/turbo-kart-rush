/**
 * In-memory transport hub for tests and the `?loopback=1` demo. Every endpoint shares one
 * room state; `send` broadcasts to all endpoints (the real relay includes the sender too).
 * Delivery is synchronous by default; call `hub.setManual(true)` and `hub.flush()` for
 * deterministic step-by-step tests.
 */
import type { MessageHandler, RoomListing, RoomState, Transport } from './types';

interface Endpoint {
  account: string;
  onMessage: MessageHandler;
  onState: (s: RoomState) => void;
  inRoom: boolean;
}

export interface LoopbackHub {
  endpoint(account: string): Transport;
  setManual(manual: boolean): void;
  flush(): void;
  readonly state: RoomState;
}

export function createLoopbackHub(roomKey = 'LOOP'): LoopbackHub {
  const endpoints: Endpoint[] = [];
  let state: RoomState = {};
  let manual = false;
  const queue: (() => void)[] = [];

  const dispatch = (fn: () => void): void => {
    if (manual) queue.push(fn);
    else fn();
  };

  const hub: LoopbackHub = {
    get state() {
      return state;
    },
    setManual(m) {
      manual = m;
    },
    flush() {
      const pending = queue.splice(0, queue.length);
      for (const fn of pending) fn();
    },
    endpoint(account: string): Transport {
      const ep: Endpoint = { account, onMessage: () => {}, onState: () => {}, inRoom: false };
      endpoints.push(ep);
      const t: Transport = {
        account,
        status: 'online',
        async connect() {
          return 'online';
        },
        async listRooms(): Promise<RoomListing[]> {
          const count = endpoints.filter((e) => e.inRoom).length;
          return count > 0 ? [{ key: roomKey, count, trackId: (state.trackId as string) ?? '', started: !!state.started }] : [];
        },
        async joinRoom() {
          ep.inRoom = true;
          return roomKey;
        },
        async createRoom() {
          ep.inRoom = true;
          return roomKey;
        },
        async touchRoom() {
          /* no listing to refresh */
        },
        async leaveRoom() {
          ep.inRoom = false;
          await t.updateRoomState({ ['p_' + account]: null });
        },
        async getRoomState() {
          return { ...state };
        },
        async updateRoomState(patch) {
          const next: RoomState = { ...state };
          for (const k of Object.keys(patch)) {
            if (patch[k] === null) delete next[k];
            else next[k] = patch[k];
          }
          state = next;
          const snapshot = { ...state };
          dispatch(() => {
            for (const e of endpoints) if (e.inRoom) e.onState(snapshot);
          });
        },
        send(event, payload) {
          if (!ep.inRoom) return;
          dispatch(() => {
            for (const e of endpoints) if (e.inRoom) e.onMessage(event, payload, account);
          });
        },
        onMessage(h) {
          ep.onMessage = h;
        },
        onRoomState(h) {
          ep.onState = h;
        },
        async ping() {
          return 1;
        },
      };
      return t;
    },
  };
  return hub;
}
