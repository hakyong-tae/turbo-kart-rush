/**
 * What a race opened, one thing at a time, in front of the results screen. A small card in a
 * list was easy to read past; this waits for the player to say they saw it.
 *
 *   - a circuit: its map, and OK;
 *   - a garage entry: the player's own kart wearing it, turning on the garage turntable (the
 *     same live 3D preview the garage uses), with OK and GO TO GARAGE;
 *   - a racer: that racer's kart on the turntable, and OK.
 *
 * One WebGL context for the turntable, made on the first 3D card and dropped when the last card
 * is dismissed.
 */
import { CHARACTERS } from '../kart/roster';
import { t } from '../core/i18n';
import { events } from '../core/events';
import { unpackCosmetics, type KartCosmetics } from '../core/cosmetics';
import type { CharacterDef, InputState } from '../core/types';
import { button, el, setButtonContent, TextField } from './dom';
import { GaragePreview } from './garage/GaragePreview';

export interface UnlockPopupCard {
  kind: 'track' | 'item' | 'racer';
  name: string;
  /** A circuit's map. */
  image?: HTMLCanvasElement | string;
  /** A garage entry: its packed token ("p:b"), worn on top of the player's own look. */
  token?: string;
  /** A racer: whose kart to show. */
  characterId?: string;
}

export interface UnlockPopupContext {
  /** The kart the player drove, and the look it wears: a garage entry is shown on it. */
  characterId: string;
  cosmetics: KartCosmetics;
}

export class UnlockPopup {
  /** GO TO GARAGE on a garage entry. The rest of the queue is dropped. */
  onGarage: (() => void) | null = null;
  /** Every card was seen (or the queue was dropped for the garage). */
  onDone: ((toGarage: boolean) => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly kicker: TextField;
  private readonly name: TextField;
  private readonly count: TextField;
  private readonly stage: HTMLElement;
  private readonly okBtn: HTMLButtonElement;
  private readonly garageBtn: HTMLButtonElement;
  private preview: GaragePreview | null = null;
  private queue: UnlockPopupCard[] = [];
  private total = 0;
  private context: UnlockPopupContext | null = null;
  private visible = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'unlock-popup hidden', undefined, root);
    const panel = el('div', 'panel unlock-popup-panel', undefined, this.rootNode);
    const head = el('div', 'unlock-popup-head', undefined, panel);
    this.kicker = new TextField(el('div', 'panel-kicker unlock-popup-kicker', '', head));
    this.count = new TextField(el('div', 'unlock-popup-count', '', head));
    this.stage = el('div', 'unlock-popup-stage', undefined, panel);
    this.name = new TextField(el('h2', 'panel-title unlock-popup-name', '', panel));
    const actions = el('div', 'actions unlock-popup-actions', undefined, panel);
    this.garageBtn = button(t('unlock.garage'), 'unlock-popup-garage', () => this.toGarage(), 'wrench');
    this.okBtn = button(t('unlock.ok'), 'primary unlock-popup-ok', () => this.next());
    actions.append(this.garageBtn, this.okBtn);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(cards: readonly UnlockPopupCard[], context: UnlockPopupContext): void {
    this.queue = cards.slice();
    this.total = cards.length;
    this.context = context;
    if (this.queue.length === 0) {
      this.onDone?.(false);
      return;
    }
    this.visible = true;
    this.rootNode.classList.remove('hidden');
    this.render();
  }

  /** Drops whatever is left without counting it seen (the race was left under it). */
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.queue = [];
    this.rootNode.classList.add('hidden');
    this.dropPreview();
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.confirm || input.back) this.next();
  }

  dispose(): void {
    this.dropPreview();
    this.rootNode.remove();
  }

  private next(): void {
    if (!this.visible) return;
    events.emit('ui:select', {});
    this.queue.shift();
    if (this.queue.length > 0) {
      this.render();
      return;
    }
    this.hide();
    this.onDone?.(false);
  }

  private toGarage(): void {
    if (!this.visible) return;
    events.emit('ui:select', {});
    this.hide();
    this.onGarage?.();
    this.onDone?.(true);
  }

  private render(): void {
    const card = this.queue[0];
    const ctx = this.context;
    if (!card || !ctx) return;
    this.rootNode.dataset.kind = card.kind;
    this.kicker.set(t(card.kind === 'track' ? 'results.newTrack' : card.kind === 'racer' ? 'unlock.newRacer' : 'results.newItem'));
    this.count.set(this.total > 1 ? `${this.total - this.queue.length + 1} / ${this.total}` : '');
    this.name.set(card.name);
    // Labels are read here, not when built: the language may have changed since.
    setButtonContent(this.okBtn, t('unlock.ok'));
    setButtonContent(this.garageBtn, t('unlock.garage'), 'wrench');
    this.garageBtn.hidden = card.kind !== 'item';

    // The stage: a map for a circuit, the turntable for anything with a kart in it.
    for (const child of Array.from(this.stage.children)) if (child !== this.preview?.canvas) child.remove();
    if (card.kind === 'track') {
      this.preview?.stop();
      if (this.preview) this.preview.canvas.hidden = true;
      if (typeof card.image === 'string') {
        const img = el('img', 'unlock-popup-map', undefined, this.stage);
        img.src = card.image;
        img.alt = '';
      } else if (card.image) {
        card.image.classList.add('unlock-popup-map');
        this.stage.appendChild(card.image);
      }
      return;
    }
    const characterId = card.kind === 'racer' ? (card.characterId ?? ctx.characterId) : ctx.characterId;
    const character = (CHARACTERS as readonly CharacterDef[]).find((c) => c.id === characterId) ?? CHARACTERS[0];
    // A racer in its own colours; a garage entry on the player's kart, over the look it has.
    const look: KartCosmetics = card.kind === 'racer' ? {} : { ...ctx.cosmetics, ...unpackCosmetics(card.token) };
    const preview = this.preview ?? (this.preview = new GaragePreview(this.stage));
    preview.canvas.hidden = false;
    preview.canvas.classList.add('unlock-popup-canvas');
    preview.setCharacter(character, look);
    preview.setCosmetics(look);
    // A flame only exists under boost: hold it open while that is what is on show.
    preview.setBoostHold(Boolean(card.token?.startsWith('f:')));
    preview.start();
  }

  private dropPreview(): void {
    this.preview?.dispose();
    this.preview = null;
  }
}
