// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetCrazyGamesForTests,
  crazyDevice,
  crazyGameplay,
  crazyHappytime,
  crazyLoading,
  crazyLocale,
  crazyMuted,
  crazyReady,
  onCrazyMute,
  onCrazyReady,
  saveRecord,
  startCrazyGames,
  whenRecordSettled,
} from './crazygames';

// The wrapper with the SDK switched on, against a stand-in SDK. (Under vitest the build-time
// `__CG_SDK__` is a global, so it can be set here; tools/crazygames-sdk-check.mjs does the same
// job in a real browser with the real game.)
const KEY = 'tkr.local.user';
const record = (r: number, f: number, coins: number, extra: object = {}): string => JSON.stringify({ lad: { r, f }, coins, xp: 0, ...extra });

interface FakeOptions {
  initDelay?: number;
  environment?: 'local' | 'crazygames' | 'disabled';
  data?: Record<string, string>;
  dataOff?: boolean;
  muteAudio?: boolean;
  /** 'error': the script tag fails. 'empty': it loads and defines nothing. */
  script?: 'error' | 'empty';
  /** Calls answer with a rejected promise instead of nothing. */
  rejecting?: boolean;
}

function install(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const data: Record<string, string> = { ...(opts.data ?? {}) };
  const listeners: Array<(s: { muteAudio?: boolean }) => void> = [];
  const refuse = (): void => {
    if (!opts.dataOff) return;
    calls.push('data.refused');
    throw Object.assign(new Error('Data module is disabled'), { code: 'dataModuleDisabled' });
  };
  const event = (name: string) => (): unknown => {
    if (opts.environment === 'disabled') throw new Error('SDK disabled');
    calls.push(name);
    return opts.rejecting ? Promise.reject(new Error('refused')) : undefined;
  };
  const sdk = {
    environment: opts.environment ?? 'crazygames',
    init: () => new Promise<void>((resolve) => setTimeout(() => (calls.push('init'), resolve()), opts.initDelay ?? 20)),
    game: {
      settings: { muteAudio: Boolean(opts.muteAudio) },
      loadingStart: event('loadingStart'),
      loadingStop: event('loadingStop'),
      gameplayStart: event('gameplayStart'),
      gameplayStop: event('gameplayStop'),
      happytime: event('happytime'),
      addSettingsChangeListener: (fn: (s: { muteAudio?: boolean }) => void) => void listeners.push(fn),
    },
    data: {
      getItem: (k: string): string | null => (refuse(), calls.push('data.getItem'), k in data ? data[k] : null),
      setItem: (k: string, v: string): void => (refuse(), calls.push('data.setItem'), void (data[k] = v)),
      removeItem: (k: string): void => void delete data[k],
    },
    user: { systemInfo: { device: { type: 'mobile' as const }, locale: 'ko-KR', countryCode: 'KR' } },
  };
  // The script tag: jsdom does not fetch it, so "loading" is played here.
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    const tag = node as unknown as HTMLScriptElement;
    setTimeout(() => {
      if (opts.script === 'error') return void tag.dispatchEvent(new Event('error'));
      if (opts.script !== 'empty') (window as unknown as { CrazyGames?: unknown }).CrazyGames = { SDK: sdk };
      tag.dispatchEvent(new Event('load'));
    }, 10);
    return node;
  });
  return { calls, data, listeners };
}

const ms = (n: number): Promise<unknown> => vi.advanceTimersByTimeAsync(n);

describe('the CrazyGames SDK wrapper, with an SDK behind it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { __CG_SDK__?: boolean }).__CG_SDK__ = true;
    localStorage.clear();
    delete (window as unknown as { CrazyGames?: unknown }).CrazyGames;
    delete (window as unknown as { __cgInit?: unknown }).__cgInit;
    _resetCrazyGamesForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    (globalThis as { __CG_SDK__?: boolean }).__CG_SDK__ = false;
    _resetCrazyGamesForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports loading, then play and breaks, each change once', async () => {
    const { calls } = install();
    startCrazyGames();
    await ms(50);
    expect(crazyReady()).toBe(true);
    expect(calls).toEqual(['init', 'loadingStart']);
    crazyLoading(false);
    crazyGameplay(true);
    crazyGameplay(true);
    crazyGameplay(false);
    crazyGameplay(false);
    crazyGameplay(true);
    crazyHappytime('win');
    expect(calls.slice(2)).toEqual(['loadingStop', 'gameplayStart', 'gameplayStop', 'gameplayStart', 'happytime']);
  });

  it('celebrates sparingly: the first win of a visit, and every cup', async () => {
    const { calls } = install();
    startCrazyGames();
    await ms(50);
    const happy = (): number => calls.filter((c) => c === 'happytime').length;
    crazyHappytime('win');
    expect(happy()).toBe(1);
    // More wins in the same visit are the game's own to celebrate.
    await ms(120_000);
    crazyHappytime('win');
    await ms(120_000);
    crazyHappytime('win');
    expect(happy()).toBe(1);
    // A cup is told every time.
    crazyHappytime('cup');
    expect(happy()).toBe(2);
    await ms(600_000);
    crazyHappytime('cup');
    expect(happy()).toBe(3);
  });

  it('a cup won by a first win is one celebration, not two', async () => {
    const { calls } = install();
    startCrazyGames();
    await ms(50);
    crazyHappytime('win');
    await ms(3000);
    crazyHappytime('cup');
    expect(calls.filter((c) => c === 'happytime')).toHaveLength(1);
  });

  it('tells a late SDK only where the game is now', async () => {
    const { calls } = install({ initDelay: 6000 });
    startCrazyGames();
    crazyLoading(false);
    crazyGameplay(true);
    expect(calls).toEqual([]);
    await ms(6100);
    expect(calls).toEqual(['init', 'gameplayStart']);
  });

  it('passes on the mute switch, the device and the locale', async () => {
    const { listeners } = install({ muteAudio: true });
    const heard: boolean[] = [];
    onCrazyMute((m) => heard.push(m));
    let ready = 0;
    startCrazyGames();
    onCrazyReady(() => ready++);
    await ms(50);
    expect(ready).toBe(1);
    expect(heard).toEqual([true]);
    expect(crazyMuted()).toBe(true);
    expect(crazyDevice()).toBe('mobile');
    expect(crazyLocale()).toBe('ko-KR');
    listeners[0]({ muteAudio: false });
    expect(heard).toEqual([true, false]);
  });

  it('takes the account record when it is further along, before the game reads', async () => {
    const remote = record(7, 6, 740);
    const { calls, data } = install({ data: { [KEY]: remote } });
    startCrazyGames();
    const late = vi.fn();
    let settled = false;
    void whenRecordSettled(KEY, late).then(() => (settled = true));
    await ms(5);
    expect(settled).toBe(false);
    await ms(50);
    expect(settled).toBe(true);
    expect(localStorage.getItem(KEY)).toBe(remote);
    expect(data[KEY]).toBe(remote);
    expect(calls).not.toContain('data.setItem');
    expect(late).not.toHaveBeenCalled();
  });

  it('sends the local record up when it is the one further along', async () => {
    const local = record(9, 9, 1200);
    localStorage.setItem(KEY, local);
    const { data } = install({ data: { [KEY]: record(2, 2, 100) } });
    startCrazyGames();
    void whenRecordSettled(KEY);
    await ms(50);
    expect(localStorage.getItem(KEY)).toBe(local);
    expect(data[KEY]).toBe(local);
  });

  it('writes nothing to the account before it has read it', async () => {
    const remote = record(7, 6, 740);
    const { calls, data } = install({ initDelay: 1000, data: { [KEY]: remote } });
    startCrazyGames();
    void whenRecordSettled(KEY);
    saveRecord(KEY, record(0, 0, 0));
    await ms(1100);
    expect(data[KEY]).toBe(remote);
    saveRecord(KEY, record(8, 7, 800));
    expect(data[KEY]).toBe(record(8, 7, 800));
    expect(calls.filter((c) => c === 'data.setItem')).toHaveLength(1);
  });

  it('stops holding the game after 0.4 s, and brings a late account record in with the race under way', async () => {
    const remote = record(7, 6, 740);
    const { data } = install({ initDelay: 6000, data: { [KEY]: remote } });
    startCrazyGames();
    const late = vi.fn();
    const carry = vi.fn((local: string | null, theirs: string) => JSON.stringify({ ...JSON.parse(theirs), race: JSON.parse(local ?? '{}').race }));
    let settled = false;
    void whenRecordSettled(KEY, late, carry).then(() => (settled = true));
    await ms(350);
    expect(settled).toBe(false);
    await ms(100);
    expect(settled).toBe(true);
    // The game plays on the blank local record and stamps a race.
    const playing = record(1, 0, 0, { race: { id: 'abc' } });
    localStorage.setItem(KEY, playing);
    saveRecord(KEY, playing);
    expect(data[KEY]).toBe(remote);
    await ms(5700);
    expect(late).toHaveBeenCalledTimes(1);
    const merged = record(7, 6, 740, { race: { id: 'abc' } });
    expect(localStorage.getItem(KEY)).toBe(merged);
    expect(data[KEY]).toBe(merged);
  });

  it('a late account record that is not further along changes nothing', async () => {
    const { data } = install({ initDelay: 6000, data: { [KEY]: record(0, 0, 0) } });
    startCrazyGames();
    const late = vi.fn();
    void whenRecordSettled(KEY, late);
    await ms(500);
    const playing = record(1, 0, 0, { race: { id: 'abc' } });
    localStorage.setItem(KEY, playing);
    await ms(5700);
    expect(late).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(playing);
    expect(data[KEY]).toBe(playing);
  });

  it('keeps to the browser when the data module is switched off', async () => {
    const local = record(3, 3, 200);
    localStorage.setItem(KEY, local);
    const { calls } = install({ dataOff: true });
    startCrazyGames();
    void whenRecordSettled(KEY);
    await ms(50);
    saveRecord(KEY, record(4, 4, 260));
    saveRecord(KEY, record(5, 5, 320));
    expect(calls.filter((c) => c === 'data.refused')).toHaveLength(1);
    expect(localStorage.getItem(KEY)).toBe(local);
    crazyGameplay(true);
    expect(calls).toContain('gameplayStart');
  });

  it.each([
    ['the script does not load', { script: 'error' } as FakeOptions],
    ['the script defines nothing', { script: 'empty' } as FakeOptions],
    ['the SDK says it is disabled here', { environment: 'disabled' } as FakeOptions],
  ])('plays on without it when %s', async (_name, opts) => {
    const { calls } = install(opts);
    startCrazyGames();
    let settled = false;
    void whenRecordSettled(KEY).then(() => (settled = true));
    await ms(60);
    expect(crazyReady()).toBe(false);
    expect(settled).toBe(true);
    crazyLoading(false);
    crazyGameplay(true);
    crazyHappytime('cup');
    saveRecord(KEY, 'x');
    expect(calls.filter((c) => c !== 'init')).toEqual([]);
    expect(crazyMuted()).toBe(false);
    expect(crazyDevice()).toBeNull();
  });

  it('uses the tag the page already has, whether it is still loading or has failed', async () => {
    const tag = (): HTMLScriptElement => {
      const t = document.createElement('script');
      t.setAttribute('src', 'https://sdk.crazygames.com/crazygames-sdk-v3.js');
      document.head.append(t);
      return t;
    };
    // Nothing is appended: the page's tag is the one.
    let fake = install();
    const added = vi.mocked(document.head.appendChild);
    let t = tag();
    (window as unknown as { CrazyGames?: unknown }).CrazyGames = undefined;
    startCrazyGames();
    await ms(5);
    expect(added).not.toHaveBeenCalled();
    // Still loading: the tag's own load event is what is waited for.
    expect(crazyReady()).toBe(false);
    added.getMockImplementation()?.(t);
    await ms(50);
    expect(crazyReady()).toBe(true);
    expect(fake.calls).toContain('init');
    t.remove();

    // Failed before anyone was listening: the tag says so.
    _resetCrazyGamesForTests();
    delete (window as unknown as { CrazyGames?: unknown }).CrazyGames;
    vi.mocked(document.head.appendChild).mockRestore();
    fake = install();
    t = tag();
    t.dataset.failed = '1';
    startCrazyGames();
    let settled = false;
    void whenRecordSettled(KEY).then(() => (settled = true));
    await ms(5);
    expect(settled).toBe(true);
    expect(crazyReady()).toBe(false);
    expect(fake.calls).toEqual([]);
    t.remove();
  });

  it('uses an init() the page has already started, and does not start a second', async () => {
    const { calls } = install();
    const page = window as unknown as { CrazyGames?: { SDK: { init(): Promise<void> } }; __cgInit?: Promise<unknown> };
    // What the tag's onload does (vite.config.ts): the script is in, init() is under way.
    vi.mocked(document.head.appendChild).getMockImplementation()?.(document.createElement('script'));
    await ms(10);
    page.__cgInit = page.CrazyGames!.SDK.init().then(() => null, (e: unknown) => e);
    const t = document.createElement('script');
    t.setAttribute('src', 'https://sdk.crazygames.com/crazygames-sdk-v3.js');
    document.head.append(t);
    startCrazyGames();
    await ms(50);
    expect(crazyReady()).toBe(true);
    expect(calls.filter((c) => c === 'init')).toHaveLength(1);
    t.remove();

    // And one the page started that failed: the game goes on without the SDK.
    _resetCrazyGamesForTests();
    page.__cgInit = Promise.resolve(new Error('refused'));
    document.head.append(t);
    startCrazyGames();
    await ms(50);
    expect(crazyReady()).toBe(false);
    t.remove();
    delete page.__cgInit;
  });

  it('gives up on an SDK that never finishes initialising', async () => {
    const { calls } = install({ initDelay: 60_000 });
    startCrazyGames();
    crazyGameplay(true);
    await ms(12_100);
    expect(crazyReady()).toBe(false);
    await ms(60_000);
    expect(crazyReady()).toBe(false);
    expect(calls).toEqual(['init']);
  });

  it('a call that answers with a rejected promise is noted, not thrown', async () => {
    const { calls } = install({ rejecting: true });
    startCrazyGames();
    await ms(50);
    crazyLoading(false);
    crazyGameplay(true);
    await ms(10);
    expect(calls).toContain('gameplayStart');
    expect(console.warn).toHaveBeenCalled();
  });
});
