// Build tag: a small badge (bottom-right, ~20 s after load) naming the deployed source commit, so anyone can
// tell at a glance whether a Verse8 build is the latest (Verse8 sessions can keep building an old copy).
import { SOURCE_COMMIT, STAMPED_AT } from './buildInfo';

function show(): void {
  const el = document.createElement('div');
  el.textContent = `build ${STAMPED_AT ? STAMPED_AT + ' · ' : ''}${SOURCE_COMMIT}`;
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', right: '6px', bottom: '6px', zIndex: '2147483000', pointerEvents: 'none',
    font: '11px/1 system-ui, -apple-system, sans-serif', color: 'rgba(255,255,255,0.85)',
    background: 'rgba(8,10,20,0.7)', padding: '4px 7px 3px', borderRadius: '6px', transition: 'opacity 0.6s',
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 20000);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
}
