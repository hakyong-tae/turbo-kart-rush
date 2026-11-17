/**
 * Tiny DOM helpers shared by the UI layer (workstream A).
 */
import { icon, type IconName } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
  parent?: HTMLElement | null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

export function cssHex(color: number): string {
  return '#' + ((color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

export function cssRgba(color: number, alpha: number): string {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Remove + re-add a class so its CSS animation restarts. */
export function restartAnimation(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  // Force a style flush so the browser notices the class was removed.
  void node.offsetWidth;
  node.classList.add(cls);
}

/** Text node wrapper that only touches the DOM when the string actually changes. */
export class TextField {
  private value = '';
  constructor(readonly node: HTMLElement) {}
  set(text: string): boolean {
    if (text === this.value) return false;
    this.value = text;
    this.node.textContent = text;
    return true;
  }
  get(): string {
    return this.value;
  }
}

/**
 * A `.btn`. With `iconName` the icon sits before the label; the label goes in its own span so a
 * narrow layout can drop it and keep the icon (`.btn-label`).
 */
export function button(label: string, className: string, onClick: () => void, iconName?: IconName): HTMLButtonElement {
  const b = el('button', `btn ${className}`.trim());
  b.type = 'button';
  setButtonContent(b, label, iconName);
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}

/** Replace a button's icon + label in place (a button whose wording changes with state). */
export function setButtonContent(b: HTMLElement, label: string, iconName?: IconName): void {
  b.replaceChildren();
  if (iconName) b.appendChild(icon(iconName));
  if (label) el('span', 'btn-label', label, b);
}

/** A key cap. Arrow keys are drawn (`kbdIcon`), never typed as glyphs. */
export function kbd(parent: HTMLElement, text: string): HTMLElement {
  return el('kbd', '', text, parent);
}

export function kbdIcon(parent: HTMLElement, iconName: IconName): HTMLElement {
  const k = el('kbd', 'kbd-icon', undefined, parent);
  k.appendChild(icon(iconName));
  return k;
}

/**
 * Keyboard-focus ring over a list of buttons (driven by InputState menu edges).
 * Mouse hover moves the ring too so both input methods agree.
 */
export class FocusRing {
  private index = 0;
  private readonly items: HTMLElement[] = [];

  constructor(private readonly onActivate: (index: number) => void) {}

  add(node: HTMLElement): void {
    const i = this.items.length;
    this.items.push(node);
    node.addEventListener('pointerenter', () => this.set(i));
    if (i === 0) node.classList.add('focused');
  }

  clear(): void {
    this.items.length = 0;
    this.index = 0;
  }

  get current(): number {
    return this.index;
  }

  set(i: number): boolean {
    const n = this.items.length;
    if (n === 0) return false;
    const next = ((i % n) + n) % n;
    if (next === this.index && this.items[next].classList.contains('focused')) return false;
    for (let k = 0; k < n; k++) this.items[k].classList.toggle('focused', k === next);
    this.index = next;
    return true;
  }

  move(delta: number): boolean {
    return this.set(this.index + delta);
  }

  activate(): void {
    if (this.items.length === 0) return;
    this.onActivate(this.index);
  }
}
