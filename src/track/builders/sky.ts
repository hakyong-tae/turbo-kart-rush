import * as THREE from 'three';
import type { EnvironmentDef, TrackTheme } from '../../core/types';
import type { BuildContext } from './context';
import { trackMesh } from './context';
import { noiseTexture } from '../../gfx/noise';
import { quality } from '../../gfx/quality';

export const SKY_RADIUS = 1500;
/** Name of the dome mesh; `userData.sky` on it carries the handles the renderer needs. */
export const SKY_DOME_NAME = 'skyDome';

/** What the rest of the renderer may read or change on a built sky. */
export interface SkyHandles {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  /** 0..1: how strongly the sun shows as shafts and flare (0 at night). */
  sunPresence: number;
  /** The disc is switched off while the environment probe looks at the sky (the sun light already makes the highlight). */
  setSunDisc(on: boolean): void;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  // Direction only: the dome is drawn as if centred on the camera, so the sky has no parallax
  // and the probe camera sees the same sky as the race camera.
  vDir = normalize(mat3(modelMatrix) * position);
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * vDir, 1.0);
  clip.z = clip.w * 0.999999;
  gl_Position = clip;
}
`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uHaze;
uniform float uHazeAmount;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uSunGlow;
uniform float uSunDisc;
uniform float uNight;
uniform float uStars;
uniform vec3 uNebula;
uniform float uCloudCover;
uniform float uCloudSoft;
uniform float uCloudScale;
uniform float uCloudAlpha;
uniform vec2 uWind;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCirrus;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float cloudDensity(vec2 uv) {
  float base = texture2D(uNoise, uv * 0.3).r;
  float puff = texture2D(uNoise, uv * 0.83 + vec2(base * 0.11, 0.0)).b;
  float d = base * 0.66 + puff * 0.34;
#if CLOUD_OCTAVES >= 4
  d += (texture2D(uNoise, uv * 2.3 + 0.37).g - 0.5) * 0.11;
#endif
#if CLOUD_OCTAVES >= 5
  d += (texture2D(uNoise, uv * 5.9 + 0.11).a - 0.5) * 0.05;
#endif
  return d;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  float sd = dot(d, uSunDir);
  float sdc = max(sd, 0.0);

  // ---- gradient ------------------------------------------------------------
  vec3 col = mix(uHorizon, uTop, pow(up, 0.48));
  if (y < 0.0) col = mix(uHorizon, uBottom, pow(clamp(-y, 0.0, 1.0), 0.6));
  // The air is brighter and warmer around the sun, most of all low down.
  float band = exp(-abs(y) * 5.0);
  col += uSunColor * uSunGlow * (pow(sdc, 12.0) * 0.22 + pow(sdc, 3.0) * 0.07) * (0.3 + band);
  col += uHorizon * band * 0.12;

  // ---- night: stars, a band of nebula --------------------------------------
  if (uStars > 0.001) {
    vec2 sph = vec2(atan(d.z, d.x), asin(clamp(y, -1.0, 1.0)));
    // No stars through the glare round the sun, or low down where the air is bright.
    float seen = smoothstep(0.02, 0.3, y) * (1.0 - smoothstep(0.55, 0.98, sd) * step(uNight, 0.5));
    for (int layer = 0; layer < 2; layer++) {
      float density = layer == 0 ? 70.0 : 150.0;
      vec2 g = sph * density;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float h = hash(cell + float(layer) * 31.0);
      float h2 = hash(cell + 17.0);
      vec2 sp = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.7 + 0.15;
      float dist = length(f - sp);
      float size = layer == 0 ? 0.11 : 0.07;
      float star = smoothstep(size, 0.0, dist) * step(layer == 0 ? 0.8 : 0.72, h) * (0.35 + 0.65 * h2);
      star *= 0.72 + 0.28 * sin(uTime * (1.5 + h2 * 4.0) + h * 40.0);
      vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.72, 0.84, 1.0), h2);
      col += tint * star * seen * (layer == 0 ? 2.4 : 1.1) * uStars;
    }
    float neb = texture2D(uNoise, d.xz * 0.35 / (abs(y) + 0.45) + 0.2).r;
    float neb2 = texture2D(uNoise, d.zx * 0.9 / (abs(y) + 0.45)).g;
    float cloud = smoothstep(0.48, 0.86, neb * 0.7 + neb2 * 0.3) * seen;
    col += uNebula * cloud * 0.55 * uStars;
  }

  // ---- clouds: a flat layer far overhead, curved down toward the horizon ----
  float cover = 0.0;
  if (uCloudAlpha > 0.001 && y > -0.03) {
    float h = max(y, 0.0) + 0.085;
    vec2 uv = d.xz / h * uCloudScale + uWind * uTime;
    float fade = smoothstep(-0.01, 0.1, y);

    if (uCirrus > 0.001) {
      // High, thin streaks: the same noise stretched along the wind.
      vec2 cu = uv * 0.6 + uWind * uTime * 0.4;
      float streak = texture2D(uNoise, vec2(cu.x * 0.035, cu.y * 0.21) + 0.5).g;
      float wisp = texture2D(uNoise, vec2(cu.x * 0.09, cu.y * 0.5)).r;
      float ci = smoothstep(0.5, 0.86, streak * 0.7 + wisp * 0.3) * uCirrus * fade;
      col = mix(col, mix(uCloudLit, uHorizon, 0.35), ci * 0.5);
    }

    float thr = 1.0 - uCloudCover;
    float dens = cloudDensity(uv);
    float a = smoothstep(thr, thr + uCloudSoft, dens);
    if (a > 0.002) {
      float thick = smoothstep(thr, thr + 0.3, dens);
#if CLOUD_OCTAVES >= 4
      // A second reading a step toward the sun: where the cloud thins that way, the sun is on it.
      vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.18;
      float lit = clamp((dens - cloudDensity(uv + toSun)) * 3.4 + 0.55, 0.0, 1.0);
#else
      float lit = 1.0 - thick * 0.6;
#endif
      float light = clamp(lit * 0.75 + (1.0 - thick) * 0.45, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, light);
      // Thin edges in front of the sun burn bright.
      cc += uSunColor * uSunGlow * pow(sdc, 9.0) * (1.0 - thick) * 0.85;
      // Far clouds sink into the haze.
      cc = mix(uHaze, cc, 0.25 + 0.75 * smoothstep(0.0, 0.22, y));
      cover = a * fade * uCloudAlpha;
      col = mix(col, cc, cover);
    }
  }

  // ---- sun or moon ---------------------------------------------------------
  float disc = smoothstep(uSunSize - 0.0012, uSunSize + 0.0004, sd);
  float seenSun = 1.0 - cover * 0.92;
  col += uSunColor * disc * (3.2 - uNight * 2.0) * uSunDisc * seenSun;
  col += uSunColor * pow(sdc, 180.0) * 0.9 * uSunGlow * uSunDisc * (1.0 - cover * 0.6);
  col += uSunColor * pow(sdc, 28.0) * 0.22 * uSunGlow * (1.0 - cover * 0.5);

  // ---- haze: the horizon meets the distance fog ----------------------------
  float haze = uHazeAmount * exp(-max(y, 0.0) * 13.0);
  col = mix(col, uHaze, clamp(haze, 0.0, 1.0));
  if (y < 0.0) col = mix(uHaze, col, smoothstep(0.0, -0.35, y) * (1.0 - uHazeAmount * 0.5));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface SkyLook {
  cover: number;
  soft: number;
  scale: number;
  alpha: number;
  cirrus: number;
  wind: [number, number];
  /** Brightness of the sun-lit cloud tops, and how much of the sun's colour they take. */
  litGain: number;
  litWarmth: number;
  /** How dark the bases go (0 = as bright as the tops). */
  shadeDepth: number;
  haze: number;
  sunDeg: number;
  sunGlow: number;
}

const LOOKS: Readonly<Record<TrackTheme, SkyLook>> = {
  grassland: { cover: 0.47, soft: 0.07, scale: 1.0, alpha: 1, cirrus: 0.35, wind: [0.006, 0.002], litGain: 1.25, litWarmth: 0.25, shadeDepth: 0.42, haze: 0.75, sunDeg: 2.4, sunGlow: 1.0 },
  beach: { cover: 0.41, soft: 0.08, scale: 0.85, alpha: 1, cirrus: 0.6, wind: [0.008, 0.003], litGain: 1.3, litWarmth: 0.2, shadeDepth: 0.34, haze: 0.8, sunDeg: 2.6, sunGlow: 1.1 },
  desert: { cover: 0.36, soft: 0.12, scale: 0.75, alpha: 0.85, cirrus: 0.8, wind: [0.004, 0.001], litGain: 1.2, litWarmth: 0.55, shadeDepth: 0.3, haze: 0.85, sunDeg: 4.0, sunGlow: 1.6 },
  volcano: { cover: 0.56, soft: 0.1, scale: 1.1, alpha: 0.95, cirrus: 0.3, wind: [0.01, 0.004], litGain: 1.5, litWarmth: 0.9, shadeDepth: 0.78, haze: 0.8, sunDeg: 4.2, sunGlow: 1.7 },
  snow: { cover: 0.5, soft: 0.14, scale: 0.9, alpha: 0.9, cirrus: 0.7, wind: [0.007, 0.002], litGain: 1.2, litWarmth: 0.15, shadeDepth: 0.26, haze: 0.9, sunDeg: 2.4, sunGlow: 1.2 },
  neon: { cover: 0.44, soft: 0.16, scale: 1.2, alpha: 0.8, cirrus: 0, wind: [0.009, 0.004], litGain: 0.5, litWarmth: 0, shadeDepth: 0.85, haze: 0.7, sunDeg: 1.7, sunGlow: 0.6 },
};

/** After dark: the light in the sky is a moon, not a sun (neon cities, the glacier at night). */
export function isNightSky(env: EnvironmentDef): boolean {
  return env.sunIntensity <= 1.55;
}

/** 0..1: how many stars the zenith is dark enough to show. A sunset with a black zenith has them too. */
export function starAmount(env: EnvironmentDef): number {
  const top = new THREE.Color(env.skyTop);
  const lum = top.r * 0.2126 + top.g * 0.7152 + top.b * 0.0722;
  return THREE.MathUtils.clamp((0.03 - lum) / 0.022, 0, 1);
}

/**
 * Sky dome: gradient, sun or moon, drifting clouds lit from the sun's side, stars at night.
 * Drawn behind everything solid and never fogged; its horizon is blended into the fog colour so
 * distant ground and sky meet without a seam.
 */
export function buildSky(ctx: BuildContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sky';
  const env = ctx.def.environment;
  const theme = ctx.def.theme;
  const look = LOOKS[theme] ?? LOOKS.grassland;
  const night = isNightSky(env);
  const q = quality();

  const sunDir = new THREE.Vector3(env.sunDirection.x, env.sunDirection.y, env.sunDirection.z);
  if (sunDir.lengthSq() < 1e-6) sunDir.set(0.4, 0.8, 0.3);
  if (sunDir.y < 0) sunDir.y = -sunDir.y;
  sunDir.normalize();

  const sun = new THREE.Color(env.sunColor);
  const top = new THREE.Color(env.skyTop);
  const horizon = new THREE.Color(env.skyHorizon);
  const haze = new THREE.Color(env.fogColor);
  // Cloud colours come from the circuit's own light, so all sixteen skies match their ground.
  const lit = night
    ? horizon.clone().lerp(new THREE.Color(0xffffff), 0.15).multiplyScalar(look.litGain)
    : new THREE.Color(0xffffff).lerp(sun, look.litWarmth).multiplyScalar(look.litGain);
  const shade = night
    ? top.clone().lerp(horizon, 0.12).multiplyScalar(0.6)
    : horizon.clone().lerp(top, 0.45).lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(1 - look.shadeDepth);
  const nebula = horizon.clone().lerp(new THREE.Color(0x2a6bff), 0.35);

  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = new THREE.ShaderMaterial({
    defines: { CLOUD_OCTAVES: q.cloudOctaves },
    uniforms: {
      uNoise: { value: noiseTexture() },
      uTime: ctx.timeUniform,
      uTop: { value: top },
      uHorizon: { value: horizon },
      uBottom: { value: new THREE.Color(env.skyBottom) },
      uHaze: { value: haze },
      uHazeAmount: { value: env.fogDensity > 0 ? look.haze : 0 },
      uSunDir: { value: sunDir },
      uSunColor: { value: sun },
      uSunSize: { value: Math.cos(THREE.MathUtils.degToRad(look.sunDeg)) },
      uSunGlow: { value: look.sunGlow },
      uSunDisc: { value: 1 },
      uNight: { value: night ? 1 : 0 },
      uStars: { value: starAmount(env) },
      uNebula: { value: nebula },
      uCloudCover: { value: look.cover },
      uCloudSoft: { value: look.soft },
      uCloudScale: { value: look.scale },
      uCloudAlpha: { value: look.alpha },
      uWind: { value: new THREE.Vector2(look.wind[0], look.wind[1]) },
      uCloudLit: { value: lit },
      uCloudShade: { value: shade },
      uCirrus: { value: look.cirrus },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    // Drawn after everything solid and tested against it: the clouds are only worked out for
    // the pixels of sky that are actually seen, which on most frames is under half the screen.
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = 1000;
  dome.frustumCulled = false;
  dome.name = SKY_DOME_NAME;
  const handles: SkyHandles = {
    sunDirection: sunDir.clone(),
    sunColor: sun.clone(),
    sunPresence: night ? 0 : Math.min(1, look.sunGlow),
    setSunDisc: (on) => {
      mat.uniforms.uSunDisc.value = on ? 1 : 0;
    },
  };
  dome.userData.sky = handles;
  trackMesh(ctx, dome);
  group.add(dome);
  return group;
}

/** The handles of the sky in a scene, if a race has built one. */
export function findSky(root: THREE.Object3D): SkyHandles | null {
  const dome = root.getObjectByName(SKY_DOME_NAME);
  return (dome?.userData.sky as SkyHandles | undefined) ?? null;
}
