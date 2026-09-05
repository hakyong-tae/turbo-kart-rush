/**
 * Verse8 iframe helpers. The shell needs a size handshake or the iframe can get a zero
 * viewport on some hosts. Two message shapes have been seen in the wild (GAME_SIZE from
 * block-blaster, GAME_SIZE_RESPONSE + REQUEST_GAME_SIZE from server-survival) — send both.
 */
export function inVerse8Host(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true; // cross-origin parent access threw → we ARE embedded
  }
}

function postSize(): void {
  try {
    const width = Math.max(window.innerWidth, document.documentElement.scrollWidth);
    const height = Math.max(window.innerHeight, document.documentElement.scrollHeight);
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
