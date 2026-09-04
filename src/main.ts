/**
 * Bootstrap: WebGL2 detection, global error handling, then hand over to Game.
 */
import { GAME_TITLE } from './core/constants';
import { Game } from './game/Game';
import { BALANCE, applyBalanceOverrides } from './core/balance';
import { el } from './ui/dom';
import { showToast } from './ui/toast';
import { t } from './core/i18n';
import { initEmbedHandshake } from './verse8/embed';

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    return gl instanceof WebGL2RenderingContext;
  } catch {
    return false;
  }
}

function showFatal(root: HTMLElement, title: string, body: string): void {
  root.replaceChildren();
  const wrap = el('div', 'fatal', undefined, root);
  const panel = el('div', 'glass panel fatal-panel', undefined, wrap);
  el('div', 'panel-kicker', GAME_TITLE, panel);
  el('h2', 'panel-title', title, panel);
  el('p', 'fatal-body', body, panel);
  const retry = el('button', 'btn primary', t('err.reload'), panel);
  retry.type = 'button';
  retry.addEventListener('click', () => window.location.reload());
}

function boot(): void {
  initEmbedHandshake();
  const app = document.getElementById('app') ?? el('div', '', undefined, document.body);
  app.id = 'app';

  if (!hasWebGL2()) {
    showFatal(app, t('err.webgl.title'), t('err.webgl.body'));
    return;
  }

  let errorToasts = 0;
  const report = (message: string, err: unknown): void => {
    console.error(message, err);
    if (errorToasts < 3) {
      errorToasts++;
      showToast(message, 'error');
    }
  };
  window.addEventListener('error', (ev) => {
    report(t('err.runtime', { msg: ev.message || 'unknown' }), ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    report(t('err.rejection', { msg: reason }), ev.reason);
  });

  try {
    const balanceWarnings = applyBalanceOverrides(BALANCE, new URLSearchParams(location.search));
    for (const w of balanceWarnings) console.warn('[balance]', w);
    (window as unknown as { __balance?: typeof BALANCE }).__balance = BALANCE;
    const game = new Game(app);
    game.start();
    (window as unknown as { __turboKartRush?: Game }).__turboKartRush = game;
  } catch (err) {
    console.error('[main] failed to start game', err);
    showFatal(app, t('err.start.title'), t('err.start.body'));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
