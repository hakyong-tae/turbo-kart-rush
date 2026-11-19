/**
 * Wording shared by the progression screens: what a mission asks for, what an earn-only garage
 * entry takes, what a token is called. One place, so the mission panel, the results screen and the
 * mid-race toast cannot describe the same mission three ways.
 */
import { cosmeticOf } from '../../core/cosmetics';
import { CLEAN_WALLS, earnRule, formatCoins, parseMissionKey } from '../../core/economy';
import { t } from '../../core/i18n';

/** Keys built from ids at runtime; `progression.test.ts` checks every one of them exists. */
type LocaleKey = Parameters<typeof t>[0];
const tk = (key: string, params?: Record<string, string | number>): string => t(key as LocaleKey, params);

/** Resolves a circuit id to its display name. Passed in: the UI layer does not own the track list. */
export type TrackNamer = (trackId: string) => string;

/** "Fire 10 drift boosts of stage 2 or higher". Unknown keys read as the key itself. */
export function missionTitle(key: string, trackName: TrackNamer): string {
  const parsed = parseMissionKey(key);
  if (!parsed) return key;
  const { def, param } = parsed;
  if (def.id === 'track') return tk('mis.track', { name: trackName(param) });
  // The class label is a shouting chip elsewhere; inside a sentence it is just a word.
  if (def.id === 'class') return tk('mis.class', { name: tk(`weight.${param}`).toLowerCase() });
  if (def.id === 'clean') return tk('mis.clean', { n: CLEAN_WALLS });
  return tk(`mis.${def.id}`, { n: def.target });
}

/** Display name of a garage token (`t:b` -> "Comet"), or the token when it names nothing. */
export function tokenName(token: string): string {
  const ref = cosmeticOf(token);
  return ref ? tk(`cos.${ref.field}.${ref.id}`) : token;
}

/** How an earn-only entry is come by, short enough for a chip: "LV 20", "7 DAYS", "1,500". */
export function earnChip(token: string): string | null {
  const rule = earnRule(token);
  if (!rule) return null;
  if (rule.kind === 'level') return t('earn.level', { n: rule.at });
  if (rule.kind === 'days') return t('earn.days', { n: rule.at });
  return formatCoins(rule.price);
}

/** The same, as a sentence for the purchase sheet. Null for an entry that is simply for sale. */
export function earnCondition(token: string): string | null {
  const rule = earnRule(token);
  if (!rule || rule.kind === 'coins') return null;
  return rule.kind === 'level' ? t('earn.levelLong', { n: rule.at }) : t('earn.daysLong', { n: rule.at });
}
