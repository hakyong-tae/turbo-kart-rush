/**
 * Character roster - 8 original racers. Stats are 0..1 and every free racer has one
 * clear speciality paid for by a clear weakness (stat total ≈ 2.6). The three premium
 * racers (rewarded ad / 100 VX) keep their class feel but drop the class penalty, so
 * they are simply better cars (stat total ≈ 3.4).
 *
 *   zippy  launch specialist   — best acceleration, weak top speed / mini-turbo
 *   pixel  cornering specialist — best handling, slowest top speed
 *   max    all-rounder          — 0.55 everywhere
 *   juno   drift specialist     — best mini-turbo, sluggish and heavy-handed
 *   kai    speed medium         — fast for a medium, poor mini-turbo
 *   fennec (premium) light with real top speed and a perfect mini-turbo
 *   bram   (premium) heavy that actually accelerates and can shove anyone
 *   rosa   (premium) fastest kart in the game with a strong mini-turbo
 */
import type { CharacterDef } from '../core/types';

export const CHARACTERS: CharacterDef[] = [
  // --- light ---------------------------------------------------------------
  {
    id: 'zippy',
    name: 'Zippy Nova',
    color: 0x1fd6ee,
    accent: 0xff3fb4,
    driverColor: 0xf7f9ff,
    weightClass: 'light',
    stats: { speed: 0.3, acceleration: 1.0, handling: 0.7, weight: 0.15, miniTurbo: 0.45 },
    tagline: 'Blink and she is already two corners ahead.',
  },
  {
    id: 'pixel',
    name: 'Pixel Pop',
    color: 0xff4fa3,
    accent: 0x4dffc3,
    driverColor: 0xfff1a8,
    weightClass: 'light',
    stats: { speed: 0.12, acceleration: 0.65, handling: 1.0, weight: 0.1, miniTurbo: 0.8 },
    tagline: 'Sugar-rush handling. Corners are her candy.',
  },
  {
    id: 'fennec',
    premium: true,
    name: 'Fennec Flash',
    color: 0xffcf1f,
    accent: 0xff6a00,
    driverColor: 0x2b1b12,
    weightClass: 'light',
    stats: { speed: 0.6, acceleration: 0.9, handling: 0.85, weight: 0.25, miniTurbo: 1.0 },
    tagline: 'Big ears, bigger mini-turbos.',
  },
  // --- medium --------------------------------------------------------------
  {
    id: 'max',
    name: 'Max Vortex',
    color: 0xe32222,
    accent: 0xffd23f,
    driverColor: 0xffffff,
    weightClass: 'medium',
    stats: { speed: 0.55, acceleration: 0.55, handling: 0.55, weight: 0.5, miniTurbo: 0.55 },
    tagline: 'The all-rounder. Every lap is a highlight reel.',
  },
  {
    id: 'juno',
    name: 'Juno Bolt',
    color: 0x7c3aed,
    accent: 0xffb020,
    driverColor: 0x161326,
    weightClass: 'medium',
    stats: { speed: 0.45, acceleration: 0.4, handling: 0.35, weight: 0.6, miniTurbo: 1.0 },
    tagline: 'Charges every drift like a thunderstorm.',
  },
  {
    id: 'kai',
    name: 'Kai Tidewater',
    color: 0x1e6bff,
    accent: 0xff7a1a,
    driverColor: 0xdff6ff,
    weightClass: 'medium',
    stats: { speed: 0.75, acceleration: 0.5, handling: 0.6, weight: 0.4, miniTurbo: 0.25 },
    tagline: 'Cool as the deep end, smooth as a swell.',
  },
  // --- heavy ---------------------------------------------------------------
  {
    id: 'bram',
    premium: true,
    name: 'Boulder Bram',
    color: 0x1f9a4b,
    accent: 0xd88a3c,
    driverColor: 0x5a3b21,
    weightClass: 'heavy',
    stats: { speed: 0.9, acceleration: 0.5, handling: 0.5, weight: 1.0, miniTurbo: 0.55 },
    tagline: 'Slow to wake up. Impossible to shove.',
  },
  {
    id: 'rosa',
    premium: true,
    name: 'Big Rig Rosa',
    color: 0xff6a00,
    accent: 0x19d3c5,
    driverColor: 0x2a2a34,
    weightClass: 'heavy',
    stats: { speed: 1.0, acceleration: 0.35, handling: 0.4, weight: 0.95, miniTurbo: 0.75 },
    tagline: 'Eighteen wheels of attitude in a four-wheel kart.',
  },
];

export function getCharacter(id: string): CharacterDef {
  for (let i = 0; i < CHARACTERS.length; i++) {
    if (CHARACTERS[i].id === id) return CHARACTERS[i];
  }
  return CHARACTERS[0];
}
