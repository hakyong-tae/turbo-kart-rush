import { describe, expect, it } from 'vitest';
import serverSource from '../../server.js?raw';
import { CHARACTERS } from '../kart/roster';
import { TRACKS } from '../track/tracks';
import { CUPS } from '../core/cups';

/**
 * server.js keeps its own lists of valid ids (it cannot import client code). When they drift, the
 * failure is silent and expensive: a kart missing from CHARACTERS has every record rejected, a
 * premium kart missing from PREMIUM races for free, a circuit missing from TRACKS never gets a
 * board. These tests read the lists out of the server source and hold them to the client's.
 */
function setOf(name: string): string[] {
  const m = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(serverSource as string);
  if (!m) throw new Error(`server.js has no ${name} set`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

describe('server.js id lists match the client', () => {
  it('CHARACTERS = every racer in the roster', () => {
    expect(setOf('CHARACTERS')).toEqual(CHARACTERS.map((c) => c.id).sort());
  });
  it('PREMIUM = every premium racer', () => {
    expect(setOf('PREMIUM')).toEqual(CHARACTERS.filter((c) => c.premium).map((c) => c.id).sort());
  });
  it('TRACKS = every circuit', () => {
    expect(setOf('TRACKS')).toEqual(TRACKS.map((t) => t.id).sort());
  });
  it('CUPS = every cup', () => {
    expect(setOf('CUPS')).toEqual(CUPS.map((c) => c.id).sort());
  });
});
