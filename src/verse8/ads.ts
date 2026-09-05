// Verse8 ads — port of block-blaster-v8/src/verse8/ads.ts.
//
// Reward confirmation model: the reward is verified SERVER-side by the Verse8 host
// (SSV → ads-verifier.verse8.io → shell). By the time showRewarded() resolves with
// { status: 'rewarded' } it is already server-verified, so the game trusts the resolved
// status and only then asks our gameserver to grant tickets. The game must NOT call
// ads-verifier.verse8.io itself — that endpoint is Origin-gated to verse8.io (401 elsewhere).
//
// @verse8/ads is a STATIC import on purpose: Verse8's build pipeline has been seen
// tree-shaking a dynamically-imported ads SDK straight out of the bundle. It must also
// stay in package.json.

import { Verse8Ads } from '@verse8/ads';
import { t } from '../core/i18n';
import { inVerse8Host } from './embed';

export const PLACEMENT_REWARDED_PREMIUM = 'rewarded_premium_kart';

export function adsSupported(): boolean {
  return inVerse8Host();
}

/** true === the reward was earned. 'dismissed' / 'failed' → false. */
export async function requestRewardedAd(placementId: string): Promise<boolean> {
  if (!inVerse8Host()) return mockRewarded();
  try {
    const result = await Verse8Ads.showRewarded({ placementId, timeoutMs: 120_000 });
    return result?.status === 'rewarded';
  } catch (err) {
    console.warn('[v8] rewarded failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Local-dev stand-in: outside a Verse8 host there is no ad to show, but both reward
// branches still need exercising. Never reachable in production.
// ---------------------------------------------------------------------------

function mockRewarded(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'v8-mock';
    overlay.innerHTML = `
      <div class="glass panel v8-mock-panel">
        <div class="panel-kicker">${t('v8.mockAd.title')}</div>
        <div class="actions">
          <button type="button" class="btn primary" data-mock="grant">${t('v8.mockAd.reward')}</button>
          <button type="button" class="btn ghost" data-mock="deny">${t('v8.mockAd.dismiss')}</button>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-mock]') as HTMLElement | null;
      if (!el) return;
      overlay.remove();
      resolve(el.dataset.mock === 'grant');
    });
    document.body.appendChild(overlay);
  });
}
