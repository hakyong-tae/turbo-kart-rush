/**
 * Settings: nickname (for the track records), language, music / SFX volume, the item guide and the
 * controls legend. Opened from the lobby.
 */
import type { InputState } from '../core/types';
import { getLang, setLang, t, type Lang } from '../core/i18n';
import { entitlementsPending, getEntitlements, onEntitlementsChange, serverReachable, setNickname } from '../verse8/entitlements';
import { currentAccount } from '../verse8/server';
import { isAnonymousAccount } from '../verse8/identity';
import { normalizeNickname } from '../verse8/nickname';
import { readAutoAccel, readAutoNext, writeAutoAccel, writeAutoNext } from '../game/settingsStore';
import { requestedTier, type GfxTier } from '../gfx/quality';
import { button, el, TextField } from './dom';
import { buildControlsLegend } from './controlsLegend';
import { ItemGuide } from './ItemGuide';
import { showToast } from './toast';

export type VolumeKind = 'music' | 'sfx';

/** A touch device, where focusing a text field opens a keyboard over half the screen. */
function softKeyboardLikely(): boolean {
  return Boolean(window.matchMedia?.('(pointer: coarse)').matches);
}

export interface SettingsHooks {
  getVolumes: () => { music: number; sfx: number };
  /** Live while dragging: v is 0..1. */
  onVolume: (kind: VolumeKind, v: number) => void;
  /** The player picked a graphics quality ('auto' = let the game decide for this device). */
  onGraphics: (tier: GfxTier | 'auto') => void;
}

const GFX_CHOICES: readonly (GfxTier | 'auto')[] = ['auto', 'low', 'medium', 'high'];

export class SettingsPanel {
  onClose: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly nickInput: HTMLInputElement;
  private readonly accountHint: TextField;
  private readonly langButtons: HTMLButtonElement[] = [];
  private readonly sliders = new Map<VolumeKind, { input: HTMLInputElement; value: HTMLElement }>();
  private readonly guide: ItemGuide;
  private readonly controlsHost: HTMLElement;
  private readonly autoField: HTMLElement;
  private readonly autoButtons: HTMLButtonElement[] = [];
  private readonly gfxButtons: HTMLButtonElement[] = [];
  private readonly nextButtons: HTMLButtonElement[] = [];
  private readonly unsubEntitlements: () => void;
  /** True once the player has touched the field, so a late arrival never overwrites their typing. */
  private nickEdited = false;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly hooks: SettingsHooks,
  ) {
    this.rootNode = el('div', 'screen settings hidden', undefined, root);
    const panel = el('div', 'panel settings-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('settings.title'), panel);

    const nickField = el('label', 'settings-field', undefined, panel);
    el('span', 'settings-label', t('settings.nickname'), nickField);
    this.nickInput = el('input', 'settings-input', undefined, nickField);
    this.nickInput.type = 'text';
    this.nickInput.maxLength = 12;
    this.nickInput.placeholder = t('settings.nicknamePh');
    this.nickInput.autocomplete = 'off';
    // Game keys (WASD, space…) must not drive the menu while typing here.
    this.nickInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.nickInput.addEventListener('input', () => {
      this.nickEdited = true;
    });
    // Soft keyboard (phones): pin the panel to the top and keep the field in view.
    //
    // Only where a soft keyboard actually appears. `.kb` re-aligns the panel from centred to
    // top, and on desktop — where `show()` focuses this field for you — that state was switched
    // on for nothing and then switched off again by the blur from your next click. The panel
    // moved between mousedown and mouseup, so the mouseup landed on a different control and no
    // click event ever reached the button: QA's "the item guide needs two clicks".
    //
    // And even on a phone the same blur happens when you tap away from the field, so the class
    // is dropped a frame later, after any click already in flight has been delivered.
    this.nickInput.addEventListener('focus', () => {
      if (!softKeyboardLikely()) return;
      this.rootNode.classList.add('kb');
      setTimeout(() => this.nickInput.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    });
    this.nickInput.addEventListener('blur', () => {
      requestAnimationFrame(() => this.rootNode.classList.remove('kb'));
    });
    el('span', 'settings-hint', t('settings.nicknameHint'), nickField);
    this.accountHint = new TextField(el('span', 'settings-hint settings-account', '', nickField));

    // Language and graphics share a row: two short pickers, and the panel still fits a 720p
    // window without scrolling.
    const pair = el('div', 'settings-pair', undefined, panel);
    const langField = el('div', 'settings-field', undefined, pair);
    el('span', 'settings-label', t('settings.language'), langField);
    const seg = el('div', 'segmented', undefined, langField);
    for (const lang of ['ko', 'en'] as Lang[]) {
      const b = el('button', 'seg', lang.toUpperCase(), seg);
      b.type = 'button';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setLang(lang);
      });
      this.langButtons.push(b);
    }

    // Graphics quality: the game picks one for the device; this is for the device it got wrong.
    const gfxField = el('div', 'settings-field', undefined, pair);
    el('span', 'settings-label', t('settings.graphics'), gfxField);
    const gfxSeg = el('div', 'segmented', undefined, gfxField);
    for (const choice of GFX_CHOICES) {
      const b = el('button', 'seg', t(`settings.gfx.${choice}`), gfxSeg);
      b.type = 'button';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.hooks.onGraphics(choice);
        this.syncGraphics();
      });
      this.gfxButtons.push(b);
    }
    el('span', 'settings-hint settings-pair-hint', t('settings.graphicsHint'), panel);

    // A second row of switches: auto-advance here, and (touch only) auto-accelerate beside it.
    const pair2 = el('div', 'settings-pair settings-pair-2', undefined, panel);
    // The results screen goes on to the next race by itself unless this is off.
    const nextField = el('div', 'settings-field', undefined, pair2);
    el('span', 'settings-label', t('settings.autoNext'), nextField);
    const nextSeg = el('div', 'segmented', undefined, nextField);
    for (const on of [true, false]) {
      const b = el('button', 'seg', t(on ? 'settings.on' : 'settings.off'), nextSeg);
      b.type = 'button';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        writeAutoNext(on);
        this.syncNext();
      });
      this.nextButtons.push(b);
    }

    this.buildSlider(panel, 'music', t('settings.music'));
    this.buildSlider(panel, 'sfx', t('settings.sfx'));

    // Auto-accelerate: on by default for whoever drives by touch, and theirs to turn off. Shown
    // only on a touch device (decided when the panel opens), where it does something.
    this.autoField = el('div', 'settings-field settings-auto hidden', undefined, pair2);
    el('span', 'settings-label', t('settings.autoAccel'), this.autoField);
    const autoSeg = el('div', 'segmented', undefined, this.autoField);
    for (const on of [true, false]) {
      const b = el('button', 'seg', t(on ? 'settings.on' : 'settings.off'), autoSeg);
      b.type = 'button';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        writeAutoAccel(on);
        this.syncAuto();
      });
      this.autoButtons.push(b);
    }

    // The item guide is a sibling screen rather than another field: it is a page of reading, and
    // burying it under the volume sliders would make settings scroll for everyone.
    this.guide = new ItemGuide(root);
    // Settings steps aside while the guide is up. Both are full-screen panels, so leaving this one
    // behind would show two stacked sheets rather than one page of reading.
    this.guide.onClose = () => {
      if (this.visible) this.rootNode.classList.remove('hidden');
    };
    const guideField = el('div', 'settings-field', undefined, panel);
    guideField.appendChild(button(t('guide.open'), 'ghost settings-wide', () => {
      this.rootNode.classList.add('hidden');
      this.guide.open();
    }));

    // Controls: moved here from the title screen. Filled when the panel opens, because whether
    // this is a touch device is only known once the player has touched something.
    const controlsField = el('div', 'settings-field settings-controls', undefined, panel);
    el('span', 'settings-label', t('settings.controls'), controlsField);
    this.controlsHost = el('div', 'settings-controls-host', undefined, controlsField);

    // The account record arrives asynchronously and, on a phone on a slow connection, often after
    // this panel has already been opened. Reading it once at open is what left the nickname box
    // blank after a restart — the value was simply not there yet, and nothing came back for it.
    this.unsubEntitlements = onEntitlementsChange(() => this.fillFromRecord());

    const actions = el('div', 'actions', undefined, panel);
    actions.appendChild(button(t('settings.save'), 'primary', () => void this.save()));
    actions.appendChild(button(t('settings.close'), 'ghost', () => this.close()));
  }

  private buildSlider(panel: HTMLElement, kind: VolumeKind, label: string): void {
    const field = el('label', 'settings-field settings-slider', undefined, panel);
    const head = el('div', 'settings-slider-head', undefined, field);
    el('span', 'settings-label', label, head);
    const value = el('span', 'settings-slider-value', '100%', head);
    const input = el('input', 'settings-range', undefined, field);
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    // Arrow keys on the slider must not drive the menu behind it.
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      value.textContent = `${Math.round(v * 100)}%`;
      this.hooks.onVolume(kind, v);
    });
    this.sliders.set(kind, { input, value });
  }

  private syncSliders(): void {
    const vols = this.hooks.getVolumes();
    for (const [kind, s] of this.sliders) {
      const pct = Math.round(vols[kind] * 100);
      s.input.value = String(pct);
      s.value.textContent = `${pct}%`;
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.nickEdited = false;
    this.fillFromRecord();
    this.langButtons.forEach((b) => b.classList.toggle('selected', b.textContent?.toLowerCase() === getLang()));
    this.syncSliders();
    this.autoField.classList.toggle('hidden', !this.touchDevice());
    this.syncAuto();
    this.syncGraphics();
    this.syncNext();
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    if (!softKeyboardLikely()) this.nickInput.focus();
  }

  private syncNext(): void {
    const on = readAutoNext();
    this.nextButtons.forEach((b, i) => b.classList.toggle('selected', (i === 0) === on));
  }

  private syncGraphics(): void {
    const chosen = requestedTier() ?? 'auto';
    this.gfxButtons.forEach((b, i) => b.classList.toggle('selected', GFX_CHOICES[i] === chosen));
  }

  private touchDevice(): boolean {
    return Boolean(this.rootNode.parentElement?.classList.contains('touch')) || softKeyboardLikely();
  }

  /** The toggle's two halves, and the legend under it: the stick's job changes with the setting. */
  private syncAuto(): void {
    const on = readAutoAccel();
    this.autoButtons.forEach((b, i) => b.classList.toggle('selected', (i === 0) === on));
    this.controlsHost.replaceChildren();
    const touch = this.touchDevice();
    buildControlsLegend(this.controlsHost, touch, touch && on);
  }

  /** Nickname and account, from whatever the record currently says — called again when it changes. */
  private fillFromRecord(): void {
    const ent = getEntitlements();
    if (!this.nickEdited) this.nickInput.value = ent.nickname;
    // An empty box means "you have not set one". Say so only once that is actually known.
    this.nickInput.placeholder = entitlementsPending() ? t('settings.nickLoading') : t('settings.nicknamePh');
    const acct = currentAccount();
    // A guest identity is the gameserver's own invention and may not survive the app being closed.
    // Say so plainly: a nickname or ticket that vanishes with no explanation reads as a bug in the
    // game, when the real answer is "sign in to Verse8".
    if (!acct) this.accountHint.set(t('settings.accountNone'));
    else if (isAnonymousAccount(acct)) this.accountHint.set(t('settings.accountGuest', { id: acct.slice(-6) }));
    else this.accountHint.set(t('settings.account', { id: acct.slice(-6) }));
  }

  hide(): void {
    this.guide.close();
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    // Back closes the guide first: it opened on top of this panel, so it must close first too.
    if (input.back) {
      if (this.guide.isOpen()) this.guide.close();
      else this.close();
    }
  }

  dispose(): void {
    this.unsubEntitlements();
    this.guide.dispose();
    this.rootNode.remove();
  }

  private close(): void {
    this.hide();
    this.onClose?.();
  }

  private async save(): Promise<void> {
    const name = normalizeNickname(this.nickInput.value);
    if (!name) {
      showToast(t('settings.invalid'), 'error');
      return;
    }
    const stored = await setNickname(name);
    if (stored === null) {
      showToast(t('settings.invalid'), 'error');
      return;
    }
    this.nickInput.value = stored;
    showToast(serverReachable() ? t('settings.saved') : t('settings.offlineSaved'), 'info');
    this.close();
  }
}
