/**
 * Line icons as inline SVG: 24×24 grid, stroke 2, `currentColor`.
 *
 * The UI used to say these things with emoji and arrow glyphs typed into the strings. Those render
 * in whatever the platform's emoji font happens to be — a different picture on every phone, in
 * colours the palette does not have. An icon drawn here is the same everywhere, takes the colour
 * of the text beside it, and costs no asset.
 *
 * Icons are attached in the DOM next to their label. They never go into a translated string.
 */

/** A path's `d`, or a circle as ['c', cx, cy, r]. */
type Shape = string | readonly ['c', number, number, number];

const SHAPES = {
  // menus
  trophy: ['M7 4h10v5a5 5 0 0 1-10 0z', 'M7 6H4v1a3 3 0 0 0 3 3', 'M17 6h3v1a3 3 0 0 1-3 3', 'M12 14v4', 'M8 20h8'],
  wrench: ['M15 4a4.5 4.5 0 0 0-4.8 6L4 16.2 7.8 20l6.2-6.2a4.5 4.5 0 0 0 6-4.8l-2.8 2.8-3-1-1-3z'],
  gear: [
    ['c', 12, 12, 3],
    ['c', 12, 12, 7],
    'M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7',
  ],
  flag: ['M5 21V4', 'M5 4h14l-3 4.5 3 4.5H5'],
  globe: [['c', 12, 12, 9], 'M3 12h18', 'M12 3c3.2 3.4 3.2 14.6 0 18', 'M12 3c-3.2 3.4-3.2 14.6 0 18'],
  calendar: ['M4 6h16v14H4z', 'M4 10.5h16', 'M8 3v5M16 3v5'],
  users: [['c', 9, 8, 3], 'M3 20v-1a6 6 0 0 1 12 0v1', 'M16 5.2a3 3 0 0 1 0 5.6', 'M21 20v-1a6 6 0 0 0-3.5-5.4'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  'chevron-left': ['M15 5l-7 7 7 7'],
  'chevron-right': ['M9 5l7 7-7 7'],
  'chevron-up': ['M5 15l7-7 7 7'],
  'chevron-down': ['M5 9l7 7 7-7'],
  spray: ['M8 11h8v10H8z', 'M10 11V7.5h4V11', 'M14 5.5h2', 'M19 3.5h.01M21 5.5h.01M19 7.5h.01'],
  ad: ['M3 5h18v12H3z', 'M8 21h8', 'M10 8.5v5l4.5-2.5z'],
  cart: ['M3 4h2.5l2.3 10h9.4L19.5 7H7', ['c', 9.5, 18.5, 1.5], ['c', 16, 18.5, 1.5]],
  sound: ['M4 9.5v5h4l5 4v-13l-5 4z', 'M16.5 9a4.2 4.2 0 0 1 0 6', 'M19 6.5a7.6 7.6 0 0 1 0 11'],
  mute: ['M4 9.5v5h4l5 4v-13l-5 4z', 'M17 9.5l4 5M21 9.5l-4 5'],
  pause: ['M7 5h3v14H7z', 'M14 5h3v14h-3z'],
  play: ['M7 4.5v15l12-7.5z'],
  'rotate-phone': ['M3 13h15v7H3z', 'M8 9V7a3 3 0 0 1 3-3h5', 'M14 2l2.5 2L14 6', 'M15.5 16.5h.01'],
  star: ['M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8z'],
  check: ['M4.5 12.5l5 5L19.5 7'],
  close: ['M6 6l12 12M18 6L6 18'],
  uturn: ['M7 20V10a5 5 0 0 1 10 0v7', 'M13.5 13.5 17 17l3.5-3.5'],
  // progression (drawn now so the next chunk has them)
  coin: [['c', 12, 12, 8.5], 'M12 8v8', 'M9.5 10h3.7a1.6 1.6 0 0 1 0 3.2H10'],
  flame: ['M12 3c.8 3.6 5 5.4 5 10.5a5 5 0 0 1-10 0c0-2 .8-3.5 2-4.6.2 1.7 1 2.6 2 2.6-.5-3 .1-6 1-8.5z'],
  target: [['c', 12, 12, 9], ['c', 12, 12, 5], ['c', 12, 12, 1]],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof SHAPES;

export const ICON_NAMES = Object.keys(SHAPES) as readonly IconName[];

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A fresh `<svg class="icon">` for `name`. Throws on a name that is not in the table: a missing
 * icon is a typo to fix at the call site, not something to paper over with an empty box.
 */
export function icon(name: IconName, extraClass?: string): SVGSVGElement {
  const shapes: readonly Shape[] | undefined = (SHAPES as Record<string, readonly Shape[]>)[name];
  if (!shapes) throw new Error(`unknown icon: ${String(name)}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', extraClass ? `icon icon-${name} ${extraClass}` : `icon icon-${name}`);
  for (const shape of shapes) {
    if (typeof shape === 'string') {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', shape);
      svg.appendChild(path);
    } else {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(shape[1]));
      circle.setAttribute('cy', String(shape[2]));
      circle.setAttribute('r', String(shape[3]));
      svg.appendChild(circle);
    }
  }
  return svg;
}
