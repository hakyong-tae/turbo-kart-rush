/**
 * The garage builds locale keys from catalogue ids at runtime (`cos.trail.embers`), which the
 * compile-time key union cannot check. This is that check: adding a catalogue entry without a
 * name in both languages fails here rather than shipping a raw id to a player.
 */
import { describe, expect, it } from 'vitest';
import { BADGES, ENGINE_PACKS, FLAMES, PATTERNS, PRESETS, TRAILS, UNDERGLOWS, WHEEL_FX } from './cosmetics';
import { en } from './locales/en';
import { ko } from './locales/ko';

const GROUPS = {
  pattern: PATTERNS,
  underglow: UNDERGLOWS,
  trail: TRAILS,
  flame: FLAMES,
  wheelFx: WHEEL_FX,
  enginePack: ENGINE_PACKS,
  badge: BADGES,
} as const;

const keys = [
  ...Object.entries(GROUPS).flatMap(([group, list]) => list.map((e) => `cos.${group}.${e.id}`)),
  ...PRESETS.map((p) => `cos.preset.${p.id}`),
  ...Object.keys(GROUPS).map((g) => `garage.tab.${g}`),
  'garage.tab.paint',
  'garage.tab.preset',
  ...['body', 'accent', 'rim', 'helmet', 'pattern', 'underglow', 'trail'].map((f) => `garage.color.${f}`),
];

describe('cosmetic names', () => {
  it.each(['en', 'ko'])('%s names every catalogue entry, preset, tab and colour slot', (lang) => {
    const table = (lang === 'en' ? en : ko) as Record<string, string>;
    const missing = keys.filter((k) => !table[k]);
    expect(missing, `missing ${lang} strings`).toEqual([]);
  });

  it('names are distinct within a group, so two entries never look like the same thing', () => {
    for (const [group, list] of Object.entries(GROUPS)) {
      const names = list.map((e) => (en as Record<string, string>)[`cos.${group}.${e.id}`]);
      expect(new Set(names).size, group).toBe(names.length);
    }
  });
});
