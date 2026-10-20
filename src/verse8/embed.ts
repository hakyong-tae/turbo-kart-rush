/**
 * Verse8 iframe helpers. The shell needs a size handshake or the iframe can get a zero
 * viewport on some hosts. Two message shapes have been seen in the wild (GAME_SIZE from
 * block-blaster, GAME_SIZE_RESPONSE + REQUEST_GAME_SIZE from server-survival) — send both.
 */
export function inVerse8Host(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.parent !== window) return true;
  } catch {
    return true; // cross-origin parent access threw → we ARE embedded
  }
  // The Verse8 mobile app opens the game directly in its web view (no iframe), so the iframe test alone sent
  // app players to the local mock: saves, purchases and ads never reached Verse8. Verse8 always hands the
  // page an account + signed token, and serves it from a verse8 host.
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('auth') && q.get('account')) return true;
    if (/(^|\.)verse8\.(games|io)$/.test(window.location.hostname)) return true;
  } catch { /* fall through */ }
  return false;
}

function postSize(): void {
  try {
    // Report the VISIBLE viewport only. Using scrollHeight here once made the host grow the
    // iframe past the screen on iPhone, cutting off the bottom of the select-screen footer.
    const width = window.innerWidth;
    const height = window.innerHeight;
    window.parent.postMessage({ type: 'GAME_SIZE', width, height }, '*');
    window.parent.postMessage({ type: 'GAME_SIZE_RESPONSE', width, height }, '*');
  } catch {
    /* not embedded */
  }
}

export function initEmbedHandshake(): void {
  if (!inVerse8Host()) return;
  postSize();
  window.addEventListener('load', postSize);
  window.addEventListener('resize', postSize);
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.data && ev.data.type === 'REQUEST_GAME_SIZE') postSize();
  });
}
