// Build tag: a small badge (bottom-right, until the first tap or key press) naming the deployed source commit, so anyone can
// tell at a glance whether a Verse8 build is the latest (Verse8 sessions can keep building an old copy).
import { SOURCE_COMMIT, STAMPED_AT } from './buildInfo';

function show(): void {
  const el = document.createElement('div');
  el.textContent = `build ${STAMPED_AT ? STAMPED_AT + ' · ' : ''}${SOURCE_COMMIT}`;
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
