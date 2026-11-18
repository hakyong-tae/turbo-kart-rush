// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MISSIONS, LEVEL_REWARDS, SHOWCASE, STREAK_REWARDS } from '../../core/economy';
import { setLang } from '../../core/i18n';
import { earnChip, earnCondition, missionTitle, tokenName } from './text';

const trackName = (id: string): string => (id === 'coral_coast' ? 'Coral Coast' : id);

describe('progression wording', () => {
  beforeEach(() => setLang('en'));

  it('names every mission, with its number or its parameter filled in', () => {
    expect(missionTitle('drift', trackName)).toBe('Fire 10 drift boosts of stage 2 or higher');
    expect(missionTitle('track:coral_coast', trackName)).toBe('Finish a race on Coral Coast');
    expect(missionTitle('class:heavy', trackName)).toBe('Finish a race in a heavy kart');
    expect(missionTitle('clean', trackName)).toBe('Finish with 3 wall hits or fewer');
    for (const lang of ['en', 'ko'] as const) {
      setLang(lang);
      for (const m of MISSIONS) {
        const key = m.id === 'track' ? 'track:coral_coast' : m.id === 'class' ? 'class:light' : m.id;
        const title = missionTitle(key, trackName);
        // No raw key and no unfilled placeholder may reach a player.
        expect(title, `${lang} ${m.id}`).not.toMatch(/^mis\.|[{}]/);
      }
    }
    expect(missionTitle('nonsense', trackName)).toBe('nonsense');
  });

  it('says how each earn-only entry is come by', () => {
    expect(earnChip(LEVEL_REWARDS[20])).toBe('LV 20');
    expect(earnCondition(LEVEL_REWARDS[20])).toBe('Reach level 20');
    expect(earnChip(STREAK_REWARDS[14])).toBe('14 DAYS');
    expect(earnCondition(STREAK_REWARDS[14])).toBe('Check in 14 days in total');
    // The coin shelf is simply for sale: a price, and no condition.
    expect(earnChip(SHOWCASE[4])).toBe('2,500');
    expect(earnCondition(SHOWCASE[4])).toBeNull();
    expect(earnChip('p:1')).toBeNull();
  });

  it('names a token in the current language', () => {
    expect(tokenName('t:b')).toBe('Comet');
    setLang('ko');
    expect(tokenName('g:a')).toBe('월계관');
    expect(tokenName('k:rosa')).toBe('k:rosa');
  });
});
