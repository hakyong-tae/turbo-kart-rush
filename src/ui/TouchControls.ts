/**
 * Virtual touch controller: floating stick on the left half (12 o'clock = throttle,
 * 6 o'clock = brake, x = steer), DRIFT / ITEM buttons on the right, pause top-left.
 * Pure DOM; exposes held state via TouchInputSource for InputManager to merge.
 */
import type { TouchInputSource } from '../core/types';
import { el } from './dom';
import { stickToAxes } from './touchMath';
import { events } from '../core/events';
import { t } from '../core/i18n';

const STICK_RADIUS = 60;
const STICK_DEADZONE = 0.12;

type ButtonKey = 'drift' | 'item' | 'pause';

/** setPointerCapture throws for pointers the browser does not consider active (e.g. synthetic events). */
function capture(node: HTMLElement, pointerId: number): void {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    /* fall back to plain event tracking */
  }
}

export class TouchControls implements TouchInputSource {
  steer = 0;
  throttle = 0;
  brake = 0;
  drift = false;
  item = false;
  pause = false;

  private readonly rootNode: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly driftBtn: HTMLElement;
  private readonly itemBtn: HTMLElement;
  private readonly pauseBtn: HTMLElement;
  private stickPointer: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private readonly buttonPointers = new Map<number, ButtonKey>();
  private enabled = false;
  private readonly unsubLang: () => void;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'touch-controls', undefined, root);

    const zone = el('div', 'touch-stick-zone', undefined, this.rootNode);
    this.stick = el('div', 'touch-stick hidden', undefined, zone);
    el('div', 'touch-stick-ring', undefined, this.stick);
    this.knob = el('div', 'touch-knob', undefined, this.stick);

    this.itemBtn = el('button', 'touch-btn touch-item', t('touch.item'), this.rootNode);
    this.driftBtn = el('button', 'touch-btn touch-drift', t('touch.drift'), this.rootNode);
    this.pauseBtn = el('button', 'touch-pause', '❚❚', this.rootNode);
    for (const b of [this.itemBtn, this.driftBtn, this.pauseBtn]) (b as HTMLButtonElement).type = 'button';

    zone.addEventListener('pointerdown', this.onStickDown);
    zone.addEventListener('pointermove', this.onStickMove);
    zone.addEventListener('pointerup', this.onStickUp);
    zone.addEventListener('pointercancel', this.onStickUp);
    zone.addEventListener('lostpointercapture', this.onStickUp);

    this.bindButton(this.driftBtn, 'drift');
    this.bindButton(this.itemBtn, 'item');
    this.bindButton(this.pauseBtn, 'pause');

    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.unsubLang = events.on('ui:langChange', () => this.setLabels(t('touch.drift'), t('touch.item')));

    // Show only on touch-capable devices. `pointer: coarse` catches phones/tablets up front;
    // the one-shot touchstart catches hybrids whose primary pointer is fine.
    if (window.matchMedia?.('(pointer: coarse)').matches) this.setEnabled(true);
    window.addEventListener('touchstart', this.onFirstTouch, { passive: true, once: true });
  }

  /** The overlay's DOM node (Game re-appends it after rebuilding sibling overlays). */
  get rootElement(): HTMLElement {
    return this.rootNode;
  }

  /** Whether the device looks touch-capable (controls become visible during races). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.rootNode.classList.toggle('enabled', on);
    // Lets the HUD stylesheet make room for the buttons (e.g. shrink the minimap).
    this.rootNode.parentElement?.classList.toggle('touch', on);
  }

  /** Relabel the buttons (used when the UI language changes). */
  setLabels(drift: string, item: string): void {
    this.driftBtn.textContent = drift;
    this.itemBtn.textContent = item;
  }

  dispose(): void {
    this.unsubLang();
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener('touchstart', this.onFirstTouch);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.rootNode.remove();
  }

  // ------------------------------------------------------------------ stick

  private readonly onStickDown = (e: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    capture(e.currentTarget as HTMLElement, e.pointerId);
    this.baseX = e.clientX;
    this.baseY = e.clientY;
    this.stick.style.left = `${this.baseX}px`;
    this.stick.style.top = `${this.baseY}px`;
    this.stick.classList.remove('hidden');
    this.applyStick(0, 0);
  };

  private readonly onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    e.preventDefault();
    this.applyStick(e.clientX - this.baseX, e.clientY - this.baseY);
  };

  private readonly onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.resetStick();
  };

  private applyStick(dx: number, dy: number): void {
    const a = stickToAxes(dx, dy, STICK_RADIUS, STICK_DEADZONE);
    this.steer = a.steer;
    this.throttle = a.throttle;
    this.brake = a.brake;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    this.knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
  }

  private resetStick(): void {
    this.stickPointer = null;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.stick.classList.add('hidden');
    this.knob.style.transform = '';
  }

  // ---------------------------------------------------------------- buttons

  private bindButton(node: HTMLElement, key: ButtonKey): void {
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      this.buttonPointers.set(e.pointerId, key);
      this.setButton(key, true);
      capture(node, e.pointerId);
    };
    const up = (e: PointerEvent): void => {
      if (this.buttonPointers.get(e.pointerId) !== key) return;
      this.buttonPointers.delete(e.pointerId);
      this.setButton(key, false);
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
    // Buttons must not trigger the browser's synthetic click on title screens etc.
    node.addEventListener('click', (e) => e.stopPropagation());
  }

  private setButton(key: ButtonKey, held: boolean): void {
    this[key] = held;
    const node = key === 'drift' ? this.driftBtn : key === 'item' ? this.itemBtn : this.pauseBtn;
    node.classList.toggle('held', held);
  }

  private readonly releaseAll = (): void => {
    this.resetStick();
    this.buttonPointers.clear();
    this.setButton('drift', false);
    this.setButton('item', false);
    this.setButton('pause', false);
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private readonly onFirstTouch = (): void => this.setEnabled(true);
}
