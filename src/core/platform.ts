/**
 * Build target (contract addition, CrazyGames relaunch).
 *
 * The same source ships to two places that disagree about what the game is called and what it may
 * sell. `vite build` is the Verse8 / ONE store edition: DRIFT DASH GP, with the VX garage pass,
 * rewarded ads and the gameserver. `vite build --mode crazygames` is the CrazyGames edition:
 * DRIFT KART, no purchase UI, no rewarded-ad buttons, and the account kept in the browser by the
 * in-page copy of server.js (verse8/localServer.ts).
 *
 * Everything target-specific asks this module, so a third target is one more row here rather than
 * a hunt through the UI. The mode is a compile-time constant, which lets the bundler drop the
 * other edition's branch (and its name) from the output.
 *
 * Design: docs/superpowers/specs/2026-11-20-drift-kart-crazygames-relaunch.md, section 4.8.
 * Pure: no DOM, no storage.
 */

export type Target = 'verse8' | 'crazygames';

export interface Platform {
  target: Target;
  /** The wordmark, in capitals. Its last word rides on the yellow plate. */
  title: string;
  /** The name as written in a sentence. */
  name: string;
  /** Sells the VX garage pass (and shows its wording). */
  vx: boolean;
  /** Offers rewarded ads: double coins, mission swap, streak recovery, premium kart tickets. */
  rewardedAds: boolean;
  /** May offer online races (still behind `ONLINE_ENABLED`). */
  online: boolean;
  /** May be running inside a Verse8 host, with the gameserver as the authority. */
  hosted: boolean;
}

const CRAZYGAMES: Platform = {
  target: 'crazygames',
  title: 'DRIFT KART',
  name: 'Drift Kart',
  vx: false,
  rewardedAds: false,
  online: false,
  hosted: false,
};

const VERSE8: Platform = {
  target: 'verse8',
  title: 'DRIFT DASH GP',
  name: 'Drift Dash GP',
  vx: true,
  rewardedAds: true,
  online: true,
  hosted: true,
};

export const PLATFORM: Platform = import.meta.env.MODE === 'crazygames' ? CRAZYGAMES : VERSE8;
