/**
 * Who the player is, resolved the same way the Verse8 platform resolves it.
 *
 * Two SDKs disagree about where the account comes from. `@verse8/platform` (VXShop) reads it out of
 * the signed `?auth=` token the host appends; `@agent8/gameserver` only looks at `?account=`, and
 * when that is absent it invents `anonymous-<random>` and keeps it in localStorage. On the web both
 * parameters are present and agree, so nothing goes wrong there.
 *
 * Inside the mobile app the game is relaunched from cold, and if the account is not on the URL the
 * gameserver falls back to that invented identity. A webview that does not keep localStorage across
 * an app kill hands out a new one every launch — a brand-new account each time, with no nickname,
 * no tickets and a different `RACER-xxxx` default name. That is exactly QA's report: nickname
 * blank and "random" after a restart, and ad tickets gone.
 *
 * So the account is taken from the auth token first, as the platform does, and handed to the
 * gameserver explicitly. Where neither is available the player genuinely is a guest, and the
 * Settings panel says so rather than letting progress vanish without explanation.
 */
import { getUser } from '@verse8/platform/vanilla';

export type IdentitySource = 'auth' | 'url' | 'guest';

export interface Identity {
  account: string | null;
  source: IdentitySource;
}

let cached: Identity | null = null;

function fromAuthToken(): string | null {
  try {
    // Expiry does not matter for *who* this is — the backend checks the signature and expiry
    // itself on connect. A stale-but-genuine token still names the right player.
    const u = getUser({ ignoreExpiration: true });
    return typeof u?.account === 'string' && u.account.length > 0 ? u.account : null;
  } catch {
    return null;
  }
}

function fromUrl(): string | null {
  try {
    const a = new URLSearchParams(window.location.search).get('account');
    return a && a.length > 0 ? a : null;
  } catch {
    return null;
  }
}

/** Resolved once per page load: the URL does not change under a running game. */
export function resolveIdentity(): Identity {
  if (cached) return cached;
  const auth = fromAuthToken();
  if (auth) return (cached = { account: auth, source: 'auth' });
  const url = fromUrl();
  if (url) return (cached = { account: url, source: 'url' });
  return (cached = { account: null, source: 'guest' });
}

/** True for the gameserver's own invented identity, which does not survive an app restart. */
export function isAnonymousAccount(account: string): boolean {
  return account.startsWith('anonymous-');
}

/** Test seam. */
export function _resetIdentityForTests(): void {
  cached = null;
}
