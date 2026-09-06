/**
 * Roster → kart slot assignment. Pure and deterministic so every client builds the same
 * eight karts from the same room state.
 */
import { KART_COUNT } from '../core/constants';
import type { CharacterDef } from '../core/types';
import type { RosterEntry } from './protocol';

export interface RosterInput {
  account: string;
  nick: string;
  characterId: string;
  joinedAt: number;
}

/** Host first, then by joinedAt (ties broken by account), capped at KART_COUNT humans. */
export function buildRoster(players: readonly RosterInput[], hostAccount: string): RosterEntry[] {
  const sorted = players
    .slice()
    .sort((a, b) => {
      if (a.account === hostAccount) return -1;
      if (b.account === hostAccount) return 1;
      if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
      return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
    })
    .slice(0, KART_COUNT);
  return sorted.map((p, i) => ({ account: p.account, nick: p.nick, characterId: p.characterId, kartId: i }));
}

/**
 * Character for every kart slot 0..KART_COUNT-1: humans keep their pick (duplicates allowed),
 * AI slots take the remaining roster characters in roster order (then wrap if exhausted).
 */
export function assignSlotCharacters(roster: readonly RosterEntry[], characters: readonly CharacterDef[]): CharacterDef[] {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const fallback = characters[0];
  const taken = new Set(roster.map((r) => r.characterId));
  const pool = characters.filter((c) => !taken.has(c.id));
  const out: CharacterDef[] = [];
  let aiIndex = 0;
  for (let id = 0; id < KART_COUNT; id++) {
    const human = roster.find((r) => r.kartId === id);
    if (human) {
      out.push(byId.get(human.characterId) ?? fallback);
    } else {
      const c = pool.length > 0 ? pool[aiIndex % pool.length] : characters[aiIndex % characters.length];
      aiIndex++;
      out.push(c);
    }
  }
  return out;
}

export function kartIdOf(roster: readonly RosterEntry[], account: string): number | null {
  const e = roster.find((r) => r.account === account);
  return e ? e.kartId : null;
}

/**
 * Host migration: the remaining human with the lowest kart id (= earliest joiner) takes over.
 * Deterministic on every client as long as they agree on who has left.
 */
export function pickNextHost(roster: readonly RosterEntry[], gone: ReadonlySet<string>): RosterEntry | null {
  const alive = roster.filter((r) => !gone.has(r.account)).sort((a, b) => a.kartId - b.kartId);
  return alive[0] ?? null;
}
