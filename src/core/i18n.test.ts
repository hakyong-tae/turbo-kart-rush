// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectLang, getLang, localOrdinal, setLang, t } from './i18n';
import { en } from './locales/en';
import { ko } from './locales/ko';
import { TRACKS } from '../track/tracks';

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('en');
  });

  it('ko and en have identical key sets', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });

  it('every track has a description in both languages', () => {
    // Key parity alone does not catch this: a new circuit arrives with its description missing
    // from both files at once, and then the Korean menu quietly shows English. Caught in QA on
    // Switchback Pass and Prism Skyway.
    for (const track of TRACKS) {
      expect(Object.keys(ko)).toContain(`track.${track.id}.desc`);
      expect(Object.keys(en)).toContain(`track.${track.id}.desc`);
    }
  });

  it('t() returns the current language string and substitutes params', () => {
    expect(t('menu.laps', { n: 3 })).toBe('3 LAPS');
    setLang('ko');
    expect(t('menu.laps', { n: 3 })).toBe('3랩');
  });

  it('t() falls back to the key for unknown keys', () => {
    // @ts-expect-error deliberately unknown key
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('detectLang prefers stored value, then navigator, then en', () => {
    expect(detectLang('fr-FR', null)).toBe('en');
    expect(detectLang('ko-KR', null)).toBe('ko');
    expect(detectLang('ko-KR', 'en')).toBe('en');
    expect(detectLang('en-US', 'ko')).toBe('ko');
    expect(detectLang('en-US', 'zz')).toBe('en');
  });

  it('setLang persists and updates <html lang>', () => {
    setLang('ko');
    expect(getLang()).toBe('ko');
    expect(localStorage.getItem('tkr.lang')).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('localOrdinal', () => {
    expect(localOrdinal(1)).toBe('1st');
    setLang('ko');
    expect(localOrdinal(1)).toBe('1위');
  });
});
