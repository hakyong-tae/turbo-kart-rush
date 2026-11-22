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

/** Results screen: go on to the next race by itself. On unless the player turned it off in Settings. */
export const AUTO_NEXT_KEY = 'tkr.autoNext';

export function readAutoNext(): boolean {
  try {
    return localStorage.getItem(AUTO_NEXT_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeAutoNext(on: boolean): void {
  try {
    localStorage.setItem(AUTO_NEXT_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/** Touch auto-accelerate. On unless the player turned it off in Settings. */
export const AUTO_ACCEL_KEY = 'tkr.autoAccel';

export function readAutoAccel(): boolean {
  try {
    return localStorage.getItem(AUTO_ACCEL_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeAutoAccel(on: boolean): void {
  try {
    localStorage.setItem(AUTO_ACCEL_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/**
 * Set once this device has been through the first-visit decision: a brand-new account goes
 * straight into a race, and nobody is sent into one twice.
 */
export const FIRST_RACE_KEY = 'tkr.firstRace';
/** Set once the first-race coach has been shown (finished, skipped or driven past). */
export const COACH_KEY = 'tkr.coach';
/** The UTC day on which the "tomorrow's check-in" window last opened by itself. */
export const TOMORROW_KEY = 'tkr.tomorrow';

/** A one-time device flag. Unreadable storage counts as set, for the same reason as the legend. */
export function hasFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

export function setFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* private mode */
  }
}
