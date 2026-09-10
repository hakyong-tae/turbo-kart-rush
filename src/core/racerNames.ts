/**
 * Handles for the AI field.
 *
 * The standings board shows who is driving rather than what they are driving, which leaves the
 * bots needing names. They get handles that look like other players' — that is the point: in an
 * online race with two humans and six bots, a board reading "Zippy Nova, Pixel Pop, …" announces
 * exactly which six are not people.
 *
 * Names are a pure function of the circuit and the kart slot, so every client in an online race
 * shows the same field without syncing anything, and a given circuit keeps its regulars.
 */

/** Short, latin, no real-person names, nothing that reads as an official account. */
const HANDLES: readonly string[] = [
  'apex_kid', 'DriftLordK', 'nono', 'Bumper2Bumper', 'ssamba', 'QuickSilver', 'mangoT',
  'NoBrakes', 'turbo_ttang', 'GhostLine', 'pixel8', 'Redline99', 'kkobuk', 'SlipStream',
  'BoostJunkie', 'latecall', 'Hairpin_H', 'zzangHan', 'CurbHopper', 'onemoreLap',
  'ByeBanana', 'Tailgater', 'nunchi', 'SecondPlace', 'wallride', 'dodo_kart', 'FinalLap',
  'grip_or_slip',
];

/** FNV-1a, so the pick is stable across engines and clients. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Handle for the bot in `kartId` on `trackId`. Distinct per slot within a race: the offset walks
 * the list rather than re-hashing, so two bots can never draw the same name.
 */
export function botName(trackId: string, kartId: number): string {
  const start = hash(trackId) % HANDLES.length;
  return HANDLES[(start + kartId) % HANDLES.length];
}

/** What to show for the local player: their nickname, or the kart's name if they never set one. */
export function localRacerName(nickname: string, characterName: string): string {
  const n = nickname.trim();
  return n.length > 0 ? n : characterName;
}
