import { describe, expect, it } from 'vitest';
import serverSource from '../../server.js?raw';
import * as economy from '../core/economy';

/**
 * server.js computes every coin; src/core/economy.ts only prints what it expects the server to
 * say. If the two tables drift the garage shows one price and charges another, so this reads the
 * server's constants straight out of its source and holds them equal to the client's.
 */
function serverTables(names: readonly string[]): Record<string, unknown> {
  const factory = new Function('$global', '$sender', '$room', `${serverSource}\nreturn { ${names.join(', ')} };`);
  return factory({}, { account: 'x' }, {}) as Record<string, unknown>;
}

describe('server.js economy tables match the client', () => {
  const NAMES = ['RACE_COINS', 'RETIRE_COINS', 'DIFF_PCT', 'FULL_RACES', 'REDUCED_PCT', 'RACE_CAP', 'KART_PRICE', 'COS_PRICES'] as const;
  const server = serverTables(NAMES);
  for (const name of NAMES) {
    it(name, () => {
      expect(server[name]).toEqual((economy as Record<string, unknown>)[name]);
    });
  }
});
