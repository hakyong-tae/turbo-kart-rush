/**
 * The CrazyGames HTML5 SDK (v3), and the only file that touches it.
 *
 * Everything the game wants from the portal goes through here: loading and gameplay events, the
 * "happy time" celebration, the data module (progress that follows the player's account), the
 * mute setting, and what the portal knows about the device. The rest of the code calls these
 * functions without knowing whether there is an SDK behind them:
 *
 *   - Not a CrazyGames build, or one built with `CG_SDK=0`: every function is a no-op and the
 *     SDK script is never requested. The bundler drops the lot.
 *   - The script does not load (blocked, offline), `init()` fails or does not finish in time, or
 *     the page is on a host the SDK does not serve (its `disabled` environment, where every call
 *     throws): the same no-ops. The game plays as it would without it.
 *   - Nothing waits for the SDK except the first read of the player's record, and that for a
 *     short bounded time (`whenRecordSettled`), so that progress saved to the account is in
 *     place before the game decides whether this is a new player. An SDK later than that still
 *     brings the account's record in; the game re-reads it.
 *
 * What the docs ask (docs.crazygames.com/sdk, read 2026-11-22) and where it is done:
 *   - `game.loadingStart()` when loading starts, `loadingStop()` when it is done.
 *   - `game.gameplayStart()` whenever play starts or resumes, `gameplayStop()` on every break
 *     (menu, results, pause) — but not because the page lost focus: the portal handles that.
 *     The first `gameplayStart` is where the portal stops measuring the initial download.
 *   - `game.happytime()` sparingly.
 *   - `game.settings.muteAudio` takes priority over the game's own sound setting.
 *   - `data` has localStorage's API, is preloaded by `init()`, saves with a debounce, holds 1 MB.
 *   - `user.systemInfo.device.type` and `.locale` instead of sniffing touch or the browser.
 * No ad calls: ads are off for a Basic Launch whatever a game asks for.
 */
/** The same address as `CG_SDK_URL` in vite.config.ts, which writes the tag into the page. */
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
/**
 * How long the first read of the player's record is held for an SDK that is not ready yet, from
 * the moment the game asks. Short: every new player pays whatever part of it is used, and what
 * it buys is only that a player returning on a new device sees the lobby rather than one
 * first-visit race (the account's record comes in either way, see `whenRecordSettled`). With
 * init() started by the page's tag the SDK is normally ready before the game asks at all.
 */
const RECORD_WAIT_MS = 400;
/** After this long without a finished `init()` the SDK is given up on for the session. */
const INIT_TIMEOUT_MS = 12000;

// `__CG_SDK__` is the compile-time switch (vite.config.ts): true only in a CrazyGames build that
// carries the SDK. It is read bare at the top of every function, so that in any other build the
// minifier sees `if (!false) return` and drops the body, the SDK's address included.

interface SdkSettings {
  muteAudio?: boolean;
  disableChat?: boolean;
}
interface Sdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings: SdkSettings;
    addSettingsChangeListener(listener: (settings: SdkSettings) => void): void;
  };
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  user: {
    systemInfo?: { device?: { type?: 'desktop' | 'tablet' | 'mobile' }; locale?: string; countryCode?: string };
  };
}

export type CrazyDevice = 'desktop' | 'tablet' | 'mobile';

let sdk: Sdk | null = null;
let state: 'off' | 'loading' | 'ready' | 'failed' = 'off';
let ready: Promise<boolean> = Promise.resolve(false);

/** What the game wants the portal to believe right now; sent when it changes and when the SDK arrives. */
let wantLoading = false;
let wantPlaying = false;
let sentLoading = false;
let sentPlaying = false;

const muteListeners = new Set<(muted: boolean) => void>();
const readyListeners = new Set<() => void>();

/**
 * Runs an SDK call; anything it throws turns into a console note, never into a game error. The
 * documented calls return nothing, but a call that hands back a promise is watched too, so a
 * rejection does not surface as an unhandled one.
 */
function call(what: string, fn: (s: Sdk) => unknown): void {
  if (!sdk) return;
  try {
    const result = fn(sdk);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, (err) => console.warn(`[crazygames] ${what} failed`, err));
    }
  } catch (err) {
    console.warn(`[crazygames] ${what} failed`, err);
  }
}

function flush(): void {
  if (!sdk) return;
  if (wantLoading !== sentLoading) {
    sentLoading = wantLoading;
    call(wantLoading ? 'loadingStart' : 'loadingStop', (s) => (wantLoading ? s.game.loadingStart() : s.game.loadingStop()));
  }
  if (wantPlaying !== sentPlaying) {
    sentPlaying = wantPlaying;
    call(wantPlaying ? 'gameplayStart' : 'gameplayStop', (s) => (wantPlaying ? s.game.gameplayStart() : s.game.gameplayStop()));
  }
}

/**
 * The SDK's script. The CrazyGames build's index.html already asks for it (an async tag the
 * build puts in <head>, vite.config.ts), so that it downloads alongside the game's own code and
 * is usually here before the game wants it. A page without the tag gets one now.
 */
function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (): void => reject(new Error('the SDK script did not load'));
    let tag = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (tag) {
      if ((window as unknown as { CrazyGames?: { SDK?: Sdk } }).CrazyGames?.SDK) return resolve();
      // The tag notes an error on itself, for the case where it came before anyone listened.
      if (tag.dataset.failed) return failed();
    } else {
      tag = document.createElement('script');
      tag.src = SDK_URL;
      tag.async = true;
      document.head.appendChild(tag);
    }
    tag.addEventListener('load', () => resolve());
    tag.addEventListener('error', failed);
  });
}

/**
 * Asks for the SDK. Call once, as early as the page can: the script downloads while the game's
 * own code starts up. Returns at once; nothing here is awaited by the caller.
 */
export function startCrazyGames(): void {
  if (!__CG_SDK__ || state !== 'off' || typeof document === 'undefined') return;
  state = 'loading';
  wantLoading = true;
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('init timed out')), INIT_TIMEOUT_MS));
  ready = Promise.race([
    loadScript().then(async () => {
      const page = window as unknown as { CrazyGames?: { SDK?: Sdk }; __cgInit?: Promise<unknown> };
      const found = page.CrazyGames?.SDK;
      if (!found) throw new Error('the SDK script loaded but defined nothing');
      // The page's tag has usually started init() already (it settles to null, or to the error);
      // it must only be called once.
      if (page.__cgInit) {
        const err = await page.__cgInit;
        if (err) throw err instanceof Error ? err : new Error(String(err));
      } else {
        await found.init();
      }
      // On a host the SDK does not serve, every call throws: treat it as not there.
      if (found.environment === 'disabled') throw new Error('the SDK is disabled on this host');
      return found;
    }),
    timeout,
  ])
    .then((found) => {
      // A timeout that fired first has already marked the SDK failed: leave it so.
      if (state !== 'loading') return false;
      sdk = found;
      state = 'ready';
      call('settings listener', (s) =>
        s.game.addSettingsChangeListener((settings) => {
          for (const listener of muteListeners) listener(Boolean(settings.muteAudio));
        }),
      );
      flush();
      for (const listener of muteListeners) listener(crazyMuted());
      for (const listener of readyListeners) listener();
      readyListeners.clear();
      return true;
    })
    .catch((err) => {
      state = 'failed';
      console.info('[crazygames] running without the SDK:', err instanceof Error ? err.message : err);
      return false;
    });
}

/** True once the SDK is initialised and usable. */
export function crazyReady(): boolean {
  return state === 'ready';
}

/** Calls `listener` when the SDK is ready (at once if it already is; never if it does not arrive). */
export function onCrazyReady(listener: () => void): void {
  if (state === 'ready') listener();
  else if (state === 'loading') readyListeners.add(listener);
}

// ------------------------------------------------------------------ events

/** The game's own loading: from the first script to the first screen that can be played. */
export function crazyLoading(on: boolean): void {
  if (!__CG_SDK__) return;
  wantLoading = on;
  flush();
}

/**
 * Whether the player is in the game proper (on the grid, racing) or in a break (menus, results,
 * the pause menu). Only changes are sent. Not to be driven by focus or visibility.
 */
export function crazyGameplay(playing: boolean): void {
  if (!__CG_SDK__) return;
  wantPlaying = playing;
  flush();
}

/** A moment worth celebrating: a win, a cup. The portal throws confetti of its own. */
export function crazyHappytime(): void {
  if (!__CG_SDK__) return;
  call('happytime', (s) => s.game.happytime());
}

// ------------------------------------------------------------------ settings and device

/** The portal's mute switch. It outranks the game's own sound setting. */
export function crazyMuted(): boolean {
  if (!sdk) return false;
  try {
    return Boolean(sdk.game.settings?.muteAudio);
  } catch {
    return false;
  }
}

/** Called with the portal's mute switch when it is first known and whenever it changes. Returns the unsubscribe. */
export function onCrazyMute(listener: (muted: boolean) => void): () => void {
  if (!__CG_SDK__) return () => {};
  muteListeners.add(listener);
  if (sdk) listener(crazyMuted());
  return () => muteListeners.delete(listener);
}

/** What kind of device the portal says this is, or null when it has not said. */
export function crazyDevice(): CrazyDevice | null {
  try {
    return sdk?.user.systemInfo?.device?.type ?? null;
  } catch {
    return null;
  }
}

/** The player's locale as the portal knows it ("en-US"), or null. */
export function crazyLocale(): string | null {
  try {
    return sdk?.user.systemInfo?.locale ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the player's record

/** How far along a saved record is: races finished, then coins. Used to pick between two copies. */
export function recordProgress(raw: string | null): [races: number, coins: number] | null {
  if (!raw) return null;
  try {
    // `lad.r` is races started and `lad.f` races finished (server.js); an account from before the
    // ladder has neither, and is told apart by what it has earned.
    const row = JSON.parse(raw) as { lad?: { r?: unknown; f?: unknown }; coins?: unknown; xp?: unknown } | null;
    if (!row || typeof row !== 'object') return null;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return [n(row.lad?.r) + n(row.lad?.f), n(row.coins) + n(row.xp)];
  } catch {
    return null;
  }
}

/** Which of two copies of the record to keep: the one further along. Ties and blanks go to `local`. */
export function pickRecord(local: string | null, remote: string | null): 'local' | 'remote' {
  const a = recordProgress(local);
  const b = recordProgress(remote);
  if (!b) return 'local';
  if (!a) return 'remote';
  if (b[0] !== a[0]) return b[0] > a[0] ? 'remote' : 'local';
  return b[1] > a[1] ? 'remote' : 'local';
}

/**
 * Brings the record in this browser and the one in the player's CrazyGames account together.
 * `key` is the localStorage key the record lives under. Whichever copy is further along wins and
 * is written to the other side, so neither a new device nor a cleared browser loses progress.
 * Resolves true when the local copy was replaced.
 */
function reconcile(key: string, carry?: (local: string | null, remote: string) => string): boolean {
  if (!sdk) return false;
  reconciled = true;
  let local: string | null = null;
  let remote: string | null = null;
  try {
    local = localStorage.getItem(key);
  } catch {
    /* storage unavailable */
  }
  try {
    remote = sdk.data.getItem(key);
  } catch (err) {
    // The data module is off for this game (not enabled at submission) or broken: local only,
    // and no further writes are tried.
    console.warn('[crazygames] data module unavailable', err);
    dataOff = true;
    return false;
  }
  if (pickRecord(local, remote) === 'remote' && remote !== null) {
    // `carry` lets the game keep what must survive from the copy being replaced (a race under way).
    const kept = carry ? carry(local, remote) : remote;
    try {
      localStorage.setItem(key, kept);
    } catch {
      return false;
    }
    if (kept !== remote) call('data.setItem', (s) => s.data.setItem(key, kept));
    return true;
  }
  if (local !== null && local !== remote) call('data.setItem', (s) => s.data.setItem(key, local as string));
  return false;
}

let settled: Promise<void> | null = null;
let replacedAfterTheFact = false;
/** Set when the data module refused a read: the record then lives in this browser only. */
let dataOff = false;
/** Set once the two copies have been compared. Until then nothing is written to the account. */
let reconciled = false;

/**
 * Resolves when the record under `key` is as good as it is going to get before the game reads
 * it: the SDK has arrived and the two copies have been reconciled, or the wait has run out, or
 * there is no SDK. If the SDK arrives later than the wait, the copies are still reconciled then,
 * and `onLate` is called if that replaced the local one (the game re-reads the record);
 * `carryLate` is asked what the replacement should be, given both copies, so that whatever the
 * game has started on the local copy in the meantime is not dropped.
 */
export function whenRecordSettled(
  key: string,
  onLate?: () => void,
  carryLate?: (local: string | null, remote: string) => string,
): Promise<void> {
  if (!__CG_SDK__ || state === 'off' || state === 'failed') return Promise.resolve();
  if (settled) return settled;
  let done = false;
  settled = Promise.race([
    ready.then((ok) => {
      if (!ok) return;
      // `done` here means the game stopped waiting and has been playing on the local copy.
      const replaced = reconcile(key, done ? carryLate : undefined);
      if (done && replaced) {
        replacedAfterTheFact = true;
        onLate?.();
      }
    }),
    new Promise<void>((resolve) => setTimeout(resolve, RECORD_WAIT_MS)),
  ]).then(() => {
    done = true;
  });
  return settled;
}

/** True if the account's copy replaced the local record after the game had already read it. */
export function recordReplacedLate(): boolean {
  return replacedAfterTheFact;
}

/** Mirrors a write of the record to the account. Cheap to call on every save: the SDK debounces. */
export function saveRecord(key: string, value: string): void {
  // Not before the account's copy has been read ("always retrieve your data before setting
  // data"): a blank browser must not write over progress it has not seen yet.
  if (!__CG_SDK__ || !reconciled || dataOff) return;
  call('data.setItem', (s) => s.data.setItem(key, value));
}

/** For tests: forget everything. */
export function _resetCrazyGamesForTests(): void {
  sdk = null;
  state = 'off';
  ready = Promise.resolve(false);
  wantLoading = wantPlaying = sentLoading = sentPlaying = false;
  muteListeners.clear();
  readyListeners.clear();
  settled = null;
  replacedAfterTheFact = false;
  dataOff = reconciled = false;
}
