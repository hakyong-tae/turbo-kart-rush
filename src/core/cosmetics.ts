/**
 * Kart cosmetics catalogue (contract addition, garage).
 *
 * Everything here is a parameter on geometry, shaders and audio we already build, so adding an
 * entry costs a few lines and zero bytes of asset. See
 * docs/superpowers/specs/2026-09-09-garage-and-progression-design.md.
 *
 * Tiers: colours are free, patterns and effects need the `premium-garage` product.
 * `sanitize()` is the single gate — call it on load, on save and before rendering someone else.
 */

export type PatternId =
  | 'none'
  // stripes
  | 'stripe' | 'twinStripe' | 'offsetStripe' | 'pinstripe' | 'wideBand'
  // racing liveries
  | 'rally' | 'numberPanel' | 'chevron' | 'arrow' | 'dagger'
  // geometric
  | 'checker' | 'halfChecker' | 'diamond' | 'hexMesh' | 'circuit' | 'grid'
  // organic
  | 'camo' | 'splatter' | 'tiger' | 'blaze' | 'bolt' | 'wave'
  // fades
  | 'twoTone' | 'diagonalFade' | 'topFade' | 'chromeSweep' | 'iridescent'
  // special
  | 'carbon' | 'holo' | 'starfield' | 'glitch' | 'wireframe';

export type UnderglowId = 'none' | 'solid' | 'pulse' | 'breathe' | 'strobe' | 'rainbow' | 'ripple';
export type TrailId = 'none' | 'ribbon' | 'sparks' | 'smoke' | 'stars' | 'hex' | 'bolts' | 'shards' | 'rings' | 'embers' | 'pixels';
export type FlameId = 'none' | 'jet' | 'plasma' | 'ember' | 'ion' | 'frost' | 'void' | 'prism' | 'pulseJet';
export type WheelFxId = 'none' | 'spokeGlow' | 'rimLight' | 'tyreTrail' | 'spinBlur';
export type EnginePackId = 'scream' | 'rumble' | 'electric' | 'diesel' | 'turbine' | 'chiptune';
export type BadgeId = 'none' | 'bolt' | 'crown' | 'flame' | 'skull' | 'star' | 'gear' | 'wing' | 'diamond';

/** A player's kart look. Every field is optional; absent means the character's own default. */
export interface KartCosmetics {
  // --- free: colours -------------------------------------------------------
  body?: number;
  accent?: number;
  rim?: number;
  helmet?: number;
  // --- paid: pattern -------------------------------------------------------
  pattern?: PatternId;
  patternColor?: number;
  // --- paid: effects -------------------------------------------------------
  underglow?: UnderglowId;
  underglowColor?: number;
  trail?: TrailId;
  trailColor?: number;
  flame?: FlameId;
  wheelFx?: WheelFxId;
  enginePack?: EnginePackId;
  badge?: BadgeId;
}

export interface CatalogueEntry<T extends string> {
  id: T;
  /** i18n key suffix: `cos.<group>.<id>`. */
  free: boolean;
}

const paid = <T extends string>(ids: readonly T[]): CatalogueEntry<T>[] => ids.map((id) => ({ id, free: false }));

/** Pattern ids in garage order. `none` is the only free one: patterns are a paid tier. */
export const PATTERNS: readonly CatalogueEntry<PatternId>[] = [
  { id: 'none', free: true },
  ...paid<PatternId>([
    'stripe', 'twinStripe', 'offsetStripe', 'pinstripe', 'wideBand',
    'rally', 'numberPanel', 'chevron', 'arrow', 'dagger',
    'checker', 'halfChecker', 'diamond', 'hexMesh', 'circuit', 'grid',
    'camo', 'splatter', 'tiger', 'blaze', 'bolt', 'wave',
    'twoTone', 'diagonalFade', 'topFade', 'chromeSweep', 'iridescent',
    'carbon', 'holo', 'starfield', 'glitch', 'wireframe',
  ]),
];

export const UNDERGLOWS: readonly CatalogueEntry<UnderglowId>[] = [
  { id: 'none', free: true },
  ...paid<UnderglowId>(['solid', 'pulse', 'breathe', 'strobe', 'rainbow', 'ripple']),
];

export const TRAILS: readonly CatalogueEntry<TrailId>[] = [
  { id: 'none', free: true },
  ...paid<TrailId>(['ribbon', 'sparks', 'smoke', 'stars', 'hex', 'bolts', 'shards', 'rings', 'embers', 'pixels']),
];

export const FLAMES: readonly CatalogueEntry<FlameId>[] = [
  { id: 'none', free: true },
  ...paid<FlameId>(['jet', 'plasma', 'ember', 'ion', 'frost', 'void', 'prism', 'pulseJet']),
];

export const WHEEL_FX: readonly CatalogueEntry<WheelFxId>[] = [
  { id: 'none', free: true },
  ...paid<WheelFxId>(['spokeGlow', 'rimLight', 'tyreTrail', 'spinBlur']),
];

/** The stock voice is free so a free player still hears a real engine. */
export const ENGINE_PACKS: readonly CatalogueEntry<EnginePackId>[] = [
  { id: 'scream', free: true },
  ...paid<EnginePackId>(['rumble', 'electric', 'diesel', 'turbine', 'chiptune']),
];

export const BADGES: readonly CatalogueEntry<BadgeId>[] = [
  { id: 'none', free: true },
  ...paid<BadgeId>(['bolt', 'crown', 'flame', 'skull', 'star', 'gear', 'wing', 'diamond']),
];

/** Colour swatches offered in the garage. Free for everyone. */
export const SWATCHES: readonly number[] = [
  0xffffff, 0xd9dee6, 0x9aa3b2, 0x4a5160, 0x22262f, 0x101218,
  0xff3b4a, 0xff6a1a, 0xffb020, 0xffe14a, 0xa8e04a, 0x3ddc84,
  0x19d3c5, 0x36d5ea, 0x3a7bff, 0x7c3aed, 0xc26bff, 0xff4fa3,
  0x8a4b2a, 0xf2d6b3, 0x0b3a44, 0x2a1600, 0x6b4a12, 0xf2a91c,
];

/** Curated looks. Free players may use the first three; the rest need the garage. */
export interface PresetLook {
  id: string;
  free: boolean;
  cos: KartCosmetics;
}

export const PRESETS: readonly PresetLook[] = [
  { id: 'stock', free: true, cos: {} },
  { id: 'mono', free: true, cos: { body: 0x22262f, accent: 0xd9dee6, rim: 0x9aa3b2, helmet: 0xffffff } },
  { id: 'sunset', free: true, cos: { body: 0xff6a1a, accent: 0xffe14a, rim: 0xffb020, helmet: 0x2a1600 } },
  { id: 'works', free: false, cos: { body: 0x3a7bff, accent: 0xffffff, pattern: 'stripe', patternColor: 0xffffff, flame: 'ion', badge: 'wing' } },
  { id: 'midnight', free: false, cos: { body: 0x101218, accent: 0x7c3aed, pattern: 'pinstripe', patternColor: 0x7c3aed, underglow: 'breathe', underglowColor: 0x7c3aed, trail: 'stars', trailColor: 0xc26bff, badge: 'star' } },
  { id: 'inferno', free: false, cos: { body: 0x22262f, accent: 0xff3b4a, pattern: 'blaze', patternColor: 0xff6a1a, flame: 'ember', trail: 'embers', trailColor: 0xff6a1a, badge: 'flame' } },
  { id: 'arctic', free: false, cos: { body: 0xd9dee6, accent: 0x36d5ea, pattern: 'camo', patternColor: 0x9aa3b2, flame: 'frost', trail: 'smoke', trailColor: 0xd9dee6 } },
  { id: 'circuit', free: false, cos: { body: 0x0b3a44, accent: 0x3ddc84, pattern: 'circuit', patternColor: 0x3ddc84, underglow: 'pulse', underglowColor: 0x3ddc84, trail: 'hex', trailColor: 0x3ddc84, enginePack: 'electric' } },
  { id: 'chrome', free: false, cos: { body: 0x9aa3b2, accent: 0xffffff, pattern: 'chromeSweep', patternColor: 0xffffff, wheelFx: 'rimLight', badge: 'diamond' } },
  { id: 'rally', free: false, cos: { body: 0xffffff, accent: 0xff3b4a, pattern: 'rally', patternColor: 0x3a7bff, wheelFx: 'tyreTrail', enginePack: 'diesel' } },
  { id: 'holoGrid', free: false, cos: { body: 0x101218, accent: 0xc26bff, pattern: 'holo', patternColor: 0x36d5ea, underglow: 'rainbow', trail: 'rings', trailColor: 0xc26bff, flame: 'prism' } },
  { id: 'hazard', free: false, cos: { body: 0xffe14a, accent: 0x22262f, pattern: 'checker', patternColor: 0x22262f, badge: 'gear', enginePack: 'rumble' } },
  { id: 'phantom', free: false, cos: { body: 0x101218, accent: 0x4a5160, pattern: 'glitch', patternColor: 0x19d3c5, flame: 'void', trail: 'shards', trailColor: 0x19d3c5, badge: 'skull' } },
  { id: 'goldLeaf', free: false, cos: { body: 0x2a1600, accent: 0xf2a91c, pattern: 'wireframe', patternColor: 0xf2a91c, wheelFx: 'spokeGlow', badge: 'crown' } },
  { id: 'jet', free: false, cos: { body: 0x4a5160, accent: 0xffb020, pattern: 'dagger', patternColor: 0xffb020, flame: 'jet', enginePack: 'turbine', trail: 'ribbon', trailColor: 0xffb020 } },
  { id: 'arcade', free: false, cos: { body: 0x7c3aed, accent: 0x3ddc84, pattern: 'starfield', patternColor: 0xffe14a, trail: 'pixels', trailColor: 0x3ddc84, enginePack: 'chiptune', badge: 'bolt' } },
];

// --- helpers -------------------------------------------------------------------

function allow<T extends string>(list: readonly CatalogueEntry<T>[], value: T | undefined, premium: boolean): T | undefined {
  if (value === undefined) return undefined;
  const entry = list.find((e) => e.id === value);
  if (!entry) return undefined;
  if (!entry.free && !premium) return undefined;
  return value;
}

const colour = (v: number | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 0xffffff ? Math.floor(v) : undefined;

/**
 * Drops unknown ids and, when `premium` is false, every paid entry. Colours always survive.
 * Run this on load, before save, and on cosmetics received from another client.
 */
export function sanitize(cos: KartCosmetics | null | undefined, premium: boolean): KartCosmetics {
  if (!cos) return {};
  const out: KartCosmetics = {};
  const setC = (k: 'body' | 'accent' | 'rim' | 'helmet' | 'patternColor' | 'underglowColor' | 'trailColor') => {
    const v = colour(cos[k]);
    if (v !== undefined) out[k] = v;
  };
  setC('body');
  setC('accent');
  setC('rim');
  setC('helmet');
  const pattern = allow(PATTERNS, cos.pattern, premium);
  if (pattern && pattern !== 'none') {
    out.pattern = pattern;
    setC('patternColor');
  }
  const underglow = allow(UNDERGLOWS, cos.underglow, premium);
  if (underglow && underglow !== 'none') {
    out.underglow = underglow;
    setC('underglowColor');
  }
  const trail = allow(TRAILS, cos.trail, premium);
  if (trail && trail !== 'none') {
    out.trail = trail;
    setC('trailColor');
  }
  const flame = allow(FLAMES, cos.flame, premium);
  if (flame && flame !== 'none') out.flame = flame;
  const wheelFx = allow(WHEEL_FX, cos.wheelFx, premium);
  if (wheelFx && wheelFx !== 'none') out.wheelFx = wheelFx;
  const enginePack = allow(ENGINE_PACKS, cos.enginePack, premium);
  if (enginePack && enginePack !== 'scream') out.enginePack = enginePack;
  const badge = allow(BADGES, cos.badge, premium);
  if (badge && badge !== 'none') out.badge = badge;
  return out;
}

/** True when the look uses anything from the paid tier. */
export function usesPaid(cos: KartCosmetics): boolean {
  return Object.keys(sanitize(cos, true)).length !== Object.keys(sanitize(cos, false)).length;
}

// --- compact wire / storage form ------------------------------------------------
//
// `tkr_times` rows are read a thousand at a time, so a record snapshot must not add a dozen
// fields. The whole look packs into one short string: `k:v` pairs joined by `,`, colours in hex
// and catalogue entries as their index in base 36.
//
// IMPORTANT: catalogue arrays are append-only. Reordering an existing entry silently repaints
// every saved look, the same rule that applies to `ALL_ITEM_TYPES` in core/types.ts.

const COLOUR_KEYS = { b: 'body', a: 'accent', r: 'rim', h: 'helmet', pc: 'patternColor', uc: 'underglowColor', tc: 'trailColor' } as const;
const ENUM_KEYS = {
  p: { field: 'pattern', list: PATTERNS },
  u: { field: 'underglow', list: UNDERGLOWS },
  t: { field: 'trail', list: TRAILS },
  f: { field: 'flame', list: FLAMES },
  w: { field: 'wheelFx', list: WHEEL_FX },
  e: { field: 'enginePack', list: ENGINE_PACKS },
  g: { field: 'badge', list: BADGES },
} as const;

export function packCosmetics(cos: KartCosmetics): string {
  const parts: string[] = [];
  for (const [short, field] of Object.entries(COLOUR_KEYS)) {
    const v = cos[field];
    if (typeof v === 'number') parts.push(`${short}:${v.toString(16)}`);
  }
  for (const [short, spec] of Object.entries(ENUM_KEYS)) {
    const v = cos[spec.field as keyof KartCosmetics] as string | undefined;
    if (v === undefined) continue;
    const i = (spec.list as readonly CatalogueEntry<string>[]).findIndex((e) => e.id === v);
    if (i >= 0) parts.push(`${short}:${i.toString(36)}`);
  }
  return parts.join(',');
}

export function unpackCosmetics(packed: string | null | undefined): KartCosmetics {
  if (!packed || typeof packed !== 'string') return {};
  const out: Record<string, unknown> = {};
  for (const part of packed.split(',')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const short = part.slice(0, i);
    const raw = part.slice(i + 1);
    const colour = (COLOUR_KEYS as Record<string, string>)[short];
    if (colour) {
      const v = Number.parseInt(raw, 16);
      if (Number.isFinite(v)) out[colour] = v;
      continue;
    }
    const spec = (ENUM_KEYS as Record<string, { field: string; list: readonly CatalogueEntry<string>[] }>)[short];
    if (!spec) continue;
    const entry = spec.list[Number.parseInt(raw, 36)];
    if (entry) out[spec.field] = entry.id;
  }
  return out as KartCosmetics;
}
