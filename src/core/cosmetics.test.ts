import { describe, expect, it } from 'vitest';
import {
  BADGES,
  ENGINE_PACKS,
  FLAMES,
  PATTERNS,
  PRESETS,
  TRAILS,
  UNDERGLOWS,
  WHEEL_FX,
  packCosmetics,
  sanitize,
  unpackCosmetics,
  usesPaid,
  type KartCosmetics,
} from './cosmetics';
import { sideOf } from './teams';

const ALL = [PATTERNS, UNDERGLOWS, TRAILS, FLAMES, WHEEL_FX, ENGINE_PACKS, BADGES];

const loaded: KartCosmetics = {
  body: 0x101218,
  accent: 0x7c3aed,
  rim: 0x9aa3b2,
  helmet: 0xffffff,
  pattern: 'circuit',
  patternColor: 0x3ddc84,
  underglow: 'breathe',
  underglowColor: 0x7c3aed,
  trail: 'stars',
  trailColor: 0xc26bff,
  flame: 'ion',
  wheelFx: 'rimLight',
  enginePack: 'electric',
  badge: 'crown',
};

describe('cosmetics catalogue', () => {
  it('has unique ids in every group', () => {
    for (const group of ALL) {
      const ids = group.map((e) => e.id);
      expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
    }
  });

  it('ships enough paid entries to be worth a purchase', () => {
    const paid = ALL.reduce((n, group) => n + group.filter((e) => !e.free).length, 0);
    expect(paid).toBeGreaterThanOrEqual(60);
    expect(PATTERNS.filter((p) => !p.free).length).toBeGreaterThanOrEqual(30);
  });

  it('every preset only references catalogue ids, and free presets stay free', () => {
    for (const preset of PRESETS) {
      expect(sanitize(preset.cos, true), preset.id).toEqual(preset.cos);
      if (preset.free) expect(usesPaid(preset.cos), preset.id).toBe(false);
    }
    expect(PRESETS.filter((p) => p.free).length).toBe(3);
  });
});

describe('sanitize', () => {
  it('keeps everything for a premium player', () => {
    expect(sanitize(loaded, true)).toEqual(loaded);
  });

  it('keeps colours but strips patterns and effects for a free player', () => {
    const free = sanitize(loaded, false);
    expect(free).toEqual({ body: 0x101218, accent: 0x7c3aed, rim: 0x9aa3b2, helmet: 0xffffff });
    expect(usesPaid(loaded)).toBe(true);
  });

  it('drops unknown ids and out-of-range colours', () => {
    const dirty = { body: -1, accent: 0x1000000, pattern: 'notAPattern', trail: 'stars' } as unknown as KartCosmetics;
    expect(sanitize(dirty, true)).toEqual({ trail: 'stars' });
  });

  it('treats an absent look as empty', () => {
    expect(sanitize(null, true)).toEqual({});
    expect(sanitize(undefined, false)).toEqual({});
  });
});

describe('pack / unpack', () => {
  it('round-trips a full look', () => {
    expect(unpackCosmetics(packCosmetics(loaded))).toEqual(loaded);
  });

  it('stays short enough to ride along on a leaderboard row', () => {
    expect(packCosmetics(loaded).length).toBeLessThan(100);
    expect(packCosmetics({})).toBe('');
  });

  it('survives junk input', () => {
    expect(unpackCosmetics('')).toEqual({});
    expect(unpackCosmetics('garbage')).toEqual({});
    expect(unpackCosmetics(null)).toEqual({});
  });
});

describe('friend-or-foe sides', () => {
  it('solo: only the local kart is self, everyone else is a rival', () => {
    expect(sideOf(3, 3, 'solo')).toBe('self');
    expect(sideOf(5, 3, 'solo')).toBe('rival');
    expect(sideOf(1, 3, 'solo')).toBe('rival');
  });

  it('team: same-parity kart ids are allies', () => {
    expect(sideOf(3, 3, 'teamPoints')).toBe('self');
    expect(sideOf(1, 3, 'teamPoints')).toBe('ally');
    expect(sideOf(2, 3, 'teamPoints')).toBe('rival');
    expect(sideOf(0, 2, 'teamFirst')).toBe('ally');
  });
});
