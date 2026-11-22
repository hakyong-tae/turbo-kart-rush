/**
 * How each kind of circuit is lit and developed: the colour grade, how much it blooms, and how
 * the ambient light is split between the flat hemisphere light and the environment probe.
 *
 * One entry per theme, with a few circuits adjusted by id where their sky asks for it (a sunset
 * beach is not graded like a noon one).
 */
import type { TrackDefinition, TrackTheme } from '../core/types';
import { DEFAULT_LOOK, type PostLook } from '../fx/PostFX';

export interface SceneLook {
  post: PostLook;
  /** Strength of reflections and ambient light from the environment probe. */
  envIntensity: number;
  /** Multiplier on the circuit's hemisphere light, which the probe now partly replaces. */
  hemiScale: number;
  /** Multiplier on the circuit's sun light. */
  sunScale: number;
}

const day = (post: Partial<PostLook>, rest: Partial<Omit<SceneLook, 'post'>> = {}): SceneLook => ({
  post: {
    ...DEFAULT_LOOK,
    exposure: 1,
    filmic: 0.3,
    contrast: 1.07,
    saturation: 1.1,
    vibrance: 0.18,
    shadowTint: 0xf2f5ff,
    highTint: 0xfffaf2,
    bloom: 0.6,
    bloomThreshold: 1.0,
    bloomKnee: 0.5,
    vignette: 0.2,
    shafts: 0.55,
    flare: 0.6,
    ...post,
  },
  envIntensity: 0.8,
  hemiScale: 0.55,
  sunScale: 1.08,
  ...rest,
});

const THEME_LOOKS: Readonly<Record<TrackTheme, SceneLook>> = {
  grassland: day({}),
  beach: day({ exposure: 1.03, saturation: 1.14, highTint: 0xfffbf0, shadowTint: 0xeef6ff }),
  desert: day({ saturation: 1.08, highTint: 0xfff4e2, shadowTint: 0xf1eeff, shafts: 0.8, flare: 0.75, bloom: 0.7 }),
  volcano: day(
    { filmic: 0.45, contrast: 1.1, saturation: 1.1, shadowTint: 0xefe6ff, highTint: 0xfff1de, shafts: 0.55, flare: 0.6, bloom: 0.8, bloomThreshold: 0.9, vignette: 0.26 },
    { envIntensity: 0.9, hemiScale: 0.7 },
  ),
  snow: day({ exposure: 0.94, saturation: 1.06, vibrance: 0.22, shadowTint: 0xeaf2ff, highTint: 0xffffff, bloomThreshold: 1.15, bloom: 0.5, shafts: 0.5 }, { envIntensity: 0.7, hemiScale: 0.5 }),
  neon: {
    post: {
      ...DEFAULT_LOOK,
      exposure: 1.08,
      filmic: 0.55,
      contrast: 1.08,
      saturation: 1.18,
      vibrance: 0.1,
      shadowTint: 0xf0ebff,
      highTint: 0xffffff,
      bloom: 0.95,
      bloomThreshold: 0.72,
      bloomKnee: 0.5,
      vignette: 0.3,
      shafts: 0,
      flare: 0,
    },
    envIntensity: 1.1,
    hemiScale: 0.75,
    sunScale: 1,
  },
};

/** Circuits whose sky does not match their theme's usual hour. */
const TRACK_TWEAKS: Readonly<Record<string, (base: SceneLook) => SceneLook>> = {};

export function lookFor(def: TrackDefinition): SceneLook {
  const base = THEME_LOOKS[def.theme] ?? THEME_LOOKS.grassland;
  const tweak = TRACK_TWEAKS[def.id];
  return tweak ? tweak(base) : base;
}
