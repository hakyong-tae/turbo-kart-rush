import { describe, expect, it } from 'vitest';
import { crazyDevice, crazyGameplay, crazyMuted, crazyReady, onCrazyMute, pickRecord, recordProgress, saveRecord, startCrazyGames, whenRecordSettled } from './crazygames';

const record = (r: number, f: number, coins: number, xp = 0): string => JSON.stringify({ lad: { all: false, day: '2026-11-22', r, f, p: 0, w: 0, d: 0 }, coins, xp });

describe('the player record: which of two copies to keep', () => {
  it('reads races and earnings out of a record, and nothing out of rubbish', () => {
    expect(recordProgress(record(3, 2, 150, 40))).toEqual([5, 190]);
    expect(recordProgress(JSON.stringify({ coins: 300, xp: 120 }))).toEqual([0, 420]);
    expect(recordProgress(null)).toBeNull();
    expect(recordProgress('')).toBeNull();
    expect(recordProgress('{not json')).toBeNull();
    expect(recordProgress('null')).toBeNull();
  });

  it('keeps the copy with more races behind it', () => {
    expect(pickRecord(record(1, 1, 500), record(4, 3, 60))).toBe('remote');
    expect(pickRecord(record(4, 3, 60), record(1, 1, 500))).toBe('local');
  });

  it('breaks a tie on races by what has been earned', () => {
    expect(pickRecord(record(2, 2, 100), record(2, 2, 180))).toBe('remote');
    expect(pickRecord(record(2, 2, 180), record(2, 2, 100))).toBe('local');
  });

  it('never throws away local progress for an empty or broken account copy', () => {
    expect(pickRecord(record(2, 2, 100), null)).toBe('local');
    expect(pickRecord(record(2, 2, 100), '{broken')).toBe('local');
    expect(pickRecord(record(2, 2, 100), record(2, 2, 100))).toBe('local');
  });

  it('takes the account copy on a device that has nothing', () => {
    expect(pickRecord(null, record(1, 1, 60))).toBe('remote');
    expect(pickRecord(null, null)).toBe('local');
  });

  it('prefers a pre-ladder account with earnings over a blank new one', () => {
    expect(pickRecord(record(0, 0, 0), JSON.stringify({ coins: 300, xp: 120 }))).toBe('remote');
  });
});

describe('a build without the SDK', () => {
  it('does nothing, asks for nothing and holds nothing up', async () => {
    startCrazyGames();
    expect(crazyReady()).toBe(false);
    expect(crazyMuted()).toBe(false);
    expect(crazyDevice()).toBeNull();
    crazyGameplay(true);
    saveRecord('k', 'v');
    let heard = false;
    onCrazyMute(() => (heard = true))();
    expect(heard).toBe(false);
    const t0 = Date.now();
    await whenRecordSettled('k');
    expect(Date.now() - t0).toBeLessThan(50);
  });
});
