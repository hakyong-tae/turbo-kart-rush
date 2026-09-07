/**
 * Settings: nickname (for the track records), language, music / SFX volume. Opened from the title gear.
 */
import type { InputState } from '../core/types';
import { getLang, setLang, t, type Lang } from '../core/i18n';
import { getEntitlements, serverReachable, setNickname } from '../verse8/entitlements';
import { normalizeNickname } from '../verse8/nickname';
import { button, el } from './dom';
import { showToast } from './toast';

export type VolumeKind = 'music' | 'sfx';

export interface SettingsHooks {
  getVolumes: () => { music: number; sfx: number };
  /** Live while dragging: v is 0..1. */
  onVolume: (kind: VolumeKind, v: number) => void;
}

export class SettingsPanel {
  onClose: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly nickInput: HTMLInputElement;
  private readonly langButtons: HTMLButtonElement[] = [];
  private readonly sliders = new Map<VolumeKind, { input: HTMLInputElement; value: HTMLElement }>();
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly hooks: SettingsHooks,
  ) {
    this.rootNode = el('div', 'screen settings hidden', undefined, root);
    const panel = el('div', 'glass panel settings-panel', undefined, this.rootNode);
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
    el('span', 'settings-hint', t('settings.nicknameHint'), nickField);

    const langField = el('div', 'settings-field', undefined, panel);
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

    this.buildSlider(panel, 'music', t('settings.music'));
    this.buildSlider(panel, 'sfx', t('settings.sfx'));

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
    this.nickInput.value = getEntitlements().nickname;
    this.langButtons.forEach((b) => b.classList.toggle('selected', b.textContent?.toLowerCase() === getLang()));
    this.syncSliders();
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    this.nickInput.focus();
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.back) this.close();
  }

  dispose(): void {
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
