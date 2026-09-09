import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../kart/roster';
import { TRACKS } from '../track/tracks';
import {
  DAILY_CLASSES,
  DAILY_RULES,
  allowsCharacter,
  dailyChallenge,
  dailyStateFor,
  dayKey,
  seedOf,
} from './daily';

const tracks = TRACKS.map((t) => ({ id: t.id, laps: t.laps }));

describe('daily seed', () => {
  it('is stable for a date and different across dates', () => {
    expect(seedOf('2026-09-09')).toBe(seedOf('2026-09-09'));
    expect(seedOf('2026-09-09')).not.toBe(seedOf('2026-09-10'));
  });

  it('keys the day in UTC, matching the server clock', () => {
    expect(dayKey(new Date('2026-09-09T23:59:59Z'))).toBe('2026-09-09');
    expect(dayKey(new Date('2026-09-10T00:00:01Z'))).toBe('2026-09-10');
  });
});

describe('daily challenge', () => {
  it('is fully determined by the date', () => {
    const a = dailyChallenge('2026-09-09', tracks);
    const b = dailyChallenge('2026-09-09', tracks);
    expect(a).toEqual(b);
  });

  it('only ever names a real track, rule and class, with at least one lap', () => {
    const ruleIds = new Set(DAILY_RULES.map((r) => r.id));
    const classes = new Set(DAILY_CLASSES);
    const trackIds = new Set(tracks.map((t) => t.id));
    // A year of dates: every one must produce something playable.
    for (let i = 0; i < 365; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const c = dailyChallenge(day, tracks);
      expect(trackIds.has(c.trackId), day).toBe(true);
      expect(ruleIds.has(c.rule.id), day).toBe(true);
      expect(classes.has(c.klass), day).toBe(true);
      expect(c.laps, day).toBeGreaterThanOrEqual(1);
      expect(c.day).toBe(day);
    }
  });

  it('varies over a year rather than settling on one circuit', () => {
    const seen = new Set<string>();
    const rules = new Set<string>();
    for (let i = 0; i < 365; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const c = dailyChallenge(day, tracks);
      seen.add(c.trackId);
      rules.add(c.rule.id);
    }
    expect(seen.size).toBe(tracks.length);
    expect(rules.size).toBe(DAILY_RULES.length);
  });

  it('never demands a class no character can field', () => {
    for (let i = 0; i < 90; i++) {
      const day = new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10);
      const c = dailyChallenge(day, tracks);
      const eligible = CHARACTERS.filter((ch) => allowsCharacter(c, ch.weightClass));
      expect(eligible.length, `${day} ${c.klass}`).toBeGreaterThan(0);
    }
  });
});

describe('attempt state', () => {
  it('hands back the attempt on a new day and keeps it within the day', () => {
    const spent = { day: '2026-09-09', used: true, timeMs: 91000 };
    expect(dailyStateFor('2026-09-09', spent)).toEqual(spent);
    expect(dailyStateFor('2026-09-10', spent)).toEqual({ day: '2026-09-10', used: false, timeMs: 0 });
    expect(dailyStateFor('2026-09-10', null)).toEqual({ day: '2026-09-10', used: false, timeMs: 0 });
  });
});
