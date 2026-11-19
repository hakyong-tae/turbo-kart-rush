/**
 * Stand-ins for the Verse8 SDKs, for build targets that never run on Verse8 (core/platform.ts,
 * `hosted: false`). vite.config.ts points `@agent8/gameserver`, `@verse8/platform/vanilla` and
 * `@verse8/ads` here for those targets, so the bundle carries none of the SDK code and makes none
 * of its network calls.
 *
 * Nothing here is ever reached: every caller asks `inVerse8Host()` first, and that is false for
 * such a target. The shapes only have to satisfy the imports and fail closed if a path is missed —
 * no connection, no user, no ad, nothing for sale.
 */

type Unsubscribe = () => void;

/** `@agent8/gameserver` */
export const GameServer = {
  getInstance(): Record<string, unknown> {
    return {
      account: '',
      remoteFunction: () => Promise.reject(new Error('No game server on this build.')),
      onRoomMessage: (): Unsubscribe => () => undefined,
    };
  },
};

/** `@agent8/gameserver/dist/src/store/useGameServerStore` */
export const useGameServerStore = {
  getState: () => ({ connected: false, account: '', connect: (): void => undefined }),
  subscribe: (): Unsubscribe => () => undefined,
};

/** `@verse8/platform/vanilla` */
export const VXShop = {
  init: (): void => undefined,
  onClose: (): void => undefined,
  refresh: (): Promise<void> => Promise.resolve(),
  getItem: (): null => null,
  buyItem: (): void => undefined,
};
export function getUser(): null {
  return null;
}

/** `@verse8/ads` */
export const Verse8Ads = {
  showRewarded: (): Promise<{ status: string }> => Promise.resolve({ status: 'failed' }),
};
