// VXShop integration — "remove-ads" (100 VX, non-consumable) = every kart unlocked forever.
//
// Flow (docs.verse8.io/ko/docs/vxshop/implementing-shop-vanilla):
//   client:  VXShop.buyItem("remove-ads") opens the platform purchase dialog
//   server:  $onItemPurchased sets adsRemoved on the buyer's user state
//   client:  onClose(purchased) → refreshEntitlements() re-reads the server truth
//
// The entitlement is SERVER-authoritative and only ever read back through the gameserver
// (src/verse8/entitlements.ts). A device is never trusted as a source of purchase truth.
//
// Product must be registered in the Verse8 creator console:
//   id "remove-ads", price 100 VX, non-consumable, lifetime limit 1.

import { VXShop } from '@verse8/platform/vanilla';
import { t } from '../core/i18n';
import { inVerse8Host } from './embed';
import { mockStore, refreshEntitlements } from './entitlements';

export const PRODUCT_REMOVE_ADS = 'remove-ads';
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

/**
 * Open the purchase dialog. Returns true when a dialog was shown (host or local mock),
 * false when the product is not purchasable (unregistered / limit reached).
 */
export function buyRemoveAds(): boolean {
  if (!inVerse8Host()) {
    mockPurchase();
    return true;
  }
  try {
    const item = VXShop.getItem(PRODUCT_REMOVE_ADS);
    if (item && !item.purchasable) {
      console.warn('[v8] remove-ads not purchasable:', item.purchaseBlockReason ?? 'limit reached');
      return false;
    }
    VXShop.buyItem(PRODUCT_REMOVE_ADS);
    return true;
  } catch (err) {
    console.warn('[v8] VXShop.buyItem failed:', err);
    return false;
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
