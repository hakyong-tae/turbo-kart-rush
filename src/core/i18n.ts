/**
 * Contract addition: tiny string table with ko/en. `t(key, params)` substitutes `{name}`.
 * Language: localStorage 'tkr.lang' -> navigator.language (ko*) -> 'en'.
 */
import { events } from './events';
import { ordinal } from './math';
import { en, type StringKey } from './locales/en';
import { ko } from './locales/ko';
import { PLATFORM } from './platform';

export type Lang = 'ko' | 'en';
export type { StringKey };

const STORAGE_KEY = 'tkr.lang';
const TABLES: Record<Lang, Record<StringKey, string>> = { en, ko };

export function detectLang(navigatorLanguage: string | undefined, stored: string | null): Lang {
  if (stored === 'ko' || stored === 'en') return stored;
  return (navigatorLanguage ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: Lang = detectLang(typeof navigator !== 'undefined' ? navigator.language : undefined, readStored());
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  const changed = lang !== current;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode etc. */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (changed) events.emit('ui:langChange', {});
}

export function toggleLang(): Lang {
  setLang(current === 'ko' ? 'en' : 'ko');
  return current;
}

/**
 * Wording that differs by build target is a second entry, `<key>@<target>` (core/platform.ts):
 * the CrazyGames edition has no garage pass and no ads, so the sentences that mention them have a
 * variant that does not. Asked for by the plain key; the variant wins when the build has one.
 */
const VARIANT = PLATFORM.target === 'verse8' ? '' : `@${PLATFORM.target}`;

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const table = TABLES[current] as Record<string, string>;
  const fallback = en as Record<string, string>;
  let s: string = (VARIANT ? (table[key + VARIANT] ?? fallback[key + VARIANT]) : undefined) ?? table[key] ?? fallback[key] ?? key;
  // The game's own name is never spelled out in a string: it depends on the build.
  if (s.includes('{game}')) s = s.split('{game}').join(PLATFORM.name);
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

/** Try a dynamic key (e.g. `char.<id>.tagline`); return `fallback` when the key is not in the table. */
export function tOr(key: string, fallback: string): string {
  const table = TABLES[current] as Record<string, string>;
  return table[key] ?? fallback;
}

/** "1st" in English, "1위" in Korean. */
export function localOrdinal(n: number): string {
  return current === 'ko' ? `${n}위` : ordinal(n);
}

/** Suffix after the numeral, for the HUD's split numeral/suffix layout. */
export function localOrdinalSuffix(n: number): string {
  return localOrdinal(n).slice(String(n).length);
}
