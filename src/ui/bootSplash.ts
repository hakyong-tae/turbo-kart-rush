/**
 * The splash that index.html draws before any script runs (wordmark and a moving bar), and the
 * one thing the game does with it: take it away once there is something of its own to show.
 */

let gone = false;

/** Fades the splash out and removes it. Safe to call more than once, and where there is none. */
export function dismissBootSplash(): void {
  if (gone || typeof document === 'undefined') return;
  gone = true;
  const node = document.getElementById('boot');
  if (!node) return;
  node.classList.add('gone');
  window.setTimeout(() => node.remove(), 320);
}
