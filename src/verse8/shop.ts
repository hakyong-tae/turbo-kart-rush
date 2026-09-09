// VXShop integration — "premium-garage" (100 VX, non-consumable): the paid half of the garage
// (patterns, underglow, trails, flames, wheel effects, engine packs, badges) plus every kart,
// forever. One product, no randomness, no second purchase.
//
// Flow (docs.verse8.io/ko/docs/vxshop/implementing-shop-vanilla):
//   client:  VXShop.buyItem("premium-garage") opens the platform purchase dialog
//   server:  $onItemPurchased sets premium on the buyer's user state
//   client:  onClose(purchased) → refreshEntitlements() re-reads the server truth
//
// The entitlement is SERVER-authoritative and only ever read back through the gameserver
// (src/verse8/entitlements.ts). A device is never trusted as a source of purchase truth.
//
// Product must be registered in the Verse8 creator console:
//   id "premium-garage", price 100 VX, non-consumable, lifetime limit 1.
// The retired id "remove-ads" is still honoured server-side in case an old order arrives; it was
// never purchased by anyone, which is why the rename was free to make.

import { VXShop } from '@verse8/platform/vanilla';
import { t } from '../core/i18n';
import { inVerse8Host } from './embed';
import { mockStore, refreshEntitlements } from './entitlements';

export const PRODUCT_PREMIUM = 'premium-garage';
export const PRICE_LABEL = '100 VX';

export function initShop(): void {
  if (!inVerse8Host()) return;
  try {
    VXShop.init({ autoRefresh: true });
    VXShop.onClose((payload: { purchased?: boolean; action?: string }) => {
      void VXShop.refresh();
      if (payload.purchased || payload.action === 'purchased') void refreshEntitlements();
    });
  } catch (err) {
    console.warn('[v8] VXShop init failed:', err);
  }
}

export type BuyResult = 'opened' | 'unregistered' | 'blocked';

/**
 * Open the purchase dialog. 'opened' when a dialog was shown (host or local mock),
 * 'unregistered' when the host has no product with this id (creator console step missing),
 * 'blocked' when the platform refuses it (limit reached / not purchasable / SDK error).
 */
export function buyPremium(): BuyResult {
  if (!inVerse8Host()) {
    mockPurchase();
    return 'opened';
  }
  try {
    const item = VXShop.getItem(PRODUCT_PREMIUM);
    if (!item) {
      console.warn(`[v8] VXShop has no product "${PRODUCT_PREMIUM}" — register it in the creator console (100 VX, non-consumable).`);
      return 'unregistered';
    }
    if (!item.purchasable) {
      console.warn('[v8] premium-garage not purchasable:', item.purchaseBlockReason ?? 'limit reached');
      return 'blocked';
    }
    VXShop.buyItem(PRODUCT_PREMIUM);
    return 'opened';
  } catch (err) {
    console.warn('[v8] VXShop.buyItem failed:', err);
    return 'blocked';
  }
}

// Local-dev stand-in — applies the same rule to the in-memory mock store.
function mockPurchase(): void {
  const overlay = document.createElement('div');
  overlay.className = 'v8-mock';
  overlay.innerHTML = `
    <div class="glass panel v8-mock-panel">
      <div class="panel-kicker">${t('v8.shop.mockTitle')}</div>
      <h2 class="panel-title">${t('v8.shop.item')}</h2>
      <p class="v8-mock-price">${PRICE_LABEL}</p>
      <div class="actions">
        <button type="button" class="btn primary" data-mock="buy">${t('v8.shop.buy')}</button>
        <button type="button" class="btn ghost" data-mock="cancel">${t('v8.shop.close')}</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-mock]') as HTMLElement | null;
    if (!el) return;
    overlay.remove();
    if (el.dataset.mock === 'buy') mockStore.purchase();
  });
  document.body.appendChild(overlay);
}
