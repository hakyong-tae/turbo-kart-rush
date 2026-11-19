/**
 * The game server, run in the page.
 *
 * Outside a Verse8 host there is nobody to ask what the player owns, and the first answer to that
 * was a mock that re-implemented the server's rules in a second place. Two implementations of one
 * rule drift; an economy is exactly where drift is expensive. So this runs root `server.js` itself
 * — the same file the platform deploys — with `$global` backed by `localStorage` and a single
 * local account. What works here works there, because it is the same code.
 *
 * Never loaded inside the host: `callBackend` imports this module lazily, and only when
 * `inVerse8Host()` is false.
 */

type Row = Record<string, unknown>;

const STATE_KEY = 'tkr.local.user';
const ACCOUNT = 'local';

let memory: Row | null = null;

function readState(): Row {
  if (memory) return memory;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') return parsed as Row;
  } catch {
    /* storage unavailable or corrupt: start clean */
  }
  return {};
}

function writeState(next: Row): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    memory = null;
  } catch {
    // Private mode: keep it for the session rather than lose every coin on the next read.
    memory = next;
  }
}

/** The slice of the platform's `$global` that server.js touches, for one local account. */
function localGlobal(): Row {
  const collections: Record<string, Row[]> = {};
  let nextId = 1;
  return {
    async getUserState() {
      return readState();
    },
    async updateUserState(_account: string, patch: Row) {
      const next = { ...readState(), ...patch };
      writeState(next);
      return next;
    },
    async getCollectionItems(id: string, q: { limit?: number } = {}) {
      const rows = collections[id] ?? [];
      return q.limit ? rows.slice(0, q.limit) : rows.slice();
    },
    async addCollectionItem(id: string, data: Row) {
      const row = { ...data, __id: String(nextId++) };
      (collections[id] ??= []).push(row);
      return row;
    },
    async updateCollectionItem(id: string, item: Row) {
      const row = (collections[id] ?? []).find((r) => r.__id === item.__id);
      if (row) Object.assign(row, item);
      return row;
    },
    async deleteCollectionItem(id: string, rowId: string) {
      collections[id] = (collections[id] ?? []).filter((r) => r.__id !== rowId);
    },
    async joinRoom() {},
    async leaveRoom() {},
  };
}

const localRoom = {
  async getRoomState() {
    return {};
  },
  async updateRoomState() {},
  broadcastToRoom() {},
};

/** A wallet cannot hold more than this through the dev parameter. */
const COINS_PARAM_MAX = 9999999;

/**
 * Dev aid: `?coins=5000` sets the local wallet when the page loads, so the garage's prices and the
 * kart sheet can be tried without racing for an hour first. Local only by construction: this
 * module is never loaded inside a Verse8 host, where the wallet is the server's.
 */
function applyCoinsParam(): void {
  let raw: string | null;
  try {
    raw = new URLSearchParams(location.search).get('coins');
  } catch {
    return; // no page (unit tests in a node environment)
  }
  if (raw === null || raw.trim() === '') return;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return;
  writeState({ ...readState(), coins: Math.min(n, COINS_PARAM_MAX) });
}

type ServerInstance = Record<string, (...args: unknown[]) => unknown>;
let instance: Promise<ServerInstance> | null = null;

function server(): Promise<ServerInstance> {
  if (!instance) {
    applyCoinsParam();
    // `?raw` keeps server.js a plain text asset: it is not part of the module graph and is only
    // fetched on this path.
    instance = import('../../server.js?raw').then((mod) => {
      const factory = new Function('$global', '$sender', '$room', `${mod.default}\nreturn Server;`);
      const Server = factory(localGlobal(), { account: ACCOUNT }, localRoom) as new () => ServerInstance;
      return new Server();
    });
  }
  return instance;
}

/** Calls a server function on the in-page server. Rejects exactly where the real one would. */
export async function callLocal<T>(fn: string, args: unknown[] = []): Promise<T> {
  const srv = await server();
  const method = srv[fn];
  if (typeof method !== 'function' || fn.startsWith('_')) throw new Error(`No server function ${fn}.`);
  return (await method.apply(srv, args)) as T;
}

/** The platform's purchase hook, for the mock shop dialog. */
export async function localPurchase(productId: string): Promise<void> {
  await callLocal('$onItemPurchased', [{ account: ACCOUNT, productId, purchaseId: 'local', quantity: 1 }]);
}

export function _resetLocalServerForTests(): void {
  instance = null;
  memory = null;
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}
