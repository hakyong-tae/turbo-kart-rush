/**
 * Settings: nickname (for the track records), language, mute. Opened from the title gear.
 */
import type { InputState } from '../core/types';
import { getLang, setLang, t, type Lang } from '../core/i18n';
import { getEntitlements, serverReachable, setNickname } from '../verse8/entitlements';
import { normalizeNickname } from '../verse8/nickname';
import { button, el } from './dom';
import { showToast } from './toast';

export interface SettingsHooks {
  isMuted: () => boolean;
  onToggleMute: () => void;
}

export class SettingsPanel {
  onClose: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly nickInput: HTMLInputElement;
  private readonly langButtons: HTMLButtonElement[] = [];
  private readonly muteBox: HTMLInputElement;
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

    const muteField = el('label', 'settings-field settings-row', undefined, panel);
    el('span', 'settings-label', t('settings.mute'), muteField);
    this.muteBox = el('input', 'settings-check', undefined, muteField);
    this.muteBox.type = 'checkbox';
    this.muteBox.addEventListener('change', () => {
      if (this.muteBox.checked !== this.hooks.isMuted()) this.hooks.onToggleMute();
    });

    const actions = el('div', 'actions', undefined, panel);
    actions.appendChild(button(t('settings.save'), 'primary', () => void this.save()));
    actions.appendChild(button(t('settings.close'), 'ghost', () => this.close()));
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.nickInput.value = getEntitlements().nickname;
    this.langButtons.forEach((b) => b.classList.toggle('selected', b.textContent?.toLowerCase() === getLang()));
    this.muteBox.checked = this.hooks.isMuted();
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
