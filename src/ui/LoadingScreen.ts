/**
 * Loading overlay shown while a Track is being built: the wordmark, the circuit's name, laps,
 * theme and difficulty, a checker progress bar and rotating tips.
 *
 * On the very first race the tips give way to the controls legend, once: it used to sit on the
 * title screen for everyone, every time.
 */
import type { TrackDefinition } from '../core/types';
import { clamp01 } from '../core/math';
import { hasSeenControls, markControlsSeen } from '../game/settingsStore';
import { buildControlsLegend } from './controlsLegend';
import { el, TextField } from './dom';
import { icon } from './icons';
import { buildLogo } from './logo';
import { t } from '../core/i18n';
import type { StringKey } from '../core/i18n';

const TIPS: readonly StringKey[] = ['tip.0', 'tip.1', 'tip.2', 'tip.3', 'tip.4', 'tip.5', 'tip.6', 'tip.7', 'tip.8', 'tip.9', 'tip.10', 'tip.11'];

const TIP_INTERVAL = 2.4;

export class LoadingScreen {
  private readonly rootNode: HTMLElement;
  private readonly title: TextField;
  private readonly subtitle: TextField;
  private readonly stars: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tipNode: HTMLElement;
  private readonly tipText: TextField;
  private readonly controlsBox: HTMLElement;
  private tipTimer = 0;
  private tipIndex = 0;
  private progress = -1;
  private visible = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen loading hidden', undefined, root);
    buildLogo(this.rootNode, 'loading-logo');
    const panel = el('div', 'panel loading-panel', undefined, this.rootNode);
    el('div', 'panel-kicker loading-kicker', t('loading.now'), panel);
    this.title = new TextField(el('h2', 'loading-title', '', panel));
    const meta = el('div', 'loading-meta', undefined, panel);
    this.subtitle = new TextField(el('span', 'loading-subtitle', '', meta));
    this.stars = el('span', 'stars', undefined, meta);
    const track = el('div', 'loading-track', undefined, panel);
    this.bar = el('div', 'loading-bar checker', undefined, track);
    this.tipNode = el('div', 'loading-tip', undefined, panel);
    el('span', 'loading-tip-label', t('loading.tip'), this.tipNode);
    this.tipText = new TextField(el('span', 'loading-tip-text', '', this.tipNode));
    this.controlsBox = el('div', 'loading-controls hidden', undefined, panel);
  }

  /** `touch`: the device drives with the on-screen controls, so the first-race legend shows those. */
  show(def: TrackDefinition, touch = false): void {
    this.title.set(def.name.toUpperCase());
    this.subtitle.set(t('loading.subtitle', { laps: def.laps, theme: t(`theme.${def.theme}` as StringKey) }));
    this.stars.replaceChildren();
    for (let i = 0; i < 3; i++) this.stars.appendChild(icon('star', i < def.difficulty ? 'filled on' : 'off'));
    this.tipIndex = Math.floor(Math.random() * TIPS.length);
    this.tipText.set(t(TIPS[this.tipIndex]));
    this.tipTimer = 0;
    // First race on this device: show how to drive instead of a tip, and never again.
    const firstRace = !hasSeenControls();
    this.controlsBox.replaceChildren();
    if (firstRace) {
      markControlsSeen();
      el('div', 'loading-tip-label', t('settings.controls'), this.controlsBox);
      buildControlsLegend(this.controlsBox, touch);
    }
    this.controlsBox.classList.toggle('hidden', !firstRace);
    this.tipNode.classList.toggle('hidden', firstRace);
    this.progress = -1;
    this.setProgress(0);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  setProgress(p: number): void {
    p = clamp01(p);
    if (Math.abs(p - this.progress) < 0.002) return;
    this.progress = p;
    // Width, not scaleX: the fill is a checker and must not stretch.
    this.bar.style.width = `${(p * 100).toFixed(1)}%`;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.tipTimer += dt;
    if (this.tipTimer >= TIP_INTERVAL) {
      this.tipTimer = 0;
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      this.tipText.set(t(TIPS[this.tipIndex]));
      this.tipNode.classList.remove('tip-in');
      void this.tipNode.offsetWidth;
      this.tipNode.classList.add('tip-in');
    }
  }

  dispose(): void {
    this.rootNode.remove();
  }
}
