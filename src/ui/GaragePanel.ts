/**
 * The garage: paint and dress the kart, then save the look to the account.
 *
 * Tier rule, enforced in one place (`sanitize`, on save and on every render): colours are free,
 * liveries and effects are bought one at a time with coins or all at once with the garage pass.
 * Locked entries are shown, not hidden, each with its price — a player who cannot see what a
 * purchase buys has no reason to make it — and tapping one puts it on the live kart and leaves it
 * there: the turntable is a fitting room. A player can dress the kart in anything and look at it
 * for as long as they like; what they cannot do is take it out of the room. SAVE keeps the half
 * they own, says so, and opens the purchase sheet for the rest.
 *
 * The draft look is local until SAVE. Nothing is written to the account while browsing, so
 * backing out of the panel leaves the saved kart untouched.
 */
import {
  BADGES,
  ENGINE_PACKS,
  FLAMES,
  PATTERNS,
  PRESETS,
  SWATCHES,
  TRAILS,
  UNDERGLOWS,
  WHEEL_FX,
  cosmeticToken,
  isUnlocked,
  lockedParts,
  sanitize,
  unpackCosmetics,
  type BadgeId,
  type CatalogueEntry,
  type CosmeticRef,
  type KartCosmetics,
} from '../core/cosmetics';
import { formatCoins, priceOf } from '../core/economy';
import { t } from '../core/i18n';
import type { CharacterDef, InputState } from '../core/types';
import { getCharacter } from '../kart/roster';
import { inVerse8Host } from '../verse8/embed';
import {
  buyCosmetic,
  getCoins,
  getCosmetics,
  getEntitlements,
  getOwned,
  onEntitlementsChange,
  refreshEntitlements,
  saveCosmetics,
  serverReachable,
} from '../verse8/entitlements';
import { badgeElement } from './badges';
import { button, el, setButtonContent } from './dom';
import { icon } from './icons';
import { GaragePreview } from './garage/GaragePreview';
import { PurchaseSheet, type PurchaseItem } from './garage/PurchaseSheet';
import { showToast } from './toast';

/** Everything the paid tier owns, lifted off a stored look so a save can carry it through. */
function paidPartOf(cos: KartCosmetics): KartCosmetics {
  const full = sanitize(cos, true);
  const free = sanitize(cos, false);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(full)) {
    if (!(key in free)) out[key] = (full as Record<string, unknown>)[key];
  }
  return out as KartCosmetics;
}

/**
 * Catalogue keys are built from ids at runtime (`cos.trail.embers`), which the compile-time key
 * union cannot express. The locale test covers the same ground: every catalogue id has a string.
 */
type LocaleKey = Parameters<typeof t>[0];
const tk = (key: string): string => t(key as LocaleKey);

type ColorField = 'body' | 'accent' | 'rim' | 'helmet' | 'patternColor' | 'underglowColor' | 'trailColor';
type EnumField = 'pattern' | 'underglow' | 'trail' | 'flame' | 'wheelFx' | 'enginePack' | 'badge';
type TabId = 'paint' | EnumField | 'preset';

/** One tab: its catalogue (if any), the colour slot that belongs with it, and its i18n group. */
interface TabDef {
  id: TabId;
  field?: EnumField;
  list?: readonly CatalogueEntry<string>[];
  color?: ColorField;
}

const TABS: readonly TabDef[] = [
  { id: 'paint' },
  { id: 'pattern', field: 'pattern', list: PATTERNS, color: 'patternColor' },
  { id: 'underglow', field: 'underglow', list: UNDERGLOWS, color: 'underglowColor' },
  { id: 'trail', field: 'trail', list: TRAILS, color: 'trailColor' },
  { id: 'flame', field: 'flame', list: FLAMES },
  { id: 'wheelFx', field: 'wheelFx', list: WHEEL_FX },
  { id: 'enginePack', field: 'enginePack', list: ENGINE_PACKS },
  // A badge is a name-tag thing: it shows beside the player's name in the results, the records
  // board and the lobby rather than on the kart, so the preview here is the label, not the model.
  { id: 'badge', field: 'badge', list: BADGES },
  { id: 'preset' },
];

const PAINT_SLOTS: readonly ColorField[] = ['body', 'accent', 'rim', 'helmet'];

export class GaragePanel {
  onClose: (() => void) | null = null;
  /** Opens the VXShop dialog. Wired by Game so this panel never imports the shop. */
  onUnlock: (() => void) | null = null;
  /** Fired after a successful save, so the title-screen showcase can repaint. */
  onSaved: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly tabsBar: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly stateChip: HTMLElement;
  private readonly coinChip: HTMLElement;
  private readonly sheet: PurchaseSheet;
  private readonly unlockBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly preview: GaragePreview;
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();

  private draft: KartCosmetics = {};
  private character: CharacterDef;
  private tab: TabId = 'paint';
  private visible = false;
  /**
   * Set when SAVE was pressed with locked work on the kart. If everything on it is unlocked while
   * the panel is still open — bought piece by piece, or all at once with the pass — the look the
   * player was trying on is saved for them. They have already said they want it, and making them
   * find SAVE again after paying would be a second ask.
   */
  private saveOnUnlock = false;
  private readonly unsubEntitlements: () => void;

  constructor(root: HTMLElement) {
    this.character = getCharacter('zippy');
    this.rootNode = el('div', 'screen garage hidden', undefined, root);
    const panel = el('div', 'panel garage-panel', undefined, this.rootNode);

    const head = el('div', 'garage-head', undefined, panel);
    el('div', 'panel-kicker', t('garage.title'), head);
    this.stateChip = el('span', 'garage-state', '', head);
    // The wallet, where prices are being read.
    this.coinChip = el('span', 'coin-chip garage-coins', undefined, head);
    this.coinChip.title = t('coin.label');

    const body = el('div', 'garage-body', undefined, panel);
    const stage = el('div', 'garage-stage', undefined, body);
    this.preview = new GaragePreview(stage);

    const controls = el('div', 'garage-controls', undefined, body);
    this.tabsBar = el('div', 'garage-tabs', undefined, controls);
    for (const tab of TABS) {
      const b = el('button', 'garage-tab', tk(`garage.tab.${tab.id}`), this.tabsBar);
      b.type = 'button';
      b.addEventListener('click', () => this.setTab(tab.id));
      this.tabButtons.set(tab.id, b);
    }
    this.rows = el('div', 'garage-rows', undefined, controls);

    const actions = el('div', 'actions garage-actions', undefined, panel);
    // One button, two offers: the pass while browsing, the till once something locked is on the kart.
    this.unlockBtn = button(t('garage.unlock'), 'garage-unlock', () => (this.tryingOn ? this.openSheet() : this.onUnlock?.()), 'cart');
    actions.appendChild(this.unlockBtn);
    actions.appendChild(button(t('garage.reset'), 'garage-reset', () => this.reset()));
    this.saveBtn = button(t('garage.save'), 'primary garage-save', () => void this.save());
    actions.appendChild(this.saveBtn);
    actions.appendChild(button(t('menu.back'), 'ghost garage-close', () => this.close(), 'chevron-left'));

    this.sheet = new PurchaseSheet(this.rootNode);
    this.sheet.onBuy = (tokens) => this.buy(tokens);
    this.sheet.onPass = () => this.onUnlock?.();
    this.sheet.onClose = () => this.sheet.hide();

    // Entitlements land asynchronously inside the host. When they do — a purchase completing, or
    // just the first read finishing — the locks and the saved look have to catch up in place.
    this.unsubEntitlements = onEntitlementsChange(() => {
      if (!this.visible) return;
      if (!this.touched) this.draft = { ...getCosmetics() };
      this.apply();
      this.syncChrome();
      this.setTab(this.tab);
      if (this.sheet.isVisible) this.refreshSheet();
      if (this.saveOnUnlock && !this.tryingOn) void this.save(true);
    });
  }

  /**
   * True once the player has changed something. Until then the panel keeps mirroring the stored
   * look, so a late server read does not overwrite edits already made on screen.
   */
  private touched = false;

  /**
   * Whether the server has told us what this account owns. Inside the host it is the truth and it
   * arrives asynchronously; offline there is nothing to wait for.
   *
   * This must never block saving. An earlier version disabled SAVE until the answer came, which
   * on a phone that never got one left the garage permanently stuck on "checking" with paint that
   * would not save. `save()` handles the unknown case by merging instead.
   */
  private get entitlementsKnown(): boolean {
    return !inVerse8Host() || getEntitlements().loaded;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Opens on the character the player last picked, so the preview is the kart they will drive. */
  show(characterId: string): void {
    this.character = getCharacter(characterId);
    this.draft = { ...getCosmetics() };
    this.touched = false;
    // Second chance at the entitlement read: the first one happens at boot, when a phone may
    // still be negotiating the connection. Opening the garage is exactly when the answer matters.
    if (!this.entitlementsKnown) void refreshEntitlements();
    this.saveOnUnlock = false;
    this.preview.setCharacter(this.character, this.draft);
    this.preview.start();
    this.syncChrome();
    this.setTab(this.tab);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.saveOnUnlock = false;
    this.sheet.hide();
    this.preview.stop();
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (!input.back) return;
    if (this.sheet.isVisible) this.sheet.hide();
    else this.close();
  }

  dispose(): void {
    this.unsubEntitlements();
    this.sheet.dispose();
    this.preview.dispose();
    this.rootNode.remove();
  }

  // -------------------------------------------------------------------------

  private get premium(): boolean {
    return getEntitlements().premium;
  }

  private close(): void {
    this.hide();
    this.onClose?.();
  }

  /** What the draft is wearing that this account does not own. */
  private worn(): CosmeticRef[] {
    return lockedParts(sanitize(this.draft, true), this.premium, getOwned());
  }

  /** Coins it takes to buy every buyable piece in `parts`. */
  private costOf(parts: readonly CosmeticRef[]): number {
    return parts.reduce((sum, part) => sum + (priceOf(part.token) ?? 0), 0);
  }

  /** Locked work on the turntable: looking is allowed, keeping is not. */
  private get tryingOn(): boolean {
    return this.entitlementsKnown && this.worn().length > 0;
  }

  private syncChrome(): void {
    const known = this.entitlementsKnown;
    const owned = this.premium;
    const worn = known ? this.worn() : [];
    const trying = worn.length > 0;
    const cost = formatCoins(this.costOf(worn));
    this.stateChip.textContent = !known
      ? t('garage.loading')
      : trying
        ? t('garage.tryingOnCoins', { n: cost })
        : owned
          ? t('garage.owned')
          : t('garage.coinHint');
    this.stateChip.classList.toggle('owned', known && owned && !trying);
    this.stateChip.classList.toggle('trying', trying);
    this.coinChip.replaceChildren(icon('coin'), document.createTextNode(formatCoins(getCoins())));
    this.unlockBtn.classList.toggle('hidden', !known || (owned && !trying));
    setButtonContent(this.unlockBtn, trying ? t('garage.buyWorn', { n: cost }) : t('garage.unlock'), trying ? 'coin' : 'cart');
    // The offer is loudest at the moment the player is looking at what it buys.
    this.unlockBtn.classList.toggle('wanted', trying);
  }

  // ------------------------------------------------------------ purchase sheet

  private openSheet(): void {
    this.refreshSheet();
  }

  /** Re-lists what is still locked on the kart; closes itself once nothing is. */
  private refreshSheet(): void {
    const worn = this.worn();
    if (worn.length === 0) {
      this.sheet.hide();
      return;
    }
    const items: PurchaseItem[] = worn.map((part) => ({
      token: part.token,
      group: tk(`garage.tab.${part.field}`),
      name: tk(`cos.${part.field}.${part.id}`),
      price: priceOf(part.token) ?? null,
    }));
    this.sheet.show(items, getCoins(), !this.premium);
  }

  /**
   * Buys entries one after another. Each reply updates the account record, which re-renders the
   * locks and this sheet through the entitlement listener; when the last piece on the kart is
   * bought, that same listener saves the look.
   */
  private async buy(tokens: readonly string[]): Promise<void> {
    this.saveOnUnlock = true;
    for (const token of tokens) {
      const r = await buyCosmetic(token);
      if (!r || !r.ok) {
        showToast(t(r?.reason === 'short' ? 'buy.notEnough' : 'buy.failed'), 'error');
        break;
      }
    }
    if (this.sheet.isVisible) this.refreshSheet();
  }

  private setTab(id: TabId): void {
    this.tab = id;
    for (const [tabId, b] of this.tabButtons) b.classList.toggle('selected', tabId === id);
    this.rows.textContent = '';
    if (id !== 'flame') this.preview.setBoostHold(false);
    if (id === 'paint') {
      for (const slot of PAINT_SLOTS) this.colorRow(slot);
      el('p', 'garage-hint', t('garage.freeHint'), this.rows);
      return;
    }
    if (id === 'preset') {
      this.presetRow();
      return;
    }
    const tab = TABS.find((x) => x.id === id);
    if (!tab?.list || !tab.field) return;
    this.optionRow(tab.field, tab.list, id);
    if (tab.color) this.colorRow(tab.color);
    // The exhaust only burns under boost, so the flame tab holds the throttle open and turns the
    // kart tail-on; everywhere else the turntable gives it a burst every few seconds.
    this.preview.setBoostHold(id === 'flame');
  }

  /** A labelled strip of swatches plus a "character default" chip. */
  private colorRow(field: ColorField): void {
    const row = el('div', 'garage-row', undefined, this.rows);
    el('span', 'garage-row-label', tk(`garage.color.${field.replace('Color', '')}`), row);
    const grid = el('div', 'garage-swatches', undefined, row);
    const paint = (): void => {
      for (const node of Array.from(grid.children)) {
        const hex = (node as HTMLElement).dataset.hex;
        const on = hex === undefined ? this.draft[field] === undefined : this.draft[field] === Number(hex);
        node.classList.toggle('selected', on);
      }
    };
    const def = el('button', 'garage-swatch garage-swatch-default', '—', grid);
    def.type = 'button';
    def.addEventListener('click', () => {
      delete this.draft[field];
      this.touched = true;
      this.apply();
      paint();
    });
    for (const hex of SWATCHES) {
      const b = el('button', 'garage-swatch', undefined, grid);
      b.type = 'button';
      b.dataset.hex = String(hex);
      b.style.background = `#${hex.toString(16).padStart(6, '0')}`;
      b.addEventListener('click', () => {
        this.draft[field] = hex;
        this.touched = true;
        this.apply();
        paint();
      });
    }
    paint();
  }

  private optionRow(field: EnumField, list: readonly CatalogueEntry<string>[], group: TabId): void {
    const row = el('div', 'garage-row', undefined, this.rows);
    const grid = el('div', 'garage-options', undefined, row);
    const first = list[0].id;
    const paint = (): void => {
      for (const node of Array.from(grid.children)) {
        const id = (node as HTMLElement).dataset.id;
        node.classList.toggle('selected', id === (this.draft[field] ?? first));
      }
    };
    const owned = getOwned();
    for (const entry of list) {
      const locked = !isUnlocked(field, entry.id, this.premium, owned);
      const b = el('button', `garage-option${locked ? ' locked' : ''}`, undefined, grid);
      b.type = 'button';
      b.dataset.id = entry.id;
      if (group === 'badge') {
        const glyph = badgeElement(entry.id as BadgeId, 'badge-glyph garage-option-badge');
        if (glyph) b.appendChild(glyph);
      }
      el('span', 'garage-option-name', tk(`cos.${group}.${entry.id}`), b);
      if (locked) this.lockChip(b, priceOf(cosmeticToken(field, entry.id) ?? ''));
      b.addEventListener('click', () => {
        // Locked or not, it goes on the kart: see the note at the top of the file.
        if (entry.id === first) delete this.draft[field];
        else (this.draft as Record<string, unknown>)[field] = entry.id;
        this.touched = true;
        this.apply();
        paint();
        this.syncChrome();
      });
    }
    paint();
  }

  private presetRow(): void {
    const row = el('div', 'garage-row', undefined, this.rows);
    const grid = el('div', 'garage-options garage-presets', undefined, row);
    for (const preset of PRESETS) {
      // A preset is a set of parts: it costs whatever of them the player has yet to buy.
      const missing = lockedParts(preset.cos, this.premium, getOwned());
      const locked = missing.length > 0;
      const b = el('button', `garage-option${locked ? ' locked' : ''}`, undefined, grid);
      b.type = 'button';
      el('span', 'garage-option-name', tk(`cos.preset.${preset.id}`), b);
      if (locked) this.lockChip(b, this.costOf(missing));
      else if (preset.free) el('span', 'chip garage-option-free', t('garage.presetFree'), b);
      b.addEventListener('click', () => {
        this.draft = { ...preset.cos };
        this.touched = true;
        this.apply();
        this.setTab('preset');
        this.syncChrome();
      });
    }
  }

  /** The mark on a locked entry: its price in coins, or a bare padlock when it has none. */
  private lockChip(host: HTMLElement, price: number | undefined): void {
    const chip = el('span', 'chip lock garage-option-lock', undefined, host);
    if (price && price > 0) {
      chip.classList.add('price');
      chip.append(icon('coin'), document.createTextNode(formatCoins(price)));
    } else {
      chip.appendChild(icon('lock'));
    }
    chip.title = t('garage.locked');
  }

  /** The turntable always shows the whole draft, paid work included; only SAVE checks ownership. */
  private apply(): void {
    this.preview.setCosmetics(sanitize(this.draft, true));
  }

  private reset(): void {
    this.saveOnUnlock = false;
    this.touched = true;
    this.draft = {};
    this.apply();
    this.setTab(this.tab);
    this.syncChrome();
  }

  /**
   * Saves the look. Colours are free and always go through; what happens to the paid half depends
   * on whether we know the account yet.
   *
   * When we do, `sanitize` decides. When we do not — a phone that never got an answer — saving
   * the sanitized draft would quietly delete a paying player's livery, so instead the paid fields
   * already on the account are carried through untouched and only the colours are updated. A free
   * player still cannot add paid work this way, and a premium player cannot lose any.
   *
   * A player trying locked work on keeps it on the turntable: the half they own is saved, the
   * toast says the rest was left out, and the purchase sheet opens. If they buy it, the look they
   * were wearing is saved without another press (`saveOnUnlock`, which calls back in here with
   * `afterPurchase`).
   */
  private async save(afterPurchase = false): Promise<void> {
    const trying = this.tryingOn;
    this.saveOnUnlock = false;
    let next: KartCosmetics;
    if (this.entitlementsKnown) {
      next = sanitize(this.draft, this.premium, getOwned());
    } else {
      const stored = unpackCosmetics(getEntitlements().cos);
      next = { ...paidPartOf(stored), ...sanitize(this.draft, false) };
    }
    if (!trying) this.draft = next;
    const ok = await saveCosmetics(next);
    const message = !this.entitlementsKnown
      ? t('garage.savedColours')
      : // Inside the host a save that did not reach the server is worth a warning. Outside it the
        // account lives on this device to begin with, so there is nothing that failed.
        !ok || (inVerse8Host() && !serverReachable())
        ? t('garage.saveFailed')
        : trying
          ? t('garage.savedWithoutLockedCoins')
          : afterPurchase
            ? t('buy.savedLook')
            : t('garage.saved');
    showToast(message, ok ? 'info' : 'error');
    if (ok) this.onSaved?.();
    if (trying) {
      this.saveOnUnlock = true;
      this.openSheet();
    }
  }
}
