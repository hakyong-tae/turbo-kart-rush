import { describe, expect, it } from 'vitest';
import serverSource from '../../server.js?raw';
import { paidCosmetics } from '../core/cosmetics';
import * as economy from '../core/economy';
import { seedOf } from '../core/daily';
import { en } from '../core/locales/en';
import { ko } from '../core/locales/ko';
import { CHARACTERS } from '../kart/roster';

/**
 * server.js computes every coin; src/core/economy.ts only prints what it expects the server to
 * say. If the two tables drift the garage shows one price and charges another, so this reads the
 * server's constants straight out of its source and holds them equal to the client's.
 */
function serverTables(names: readonly string[]): Record<string, any> {
  const factory = new Function('$global', '$sender', '$room', `${serverSource}\nreturn { ${names.join(', ')} };`);
  return factory({}, { account: 'x' }, {}) as Record<string, any>;
}

describe('server.js economy tables match the client', () => {
  const NAMES = [
    'RACE_COINS', 'RETIRE_COINS', 'DIFF_PCT', 'FULL_RACES', 'REDUCED_PCT', 'RACE_CAP', 'KART_PRICE', 'COS_PRICES',
    'DOUBLES_PER_DAY', 'SWAPS_PER_DAY', 'RACE_XP', 'RETIRE_XP', 'LEVEL_BASE', 'LEVEL_STEP', 'MAX_LEVEL', 'LEVEL_COINS',
    'STREAK_COINS', 'LEVEL_REWARDS', 'STREAK_REWARDS', 'SHOWCASE',
    'MISSIONS', 'MISSION_COINS', 'MISSION_XP', 'MISSION_BONUS', 'STAT_CAP', 'CLEAN_WALLS',
  ] as const;
  const server = serverTables([...NAMES, 'EARN_ONLY', 'CLASS_OF', 'levelOf', 'seedOf', 'missionsFor']);

  for (const name of NAMES) {
    it(name, () => {
      expect(server[name]).toEqual((economy as Record<string, unknown>)[name]);
    });
  }

  it('levelOf agrees with levelInfo across the whole curve', () => {
    for (let xp = 0; xp <= 24000; xp += 37) expect(server.levelOf(xp), `xp ${xp}`).toBe(economy.levelInfo(xp).level);
  });

  it('seedOf is the same hash as the daily challenge uses', () => {
    for (const day of ['2026-11-18', '2027-01-01', '2030-12-31']) expect(server.seedOf(day)).toBe(seedOf(day));
  });

  it('EARN_ONLY is exactly the catalogue entries flagged earn', () => {
    expect([...server.EARN_ONLY].sort()).toEqual(
      paidCosmetics()
        .filter((p) => p.entry.earn)
        .map((p) => p.token)
        .sort(),
    );
  });

  it('CLASS_OF mirrors every racer weight class', () => {
    expect(server.CLASS_OF).toEqual(Object.fromEntries(CHARACTERS.map((c) => [c.id, c.weightClass])));
  });

  it('every day yields three known missions, easy to hard', () => {
    for (let d = 0; d < 400; d++) {
      const day = new Date(Date.UTC(2026, 10, 18) + d * 86400000).toISOString().slice(0, 10);
      const keys: string[] = server.missionsFor(day);
      expect(keys.map((k) => economy.parseMissionKey(k)?.def.tier), day).toEqual([0, 1, 2]);
    }
  });

  it('every mission has wording in both languages', () => {
    for (const m of economy.MISSIONS) {
      expect(Object.keys(en), m.id).toContain(`mis.${m.id}`);
      expect(Object.keys(ko), m.id).toContain(`mis.${m.id}`);
    }
  });
});
