// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The platform SDK verifies the token's signature, which a test cannot forge, so its parser is
// stood in for here. What is under test is this module's order of preference, not the SDK's crypto.
const getUser = vi.fn();
vi.mock('@verse8/platform/vanilla', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));

const { resolveIdentity, isAnonymousAccount, _resetIdentityForTests } = await import('./identity');

function setSearch(q: string): void {
  window.history.replaceState(null, '', `/${q}`);
}

describe('identity', () => {
  beforeEach(() => {
    _resetIdentityForTests();
    getUser.mockReset();
    setSearch('');
  });
  afterEach(() => setSearch(''));

  it('takes the account from the signed auth token first, as the platform does', () => {
    // The mobile-app case this exists for: the host passes ?auth= but not ?account=. The
    // gameserver alone would have invented an anonymous identity here.
    getUser.mockReturnValue({ account: '0xA0e866501087cC66236E95177D72e5A98b87c8b3', verse: 'v', exp: 1 });
    setSearch('?auth=whatever');
    expect(resolveIdentity()).toEqual({ account: '0xA0e866501087cC66236E95177D72e5A98b87c8b3', source: 'auth' });
  });

  it('prefers the auth token even when ?account= is also present', () => {
    getUser.mockReturnValue({ account: '0xAUTH', verse: 'v', exp: 1 });
    setSearch('?account=0xURL&auth=x');
    expect(resolveIdentity().account).toBe('0xAUTH');
  });

  it('falls back to ?account= when there is no usable token', () => {
    getUser.mockImplementation(() => {
      throw new Error('no auth');
    });
    setSearch('?account=0xURL');
    expect(resolveIdentity()).toEqual({ account: '0xURL', source: 'url' });
  });

  it('reports a guest when neither is available, instead of guessing', () => {
    getUser.mockImplementation(() => {
      throw new Error('no auth');
    });
    expect(resolveIdentity()).toEqual({ account: null, source: 'guest' });
  });

  it("recognises the gameserver's invented identity", () => {
    expect(isAnonymousAccount('anonymous-k3j2h1x9')).toBe(true);
    expect(isAnonymousAccount('0xA0e866501087cC66236E95177D72e5A98b87c8b3')).toBe(false);
  });
});
