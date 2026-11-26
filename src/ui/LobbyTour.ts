/**
 * Lobby tour: the first time a new player stands in the lobby (after their first races, which
 * skip it), three bubbles point at what the lobby is for — the cup to win next, the garage, the
 * missions — one at a time. A tap anywhere moves on; SKIP ends it. Shown once per device.
 *
 * It only reads where the buttons are; it never moves or restyles them, so the lobby's own
 * layout and the tools that check it see the same page with or without it.
 */
import { events } from '../core/events';
import { t, type StringKey } from '../core/i18n';
import { button, el, setButtonContent } from './dom';

export interface TourStop {
  /** The button the bubble points at. A stop whose button is missing or hidden is skipped. */
  target: HTMLElement | null;
  text: StringKey;
  /** The last stop may carry an action: its button does it (and ends the tour). */
  action?: { label: string; run: () => void };
}

export class LobbyTour {
  /** `acted`: the tour ended on its last stop's action rather than by skipping or tapping on. */
  onDone: ((acted: boolean) => void) | null = null;

  private readonly root: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly text: HTMLElement;
  private readonly count: HTMLElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly ring: HTMLElement;
  private stops: TourStop[] = [];
  private at = 0;
  private active = false;
  private readonly onResize = (): void => this.place();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'lobby-tour hidden', undefined, parent);
    this.ring = el('div', 'lobby-tour-ring', undefined, this.root);
    this.bubble = el('div', 'lobby-tour-bubble', undefined, this.root);
    this.text = el('p', 'lobby-tour-text', '', this.bubble);
    const foot = el('div', 'lobby-tour-foot', undefined, this.bubble);
    this.count = el('span', 'lobby-tour-count', '', foot);
    this.skipBtn = button(t('coach.skip'), 'ghost lobby-tour-skip', () => this.finish());
    foot.appendChild(this.skipBtn);
    this.nextBtn = button(t('tour.next'), 'primary lobby-tour-next', () => this.advance(true));
    foot.appendChild(this.nextBtn);
    // A tap anywhere else on the screen moves on too: the tour is a pointer, not a gate.
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root || ev.target === this.ring) this.advance();
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  start(stops: readonly TourStop[]): void {
    this.stops = stops.filter((s) => s.target && s.target.offsetParent !== null);
    if (this.stops.length === 0) {
      this.onDone?.(false);
      return;
    }
    this.at = 0;
    this.active = true;
    this.root.classList.remove('hidden');
    window.addEventListener('resize', this.onResize);
    this.show();
  }

  /** Takes the tour down without counting it as seen (the lobby was left under it). */
  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.root.classList.add('hidden');
    window.removeEventListener('resize', this.onResize);
  }

  /** `pressed`: the stop's own button, not a tap beside it (only that runs a stop's action). */
  private advance(pressed = false): void {
    if (!this.active) return;
    events.emit('ui:select', {});
    if (this.at + 1 >= this.stops.length) {
      const action = pressed ? this.stops[this.at].action : undefined;
      this.hide();
      this.onDone?.(Boolean(action));
      action?.run();
      return;
    }
    this.at += 1;
    this.show();
  }

  private finish(): void {
    this.hide();
    this.onDone?.(false);
  }

  private show(): void {
    const stop = this.stops[this.at];
    this.text.textContent = t(stop.text);
    this.count.textContent = `${this.at + 1} / ${this.stops.length}`;
    // Labels are read here, not when built: the language may have changed since.
    setButtonContent(this.skipBtn, t('coach.skip'));
    const last = this.at + 1 >= this.stops.length;
    setButtonContent(this.nextBtn, last ? (stop.action?.label ?? t('tour.done')) : t('tour.next'));
    // The last stop: SKIP stays when its button starts something ("not now"), goes when it only closes.
    this.skipBtn.hidden = last && !stop.action;
    this.place();
  }

  /** Ring round the target; bubble beside it, on whichever side has the room. */
  private place(): void {
    const target = this.stops[this.at]?.target;
    if (!target) return;
    const host = this.root.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const pad = 4;
    Object.assign(this.ring.style, {
      left: `${r.left - host.left - pad}px`,
      top: `${r.top - host.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    const gap = 12;
    // Left of the target when it sits on the right half (the lobby column on a wide screen),
    // else above it; kept inside the screen either way.
    let left: number;
    let top: number;
    if (r.left - host.left > bw + gap + 8) {
      left = r.left - host.left - bw - gap;
      top = r.top - host.top + r.height / 2 - bh / 2;
    } else {
      left = r.left - host.left + r.width / 2 - bw / 2;
      top = r.top - host.top - bh - gap;
    }
    left = Math.max(8, Math.min(left, host.width - bw - 8));
    top = Math.max(8, Math.min(top, host.height - bh - 8));
    this.bubble.style.left = `${left}px`;
    this.bubble.style.top = `${top}px`;
  }
}
