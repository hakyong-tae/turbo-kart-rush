import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { GAME_TITLE } from './constants';
import { en } from './locales/en';
import { ko } from './locales/ko';
import { PLATFORM } from './platform';

// The game has one name in every edition. It is written in two places that no bundler ties
// together: this module (the wordmark, sentences) and index.html (the page title and the splash
// that is on screen before any script runs). The old name must not creep back through either.
const OLD_NAME = /drift\s*dash|드리프트\s*대시/i;

describe('the game name', () => {
  it('is DRIFT KART: the wordmark and the name in a sentence', () => {
    expect(PLATFORM.title).toBe('DRIFT KART');
    expect(PLATFORM.name).toBe('Drift Kart');
    expect(GAME_TITLE).toBe('DRIFT KART');
  });

  it('is the same in index.html: page title, and the splash drawn as the wordmark is', () => {
    expect(html).toContain(`<title>${PLATFORM.name}</title>`);
    const words = PLATFORM.title.split(' ');
    expect(html).toContain(`<span class="boot-word">${words.slice(0, -1).join(' ')}</span><span class="boot-plate">${words[words.length - 1]}</span>`);
    expect(html).not.toMatch(OLD_NAME);
  });

  it('is never spelled out in a locale entry, old or new: `{game}` is', () => {
    for (const table of [en, ko] as Array<Record<string, string>>) {
      for (const [key, text] of Object.entries(table)) {
        expect(text, key).not.toMatch(OLD_NAME);
        expect(text, key).not.toMatch(/drift\s*kart|드리프트\s*카트/i);
      }
    }
  });
});
