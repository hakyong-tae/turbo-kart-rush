/**
 * Graphics quality: one place that decides how much the renderer is asked to do.
 *
 * Three tiers. `high` is a desktop with a real GPU, `medium` a recent phone or tablet, `low` an
 * older or weaker one. The tier is picked once at start-up from what the browser will say about
 * the device, and can be forced with `?gfx=low|medium|high` (or the `tkr.gfx` setting). What a
 * tier cannot know — how fast this particular device really is — is left to the resolution
 * governor in `Game`, which lowers the render resolution when frames run long.
 */

export type GfxTier = 'low' | 'medium' | 'high';

export interface GfxQuality {
  readonly tier: GfxTier;
  /** Upper bound on the device pixel ratio the scene is rendered at. */
  readonly pixelRatioCap: number;
  /** Lowest scale the resolution governor may fall to (fraction of the capped pixel ratio). */
  readonly minResolutionScale: number;
  /** MSAA samples on the scene buffer (0 = none). */
  readonly msaa: number;
  /** Sun shadow map edge in texels, and the half extent (metres) of ground it covers. */
  readonly shadowMapSize: number;
  readonly shadowHalfExtent: number;
  /** Soft (PCF soft) or plain PCF shadow filtering. */
  readonly softShadows: boolean;
  /**
   * The sun casts real shadows. Without them the scene is drawn once a frame instead of twice
   * (the shadow map is a second walk over everything that casts one), which is what a slow CPU
   * needs; karts keep the dark patch under them and trees the shade under their crowns.
   */
  readonly sunShadows: boolean;
  /** The rear-view mirror is a picture of the scene (a third walk over it) rather than a strip of chevrons in the warning's colour. */
  readonly mirror: boolean;
  /** Bloom mip levels (0 turns bloom off). */
  readonly bloomLevels: number;
  /** Light shafts and lens flare from the sun. */
  readonly sunShafts: boolean;
  /** Octaves of cloud detail in the sky shader. */
  readonly cloudOctaves: number;
  /** Edge of each face of the environment probe (reflections and ambient light). */
  readonly envSize: number;
  /** Multiplier on scattered ground detail (grass tufts, pebbles). 0 = none. */
  readonly groundDetail: number;
  /** Texture anisotropy cap. */
  readonly anisotropy: number;
  /** Procedural detail normal maps on road and ground. */
  readonly detailNormals: boolean;
  /** Multiplier on particle counts. */
  readonly particles: number;
}

const TIERS: Readonly<Record<GfxTier, GfxQuality>> = {
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    minResolutionScale: 0.6,
    msaa: 4,
    shadowMapSize: 4096,
    shadowHalfExtent: 52,
    softShadows: true,
    sunShadows: true,
    mirror: true,
    bloomLevels: 5,
    sunShafts: true,
    cloudOctaves: 5,
    envSize: 256,
    groundDetail: 1,
    anisotropy: 16,
    detailNormals: true,
    particles: 1,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.75,
    minResolutionScale: 0.55,
    msaa: 2,
    shadowMapSize: 2048,
    shadowHalfExtent: 34,
    softShadows: true,
    sunShadows: true,
    mirror: true,
    bloomLevels: 4,
    sunShafts: true,
    cloudOctaves: 4,
    envSize: 128,
    groundDetail: 0.55,
    anisotropy: 8,
    detailNormals: true,
    particles: 0.8,
  },
  low: {
    tier: 'low',
    pixelRatioCap: 1.5,
    minResolutionScale: 0.5,
    msaa: 0,
    shadowMapSize: 1024,
    shadowHalfExtent: 24,
    softShadows: false,
    sunShadows: false,
    mirror: false,
    bloomLevels: 3,
    sunShafts: false,
    cloudOctaves: 3,
    envSize: 64,
    groundDetail: 0,
    anisotropy: 4,
    detailNormals: false,
    particles: 0.6,
  },
};

export const GFX_SETTING_KEY = 'tkr.gfx';

function isTier(v: unknown): v is GfxTier {
  return v === 'low' || v === 'medium' || v === 'high';
}

/** What the player (or a URL) asked for, if anything. */
export function requestedTier(): GfxTier | null {
  try {
    const q = new URLSearchParams(location.search).get('gfx');
    if (isTier(q)) return q;
    const saved = localStorage.getItem(GFX_SETTING_KEY);
    if (isTier(saved)) return saved;
  } catch {
    /* no location / storage (tests) */
  }
  return null;
}

let knownGpu: string | null = null;

function readGpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? '').toLowerCase();
}

/**
 * Hands the quality module the game's own WebGL context to read the driver's name from, so
 * detection does not have to open (and throw away) a second one. Call before the first `quality()`.
 */
export function initQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  try {
    knownGpu = readGpuName(gl);
  } catch {
    knownGpu = '';
  }
}

/** What the graphics driver calls itself, lower-cased ('' when the browser will not say). */
function gpuName(): string {
  if (knownGpu !== null) return knownGpu;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return '';
    const name = readGpuName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** A GPU's name → the tier it can carry, or null when the name says nothing useful. */
export function tierForGpu(name: string): GfxTier | null {
  if (!name) return null;
  // Software rendering: everything costs CPU.
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
  // Discrete cards and Apple silicon.
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\b|apple m\d|apple gpu/.test(name)) return 'high';
  // Integrated graphics on laptops and office desktops.
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega/.test(name)) return 'medium';
  // Phone GPUs by generation: recent flagships carry medium, the rest low.
  if (/adreno \(tm\) (7|8)\d\d|adreno (7|8)\d\d|mali-g7[1-9]|mali-g[6-9]1\d|immortalis|apple a1[5-9]|xclipse/.test(name)) return 'medium';
  if (/adreno|mali|powervr/.test(name)) return 'low';
  return null;
}

/** What is known about a device before it has drawn a frame. */
export interface DeviceFacts {
  /** The graphics driver's name, lower-cased ('' when the browser will not say). */
  gpu: string;
  /** Logical cores and gigabytes of memory as the browser reports them (it rounds memory down, and caps it at 8). */
  cores: number;
  memory: number;
  /** A phone or tablet: touch is the only pointer. */
  touchFirst: boolean;
  userAgent: string;
}

/**
 * The tier for a device, from what it says about itself.
 *
 * The GPU's name is the best single clue but not the whole machine: the frame is bound by the
 * CPU on anything slow (the scene is a few hundred draw calls whatever the resolution), and an
 * integrated GPU sits in a fast laptop and in a two-core Chromebook alike. So a weak machine
 * round a middling GPU goes down a tier, and a Chromebook goes to the bottom unless its GPU is a
 * discrete one — the portal this is published on switches a game off for Chrome OS when it does
 * not run smoothly on a 4 GB device.
 */
export function tierFor(facts: DeviceFacts): GfxTier {
  const byGpu = tierForGpu(facts.gpu);
  const { cores, memory } = facts;
  if (facts.touchFirst) {
    // A phone or tablet never gets `high`: its screen is small and its battery is not.
    if (byGpu === 'low' || cores <= 4 || memory <= 3) return 'low';
    return 'medium';
  }
  const chromeOs = /\bCrOS\b/.test(facts.userAgent);
  if (chromeOs && byGpu !== 'high') return 'low';
  if (byGpu === 'low') return 'low';
  if (byGpu === 'medium') return cores <= 4 && memory <= 4 ? 'low' : 'medium';
  if (byGpu === 'high') return cores <= 2 || memory <= 2 ? 'medium' : 'high';
  // The driver will not say: go by the machine around it.
  if (cores <= 2 || memory <= 2) return 'low';
  if (cores <= 4 && memory <= 4) return 'medium';
  return 'high';
}

export const GFX_LEARNED_KEY = 'tkr.gfx.learned';

/**
 * What an earlier session on this device found out the hard way: a race that would not hold its
 * frame rate at the lowest resolution. Never above what detection says; never used when the
 * player has chosen a tier themselves.
 */
function learnedTier(): GfxTier | null {
  try {
    const saved = localStorage.getItem(GFX_LEARNED_KEY);
    return isTier(saved) ? saved : null;
  } catch {
    return null;
  }
}

const ORDER: readonly GfxTier[] = ['low', 'medium', 'high'];

/**
 * Called when a race could not hold its frame rate even with the resolution at its floor: the
 * next race starts one tier lower, on this visit and on later ones. Returns the tier now
 * remembered, or null when there was nothing to step down to or the player picked their own.
 */
export function stepDownForNextRace(): GfxTier | null {
  if (requestedTier()) return null;
  const now = quality().tier;
  const i = ORDER.indexOf(now);
  if (i <= 0) return null;
  const next = ORDER[i - 1];
  try {
    localStorage.setItem(GFX_LEARNED_KEY, next);
  } catch {
    /* storage unavailable: the step still holds for this visit */
  }
  current = TIERS[next];
  return next;
}

/** The tier this device gets when nobody asked for one. */
export function detectTier(): GfxTier {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'high';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const detected = tierFor({
    gpu: gpuName(),
    cores: nav.hardwareConcurrency ?? 8,
    memory: nav.deviceMemory ?? 8,
    touchFirst: Boolean(window.matchMedia?.('(pointer: coarse)').matches) && !window.matchMedia?.('(any-pointer: fine)').matches,
    userAgent: nav.userAgent ?? '',
  });
  const learned = learnedTier();
  return learned && ORDER.indexOf(learned) < ORDER.indexOf(detected) ? learned : detected;
}

let current: GfxQuality | null = null;

/** The quality in force. Decided on first use; `setTier` replaces it (takes effect on the next race). */
export function quality(): GfxQuality {
  if (!current) current = TIERS[requestedTier() ?? detectTier()];
  return current;
}

export function setTier(tier: GfxTier | 'auto'): GfxQuality {
  try {
    if (tier === 'auto') localStorage.removeItem(GFX_SETTING_KEY);
    else localStorage.setItem(GFX_SETTING_KEY, tier);
  } catch {
    /* storage unavailable */
  }
  current = TIERS[tier === 'auto' ? detectTier() : tier];
  return current;
}

export function qualityFor(tier: GfxTier): GfxQuality {
  return TIERS[tier];
}
