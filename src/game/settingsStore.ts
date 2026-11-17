/**
 * Device-local settings (localStorage) that are NOT account state: mixer levels, language
 * (see core/i18n), nickname nudge flag. Account-authoritative data lives on the Verse8 server
 * (src/verse8/entitlements.ts) — never here.
 */
export const VOLUME_KEY_MUSIC = 'tkr.vol.music';
export const VOLUME_KEY_SFX = 'tkr.vol.sfx';

/** Stored mixer level (0..1) or the fallback when unset / unreadable. */
export function readVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  } catch {
    return fallback;
  }
}

export function writeVolume(key: string, level: number): void {
  try {
    localStorage.setItem(key, String(Math.max(0, Math.min(1, level))));
  } catch {
    /* private mode */
  }
}

/** Set once the controls legend has been shown on a loading screen. */
export const SEEN_CONTROLS_KEY = 'tkr.seenControls';

/**
 * Whether the first-race controls legend has already been shown on this device.
 * Unreadable storage counts as "seen": the legend is a one-time courtesy, and showing it before
 * every race to someone whose browser blocks storage would be worse than never showing it.
 */
export function hasSeenControls(): boolean {
  try {
    return localStorage.getItem(SEEN_CONTROLS_KEY) !== null;
  } catch {
    return true;
  }
}

export function markControlsSeen(): void {
  try {
    localStorage.setItem(SEEN_CONTROLS_KEY, '1');
  } catch {
    /* private mode */
  }
}
