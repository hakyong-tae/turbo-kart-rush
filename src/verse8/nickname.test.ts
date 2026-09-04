import { describe, expect, it } from 'vitest';
import { defaultNickname, normalizeNickname } from './nickname';

describe('nickname', () => {
  it('trims, caps at 12, keeps letters/digits/hangul/space', () => {
    expect(normalizeNickname('  Kart Kid  ')).toBe('Kart Kid');
    expect(normalizeNickname('가나다라마바사아자차카타파하')).toBe('가나다라마바사아자차카타');
    expect(normalizeNickname('a<b>c!!')).toBe('abc');
  });
  it('returns empty for nothing usable', () => {
    expect(normalizeNickname('!!!')).toBe('');
    expect(normalizeNickname(undefined)).toBe('');
  });
  it('blocks a few slurs', () => {
    expect(normalizeNickname('nigger')).toBe('');
  });
  it('default from account tail', () => {
    expect(defaultNickname('0xabcdef1234')).toBe('RACER-1234');
    expect(defaultNickname('')).toBe('RACER');
  });
});
