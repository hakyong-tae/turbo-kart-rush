// Build tag: a small badge (bottom-right, until the first tap or key press) saying when this build was made and from
// which commit, so anyone can tell at a glance whether a Verse8 build is the latest (Verse8 sessions can keep building
// an old copy). The text is worked out when the build is made (`buildTag` in vite.config.ts), not kept in a file that
// has to be remembered: it is right in every build. An edition that has no use for it gets an empty tag and no badge.

function show(): void {
  if (!__BUILD_TAG__) return;
  const el = document.createElement('div');
  el.textContent = __BUILD_TAG__;
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', right: '6px', bottom: '6px', zIndex: '2147483000', pointerEvents: 'none',
    font: '11px/1 system-ui, -apple-system, sans-serif', color: '#7c8190', letterSpacing: '0.04em', transition: 'opacity 0.6s',
  });
  document.body.appendChild(el);
  // Stays until the player first touches or presses a key in the game (a timer hid it before anyone looked:
  // the Verse8 preview loads the game the moment the build finishes).
  const hide = () => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 700);
    removeEventListener('pointerdown', hide, true);
    removeEventListener('keydown', hide, true);
  };
  addEventListener('pointerdown', hide, true);
  addEventListener('keydown', hide, true);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
}
