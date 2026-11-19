/**
 * First-race coach: four cards that teach by doing — accelerate, steer, drift for a boost, use an
 * item. Each card names the control, waits for the player to use it, ticks, and gives way to the
 * next. The lights do not start until the first card is done, so nobody is left on the grid
 * reading while the field drives off.
 *
 * Shown once per device, in a new account's first race. SKIP ends it at any card.
 * Design: docs/superpowers/specs/2026-11-20-drift-kart-crazygames-relaunch.md, section 4.1.
 */
import { events } from '../core/events';
import { t, type StringKey } from '../core/i18n';
import type { InputState } from '../core/types';
import { el, kbd, kbdIcon } from './dom';
import type { IconName } from './icons';
import { icon } from './icons';

type StepId = 'go' | 'steer' | 'drift' | 'item';
type Key = string | { icon: IconName };

interface StepDef {
  id: StepId;
  keys: readonly Key[];
  /** What the touch layout calls the control. */
  touch: StringKey;
  kb: StringKey;
  tc: StringKey;
}

const STEPS: readonly StepDef[] = [
  { id: 'go', keys: ['W', { icon: 'chevron-up' }], touch: 'coach.tap', kb: 'coach.go.kb', tc: 'coach.go.touch' },
  { id: 'steer', keys: ['A', 'D', { icon: 'chevron-left' }, { icon: 'chevron-right' }], touch: 'legend.touch.stickName', kb: 'coach.steer.kb', tc: 'coach.steer.touch' },
  { id: 'drift', keys: ['SPACE'], touch: 'touch.drift', kb: 'coach.drift.kb', tc: 'coach.drift.touch' },
  { id: 'item', keys: ['E'], touch: 'touch.item', kb: 'coach.item.kb', tc: 'coach.item.touch' },
];

/** The lights go out by themselves after this long on the first card: nobody is held on the grid. */
const GO_TIMEOUT = 8;
/** Seconds of real steering the second card asks for. */
const STEER_SECONDS = 0.5;
/** How long a finished card shows its tick before the next one, and the last message stays. */
const TICK_SECONDS = 0.7;
const DONE_SECONDS = 1.8;

export class RaceCoach {
  /** The first card is done (or skipped, or timed out): start the countdown. Fires once. */
  onStart: (() => void) | null = null;
  /** The coach has gone for good: finished or skipped. */
  onDone: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly keysNode: HTMLElement;
  private readonly textNode: HTMLElement;
  private readonly unsubs: (() => void)[] = [];
  private index = 0;
  private started = false;
  private finished = false;
  private waited = 0;
  private steered = 0;
  /** Counts down while a card shows its tick; the next card (or the end) follows. */
  private tick = 0;
  private closing = 0;

  constructor(
    root: HTMLElement,
    private readonly touch: boolean,
    localKartId: number,
  ) {
    this.rootNode = el('div', 'coach', undefined, root);
    const card = el('div', 'coach-card', undefined, this.rootNode);
    const bar = el('div', 'coach-steps', undefined, card);
    for (let i = 0; i < STEPS.length; i++) this.dots.push(el('i', '', undefined, bar));
    const body = el('div', 'coach-body', undefined, card);
    this.keysNode = el('div', 'coach-keys', undefined, body);
    this.textNode = el('div', 'coach-text', '', body);
    const skip = el('button', 'coach-skip', t('coach.skip'), card);
    skip.type = 'button';
    // Before the window listener below sees it: SKIP must not also count as the first card's tap.
    skip.addEventListener('pointerdown', (e) => e.stopPropagation());
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.skip();
    });
    window.addEventListener('pointerdown', this.onPointer);
    this.unsubs.push(
      () => window.removeEventListener('pointerdown', this.onPointer),
      events.on('kart:driftEnd', (e) => {
        if (e.kartId === localKartId && e.boostStage >= 1) this.complete('drift');
      }),
      events.on('item:use', (e) => {
        if (e.kartId === localKartId) this.complete('item');
      }),
    );
    this.render();
  }

  /** True while the lights are being held for the first card. */
  get holdingStart(): boolean {
    return !this.started;
  }

  /** `racing`: the lights are out. Steering only counts from then on. */
  update(dt: number, input: InputState, racing: boolean): void {
    if (this.finished) return;
    if (this.closing > 0) {
      this.closing -= dt;
      if (this.closing <= 0) this.end();
      return;
    }
    if (this.tick > 0) {
      this.tick -= dt;
      if (this.tick <= 0) this.advance();
      return;
    }
    const step = STEPS[this.index]?.id;
    if (step === 'go') {
      this.waited += dt;
      if (input.throttle > 0.5 || this.waited >= GO_TIMEOUT) this.complete('go');
    } else if (step === 'steer' && racing) {
      if (Math.abs(input.steer) > 0.4) this.steered += dt;
      if (this.steered >= STEER_SECONDS) this.complete('steer');
    }
  }

  /** The race is over: whatever was left unlearned, the card does not belong on a results screen. */
  finish(): void {
    if (!this.finished) this.end();
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.rootNode.remove();
  }

  // ----------------------------------------------------------------- private

  private readonly onPointer = (): void => {
    // A tap anywhere is the first card's "go": on a phone there is no throttle to press.
    if (STEPS[this.index]?.id === 'go' && this.tick <= 0) this.complete('go');
  };

  private skip(): void {
    this.start();
    this.end();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.onStart?.();
  }

  private complete(id: StepId): void {
    if (this.finished || this.tick > 0 || STEPS[this.index]?.id !== id) return;
    if (id === 'go') this.start();
    this.dots[this.index]?.classList.add('done');
    this.rootNode.classList.add('ticked');
    this.tick = TICK_SECONDS;
    events.emit('ui:select', {});
  }

  private advance(): void {
    this.rootNode.classList.remove('ticked');
    this.index += 1;
    if (this.index < STEPS.length) {
      this.render();
      return;
    }
    this.keysNode.replaceChildren(icon('check'));
    this.textNode.textContent = t('coach.done');
    this.rootNode.classList.add('all-done');
    this.closing = DONE_SECONDS;
  }

  private end(): void {
    this.finished = true;
    this.rootNode.classList.add('hidden');
    this.onDone?.();
  }

  private render(): void {
    const step = STEPS[this.index];
    this.dots.forEach((d, i) => d.classList.toggle('on', i === this.index));
    this.keysNode.replaceChildren();
    if (this.touch) el('span', 'chip coach-chip', t(step.touch), this.keysNode);
    else for (const key of step.keys) typeof key === 'string' ? kbd(this.keysNode, key) : kbdIcon(this.keysNode, key.icon);
    this.textNode.textContent = t(this.touch ? step.tc : step.kb);
    // Re-run the entrance for each card.
    this.rootNode.classList.remove('coach-in');
    void this.rootNode.offsetWidth;
    this.rootNode.classList.add('coach-in');
  }
}
