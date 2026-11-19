/**
 * Badges as inline SVG paths.
 *
 * A badge is a name-tag thing, not a body panel: it sits beside the player's name in the
 * standings, the results, the records board and the lobby, which means it has to read at 14 px
 * and print in one colour. Eight hand-written paths on a 24×24 grid do that with no asset, no
 * font and no texture, and they scale to any HUD size.
 */
import type { BadgeId } from '../core/cosmetics';

/** Single-path glyphs on a 0..24 box, each silhouette distinct at thumbnail size. */
const PATHS: Readonly<Record<Exclude<BadgeId, 'none'>, string>> = {
  bolt: 'M13.5 2 5 13.5h5.2L9 22l9-12h-5.4z',
  crown: 'M3 8l4.5 4L12 4l4.5 8L21 8l-1.8 11H4.8z',
  flame: 'M12 2c3 4.4 1 6.2 2.6 7.6C16 10.8 17 9.6 17 8c2.4 2.6 3 5.4 3 7 0 4.4-3.6 7-8 7s-8-2.6-8-7c0-3.4 2.4-6.4 4.6-8.2C8.4 8.6 8 10 9 11c1.6-1.8 1-5.6 3-9z',
  skull: 'M12 2C7 2 3.5 5.4 3.5 10c0 2.8 1.4 4.6 3 5.7V19h3v3h5v-3h3v-3.3c1.6-1.1 3-2.9 3-5.7C20.5 5.4 17 2 12 2zM8.5 9.5a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z',
  star: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',
  gear: 'M12 8.4a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2zm9 4.7v-2.2l-2.4-.5a6.9 6.9 0 00-.8-1.9l1.4-2-1.6-1.6-2 1.4a6.9 6.9 0 00-1.9-.8L13.2 3h-2.4l-.5 2.5a6.9 6.9 0 00-1.9.8l-2-1.4L4.8 6.5l1.4 2a6.9 6.9 0 00-.8 1.9L3 10.9v2.2l2.4.5c.2.7.5 1.3.8 1.9l-1.4 2 1.6 1.6 2-1.4c.6.3 1.2.6 1.9.8l.5 2.5h2.4l.5-2.5c.7-.2 1.3-.5 1.9-.8l2 1.4 1.6-1.6-1.4-2c.3-.6.6-1.2.8-1.9z',
  wing: 'M2 9c5-1 9 0 12 3 1.6 1.6 2.6 3.4 3 6-3.4-2.6-6-3.6-8-3.4 1.8-1 3.4-1 5 0-2-3-6-5.6-12-5.6zm10-4c4 .6 7.2 2.6 9.6 6-2.6-1.4-5-2-7.2-1.8A18 18 0 0012 5z',
  diamond: 'M7 3h10l4 6-9 12L3 9z',
  // earn-only (progression)
  medal: 'M8 2h3l1 3 1-3h3l-2.2 6.3a6 6 0 11-3.6 0zM12 10.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  laurel:
    'M12 6.5l1.5 3.2 3.5.4-2.6 2.4.7 3.5-3.1-1.8-3.1 1.8.7-3.5L7 10.1l3.5-.4zM5 5c-2.5 3.5-2.5 8 0 11.5 1.2 1.7 2.8 3 4.6 3.7l.6-1.6c-3.6-1.6-5.4-5.6-4.2-9.6.3-1 .8-2 1.4-2.9zM19 5c2.5 3.5 2.5 8 0 11.5-1.2 1.7-2.8 3-4.6 3.7l-.6-1.6c3.6-1.6 5.4-5.6 4.2-9.6-.3-1-.8-2-1.4-2.9z',
  sun: 'M12 7a5 5 0 110 10 5 5 0 010-10zM11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8L7 8.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM18.4 4.2l1.4 1.4L17 8.4 15.6 7zM7 15.6L8.4 17l-2.8 2.8-1.4-1.4z',
  trophy: 'M7 3h10v2h3v3a4 4 0 01-4 4h-.5A5 5 0 0113 14.9V18h3v3H8v-3h3v-3.1A5 5 0 018.5 12H8a4 4 0 01-4-4V5h3zM6 7v1a2 2 0 001 1.7V7zm11 0v2.7A2 2 0 0018 8V7z',
};

export function badgePath(id: BadgeId | undefined): string | null {
  if (!id || id === 'none') return null;
  return PATHS[id] ?? null;
}

/**
 * An `<svg>` for the badge, or null when there is nothing to draw. `currentColor` so the badge
 * inherits whatever the row already says about the player — friend-or-foe blue and red included.
 */
export function badgeElement(id: BadgeId | undefined, className = 'badge-glyph'): SVGSVGElement | null {
  const d = badgePath(id);
  if (!d) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}
