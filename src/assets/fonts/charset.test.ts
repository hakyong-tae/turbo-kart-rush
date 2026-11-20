import { describe, expect, it } from 'vitest';
import { ko } from '../../core/locales/ko';
import charset from './charset.txt?raw';

/**
 * The CrazyGames edition serves its own Korean fonts, cut down to the syllables the game prints
 * (tools/subset-fonts.py writes the list next to them). A syllable that is not in the cut is drawn
 * by the system face, in the middle of a word set in another one.
 */
describe('self-hosted Korean fonts', () => {
  it('carry every Hangul syllable of the Korean locale', () => {
    const have = new Set(charset);
    const missing = new Set<string>();
    for (const text of Object.values(ko)) for (const c of text) if (c >= '가' && c <= '힣' && !have.has(c)) missing.add(c);
    // Fix: python3 tools/subset-fonts.py <dir with the source fonts>, then commit src/assets/fonts.
    expect([...missing].join('')).toBe('');
  });
});
