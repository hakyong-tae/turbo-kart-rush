/**
 * Wording shared by the progression screens: what a mission asks for, what an earn-only garage
 * entry takes, what a token is called. One place, so the mission panel, the results screen and the
 * mid-race toast cannot describe the same mission three ways.
 */
import { cosmeticOf } from '../../core/cosmetics';
import { CLEAN_WALLS, earnRule, formatCoins, parseMissionKey, type LadderStep } from '../../core/economy';
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

/** A token's name with what it is: "Sparks trail", "스파크 트레일". Used where the kind is not obvious. */
export function tokenFullName(token: string): string {
  const ref = cosmeticOf(token);
  return ref ? tk('item.named', { name: tk(`cos.${ref.field}.${ref.id}`), kind: tk(`kind.${ref.field}`) }) : token;
}

/** What a ladder rung asks for: "Finish 3 races", "Fire 10 drift boosts". */
export function ladderCondition(step: LadderStep): string {
  if (step.stat === 'f') return step.at === 1 ? t('ladder.f1') : t('ladder.f', { n: step.at });
  if (step.stat === 'p') return t('ladder.p');
  if (step.stat === 'w') return t('ladder.w');
  if (step.stat === 'd') return t('ladder.d', { n: step.at });
  return t('ladder.days');
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
