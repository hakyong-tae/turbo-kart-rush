/**
 * The garage: paint and dress the kart, then save the look to the account.
 *
 * Tier rule, enforced in one place (`sanitize`, on save and on every render): colours are free,
 * liveries and effects need the garage pass. Locked entries are shown, not hidden — a player who
 * cannot see what a purchase buys has no reason to make it — and tapping one puts it on the live
 * kart briefly while the header says the garage pass is what unlocks it.
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
  sanitize,
  unpackCosmetics,
  usesPaid,
  type BadgeId,
  type CatalogueEntry,
  type KartCosmetics,
} from '../core/cosmetics';
import { t } from '../core/i18n';
import type { CharacterDef, InputState } from '../core/types';
import { getCharacter } from '../kart/roster';
import { inVerse8Host } from '../verse8/embed';
import {
  getCosmetics,
  getEntitlements,
  onEntitlementsChange,
  refreshEntitlements,
  saveCosmetics,
  serverReachable,
} from '../verse8/entitlements';
import { badgeElement } from './badges';
import { button, el } from './dom';
import { GaragePreview } from './garage/GaragePreview';
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

/** How long a locked entry stays on the kart before snapping back. */
const AUDITION_MS = 3000;

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
  private readonly unlockBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly preview: GaragePreview;
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();

  private draft: KartCosmetics = {};
  private character: CharacterDef;
  private tab: TabId = 'paint';
  private visible = false;
  /** Set while a locked entry is on the kart; holds the look to restore. */
  private audition: { timer: number; restore: KartCosmetics } | null = null;
  private readonly unsubEntitlements: () => void;

  constructor(root: HTMLElement) {
    this.character = getCharacter('zippy');
    this.rootNode = el('div', 'screen garage hidden', undefined, root);
    const panel = el('div', 'glass panel garage-panel', undefined, this.rootNode);

    const head = el('div', 'garage-head', undefined, panel);
    el('div', 'panel-kicker', t('garage.title'), head);
    this.stateChip = el('span', 'garage-state', '', head);

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
    this.unlockBtn = button(t('garage.unlock'), 'primary garage-unlock', () => this.onUnlock?.());
    actions.appendChild(this.unlockBtn);
    actions.appendChild(button(t('garage.reset'), 'garage-reset', () => this.reset()));
    this.saveBtn = button(t('garage.save'), 'primary garage-save', () => void this.save());
    actions.appendChild(this.saveBtn);
    actions.appendChild(button(t('menu.back'), 'garage-close', () => this.close()));

    // Entitlements land asynchronously inside the host. When they do — a purchase completing, or
    // just the first read finishing — the locks and the saved look have to catch up in place.
    this.unsubEntitlements = onEntitlementsChange(() => {
      if (!this.visible) return;
      if (!this.touched) this.draft = { ...getCosmetics() };
      this.apply();
      this.syncChrome();
      this.setTab(this.tab);
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
    this.cancelAudition();
    this.preview.setCharacter(this.character, this.draft);
    this.preview.start();
    this.syncChrome();
    this.setTab(this.tab);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.cancelAudition();
    this.preview.stop();
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
  }

  dispose(): void {
    this.cancelAudition();
    this.unsubEntitlements();
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

  private syncChrome(): void {
    const known = this.entitlementsKnown;
    const owned = this.premium;
    this.stateChip.textContent = !known ? t('garage.loading') : owned ? t('garage.owned') : t('garage.paidHint');
    this.stateChip.classList.toggle('owned', known && owned);
    this.unlockBtn.classList.toggle('hidden', !known || owned);
  }

  private setTab(id: TabId): void {
    this.tab = id;
    for (const [tabId, b] of this.tabButtons) b.classList.toggle('selected', tabId === id);
    this.rows.textContent = '';
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
    for (const entry of list) {
      const locked = !entry.free && !this.premium;
      const b = el('button', `garage-option${locked ? ' locked' : ''}`, undefined, grid);
      b.type = 'button';
      b.dataset.id = entry.id;
      if (group === 'badge') {
        const glyph = badgeElement(entry.id as BadgeId, 'badge-glyph garage-option-badge');
        if (glyph) b.appendChild(glyph);
      }
      el('span', 'garage-option-name', tk(`cos.${group}.${entry.id}`), b);
      if (locked) el('span', 'garage-option-lock', t('garage.locked'), b);
      b.addEventListener('click', () => {
        if (locked) {
          this.auditionValue(field, entry.id);
          return;
        }
        if (entry.id === first) delete this.draft[field];
        else (this.draft as Record<string, unknown>)[field] = entry.id;
        this.touched = true;
        this.apply();
        paint();
      });
    }
    paint();
  }

  private presetRow(): void {
    const row = el('div', 'garage-row', undefined, this.rows);
    const grid = el('div', 'garage-options garage-presets', undefined, row);
    for (const preset of PRESETS) {
      const locked = usesPaid(preset.cos) && !this.premium;
      const b = el('button', `garage-option${locked ? ' locked' : ''}`, undefined, grid);
      b.type = 'button';
      el('span', 'garage-option-name', tk(`cos.preset.${preset.id}`), b);
      if (locked) el('span', 'garage-option-lock', t('garage.locked'), b);
      else if (preset.free) el('span', 'garage-option-free', t('garage.presetFree'), b);
      b.addEventListener('click', () => {
        if (locked) {
          this.auditionLook({ ...preset.cos });
          return;
        }
        this.draft = { ...preset.cos };
        this.touched = true;
        this.apply();
        this.setTab('preset');
      });
    }
  }

  /** Three seconds of the real thing, then back to the saved draft. */
  private auditionValue(field: EnumField, id: string): void {
    const next = { ...this.draft } as Record<string, unknown>;
    next[field] = id;
    this.auditionLook(next as KartCosmetics);
  }

  private auditionLook(look: KartCosmetics): void {
    const restore = this.audition ? this.audition.restore : { ...this.draft };
    this.cancelAudition(false);
    // Rendered with the gate open: the audition is the one moment a free player sees paid work.
    // The label states the requirement rather than counting the seconds down — what the player
    // needs to know is that this costs the garage pass, not that the peek is about to end.
    this.preview.setCosmetics(sanitize(look, true));
    this.stateChip.textContent = t('garage.needsPass');
    this.stateChip.classList.add('auditioning');
    this.audition = {
      restore,
      timer: window.setTimeout(() => {
        this.audition = null;
        this.draft = restore;
        this.apply();
        this.syncChrome();
        this.stateChip.classList.remove('auditioning');
      }, AUDITION_MS),
    };
  }

  private cancelAudition(restore = true): void {
    if (!this.audition) return;
    clearTimeout(this.audition.timer);
    if (restore) {
      this.draft = this.audition.restore;
      this.apply();
    }
    this.audition = null;
    this.stateChip.classList.remove('auditioning');
  }

  private apply(): void {
    this.preview.setCosmetics(sanitize(this.draft, this.premium));
  }

  private reset(): void {
    this.cancelAudition(false);
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
   */
  private async save(): Promise<void> {
    this.cancelAudition();
    let next: KartCosmetics;
    if (this.entitlementsKnown) {
      next = sanitize(this.draft, this.premium);
    } else {
      const stored = unpackCosmetics(getEntitlements().cos);
      next = { ...paidPartOf(stored), ...sanitize(this.draft, false) };
    }
    this.draft = next;
    const ok = await saveCosmetics(next);
    const message = !this.entitlementsKnown
      ? t('garage.savedColours')
      : ok && serverReachable()
        ? t('garage.saved')
        : t('garage.saveFailed');
    showToast(message, ok ? 'info' : 'error');
    if (ok) this.onSaved?.();
  }
}
