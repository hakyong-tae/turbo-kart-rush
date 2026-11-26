/**
 * "Carry on with the cup?" — shown in the lobby when a cup was left between races. Continue
 * runs its next race with the table so far; Start over drops it.
 */
import { t } from '../core/i18n';
import { button, el, TextField } from './dom';

export class CupResumeSheet {
  onContinue: (() => void) | null = null;
  onDrop: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly title: TextField;
  private readonly body: TextField;
  private readonly continueBtn: HTMLButtonElement;
  private readonly dropBtn: HTMLButtonElement;
  private visible = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen lock-sheet cup-resume hidden', undefined, root);
    const panel = el('div', 'panel lock-panel', undefined, this.rootNode);
    el('div', 'panel-kicker', t('cup.label'), panel);
    this.title = new TextField(el('h2', 'panel-title', '', panel));
    this.body = new TextField(el('p', 'lock-body', '', panel));
    const actions = el('div', 'actions column', undefined, panel);
    this.continueBtn = button(t('cup.resume.go'), 'primary', () => this.choose(true), 'chevron-right');
    this.dropBtn = button(t('cup.resume.drop'), 'ghost', () => this.choose(false));
    actions.append(this.continueBtn, this.dropBtn);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** `cup`: the cup's name; `next`/`count`: the race it goes on with, 1-based, of how many. */
  show(cup: string, next: number, count: number, points: number): void {
    this.title.set(t('cup.resume.title', { cup }));
    this.body.set(t('cup.resume.body', { i: String(next), n: String(count), pts: String(points) }));
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  dispose(): void {
    this.rootNode.remove();
  }

  private choose(go: boolean): void {
    this.hide();
    if (go) this.onContinue?.();
    else this.onDrop?.();
  }
}
