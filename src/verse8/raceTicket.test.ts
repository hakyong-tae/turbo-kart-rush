// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The network is the thing under test here, so the two race calls are stand-ins.
vi.mock('./server', async (original) => ({
  ...(await original<typeof import('./server')>()),
  serverBeginRace: vi.fn(),
  serverFinishRace: vi.fn(),
}));

import { _resetForTests, abandonRace, beginRace, finishRace } from './entitlements';
import { serverBeginRace, serverFinishRace } from './server';

const begin = vi.mocked(serverBeginRace);
const finish = vi.mocked(serverFinishRace);
const RACE = { trackId: 'sunny_circuit', characterId: 'zippy', difficulty: 'normal' };
const REPORT = { place: 2, retired: false, timeMs: 90000 };

describe('race ticket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    _resetForTests();
    begin.mockReset();
    finish.mockReset();
    finish.mockResolvedValue({ ok: true, raceId: 'r1', coins: 45, races: 1, earned: { race: 45, total: 45 } });
  });
  afterEach(() => vi.useRealTimers());

  it('a start the server heard at once is settled with the race time as reported', async () => {
    begin.mockResolvedValue({ raceId: 'r1' });
    beginRace(RACE);
    await vi.advanceTimersByTimeAsync(100000);
    expect(begin).toHaveBeenCalledTimes(1);
    expect((await finishRace(REPORT))?.ok).toBe(true);
    expect(finish).toHaveBeenCalledWith('r1', REPORT);
  });

  it('a lost start is asked again during the race, and the claim shrinks to what the server saw', async () => {
    begin.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ raceId: 'r1' });
    beginRace(RACE);
    await vi.advanceTimersByTimeAsync(2900);
    expect(begin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200); // 3 s after the first failure
    expect(begin).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6000); // 6 s after the second: confirmed 9 s into the race
    expect(begin).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(81000);
    // Confirmed at 9.0 s, finished at 90.1 s: the race clock says 90 s, the server has vouched
    // for 81.1 of them, and that is what gets claimed.
    expect((await finishRace(REPORT))?.ok).toBe(true);
    const sent = finish.mock.calls[0][1];
    expect(sent.timeMs).toBe(81100);
    expect(sent.place).toBe(2);
  });

  it('a start the server never heard is reported as such, not as silence', async () => {
    begin.mockResolvedValue(null);
    beginRace(RACE);
    await vi.advanceTimersByTimeAsync(120000);
    // First call plus four retries (3, 6, 12, 24 s), then it stops asking.
    expect(begin).toHaveBeenCalledTimes(5);
    expect(await finishRace(REPORT)).toMatchObject({ ok: false, reason: 'no-race' });
    expect(finish).not.toHaveBeenCalled();
  });

  it('a finish that arrives while the start is still in flight waits for it, once', async () => {
    let answer: (v: { raceId: string } | null) => void = () => {};
    begin.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    beginRace(RACE);
    await vi.advanceTimersByTimeAsync(40000);
    const settled = finishRace(REPORT);
    answer(null);
    expect(await settled).toMatchObject({ ok: false, reason: 'no-race' });
    // The race is over: nothing is retried for it.
    await vi.advanceTimersByTimeAsync(60000);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('a new race, or an abandoned one, stops the retries of the old', async () => {
    begin.mockResolvedValue(null);
    beginRace(RACE);
    await vi.advanceTimersByTimeAsync(1000);
    abandonRace();
    await vi.advanceTimersByTimeAsync(60000);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(await finishRace(REPORT)).toBeNull();

    begin.mockResolvedValue({ raceId: 'r2' });
    beginRace(RACE);
    beginRace({ ...RACE, trackId: 'coral_coast' });
    await vi.advanceTimersByTimeAsync(100000);
    await finishRace(REPORT);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0][0]).toBe('r2');
  });

  it('no answer to the finish is null: the caller says the server could not be reached', async () => {
    begin.mockResolvedValue({ raceId: 'r1' });
    finish.mockResolvedValue(null);
    beginRace(RACE);
    await vi.advanceTimersByTimeAsync(100000);
    expect(await finishRace(REPORT)).toBeNull();
  });
});
