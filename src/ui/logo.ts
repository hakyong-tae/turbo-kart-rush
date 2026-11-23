/**
 * The wordmark: "DRIFT" in white italic, "KART" on a yellow number plate, a checker strip
 * underneath. Built from `GAME_TITLE` so a rename is one constant (plus index.html). The lobby and the loading
 * screen draw the same mark.
 */
import { GAME_TITLE } from '../core/constants';
import { el } from './dom';

export function buildLogo(parent: HTMLElement, className = ''): HTMLElement {
  const logo = el('div', `logo ${className}`.trim(), undefined, parent);
  logo.setAttribute('role', 'img');
  logo.setAttribute('aria-label', GAME_TITLE);
  const words = GAME_TITLE.split(' ');
  // The last word rides on the plate; everything before it is the name.
  const plateWord = words.length > 1 ? words[words.length - 1] : '';
  const name = (plateWord ? words.slice(0, -1) : words).join(' ');
  const line = el('div', 'logo-line', undefined, logo);
  el('span', 'logo-word', name, line);
  if (plateWord) el('span', 'logo-gp plate yellow', plateWord, line);
  el('div', 'logo-checker checker', undefined, logo);
  return logo;
}
