/**
 * Livery patterns as an object-space shader patch.
 *
 * The procedural chassis has no UV layout at all: `profileChassis` writes a zero-filled uv
 * attribute, so an image texture would sample a single texel. Instead every pattern is an
 * analytic function of the kart's own object-space position, which means it works on all eight
 * bodies with no unwrapping, costs no texture memory, is resolution independent, and adding a
 * pattern is a few lines of GLSL.
 *
 * Kart object space: x is width, roughly -0.6..0.6. y is height, 0 at the ground. z runs
 * -1 at the nose to +1 at the tail.
 *
 * One shared program: the pattern id is a uniform, not a define, so eight karts wearing eight
 * different liveries still compile once and never re-link when the garage changes a selection.
 */
import * as THREE from 'three';
import { PATTERNS, type PatternId } from '../core/cosmetics';

/** Pattern id → shader branch index, in catalogue order. */
const INDEX: Readonly<Record<string, number>> = Object.fromEntries(PATTERNS.map((p, i) => [p.id, i]));

/** Shared by every patterned material so animated liveries advance with one write per frame. */
const timeUniform = { value: 0 };

export function tickPatternTime(dt: number): void {
  timeUniform.value = (timeUniform.value + dt) % 3600;
}

const COMMON = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vObjNrm;
`;

const VERTEX_HOOK = /* glsl */ `
  vObjPos = position;
  vObjNrm = normal;
`;

/** 0..1 coverage mask per pattern, plus an optional hue shift for the iridescent family. */
const FRAGMENT_LIB = /* glsl */ `
uniform int uPattern;
uniform vec3 uPatternColor;
uniform float uPatternTime;

float ddHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float ddNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = ddHash(i), b = ddHash(i + vec2(1.0, 0.0));
  float c = ddHash(i + vec2(0.0, 1.0)), d = ddHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float ddBand(float v, float half_) { return 1.0 - step(half_, abs(v)); }
float ddChecker(vec2 p) { return mod(floor(p.x) + floor(p.y), 2.0); }
float ddLines(float v, float period, float width) { return 1.0 - step(width, abs(fract(v * period) - 0.5)); }
vec3 ddHue(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

float ddMask(int id, vec3 p, vec3 n, float t) {
  float x = p.x, y = p.y, z = p.z, ax = abs(x);
  if (id == ${INDEX.stripe}) return ddBand(x, 0.09);
  if (id == ${INDEX.twinStripe}) return step(0.10, ax) * (1.0 - step(0.20, ax));
  if (id == ${INDEX.offsetStripe}) return step(0.05, x) * (1.0 - step(0.21, x));
  if (id == ${INDEX.pinstripe}) return ddLines(x, 11.0, 0.09);
  if (id == ${INDEX.wideBand}) return ddBand(x, 0.28);
  if (id == ${INDEX.rally}) return ddBand(z - (y * 1.9 - 0.95), 0.20);
  if (id == ${INDEX.numberPanel}) return 1.0 - step(0.27, length(vec2(z * 0.95, (y - 0.30) * 1.7)));
  if (id == ${INDEX.chevron}) return ddBand(fract(z * 1.7 + ax * 1.5) - 0.5, 0.16);
  if (id == ${INDEX.arrow}) {
    float head = step(-0.10, -z) * (1.0 - step(max(0.0, z + 1.05) * 0.62, ax));
    float shaft = step(-0.15, z) * ddBand(x, 0.11);
    return max(head, shaft);
  }
  if (id == ${INDEX.dagger}) return 1.0 - step(0.34 * max(0.0, 1.0 - (z + 1.05) * 0.46), ax);
  if (id == ${INDEX.checker}) return ddChecker(vec2(x, z) * 7.0);
  if (id == ${INDEX.halfChecker}) return step(0.0, z) * ddChecker(vec2(x, z) * 7.0);
  if (id == ${INDEX.diamond}) return ddChecker(vec2(x + z, x - z) * 5.0);
  if (id == ${INDEX.hexMesh}) {
    vec2 h = vec2(x * 6.0, z * 5.2 + step(1.0, mod(floor(x * 6.0), 2.0)) * 0.5);
    return max(ddLines(h.x, 1.0, 0.07), ddLines(h.y, 1.0, 0.07));
  }
  if (id == ${INDEX.circuit}) {
    float g = max(ddLines(x, 5.0, 0.05), ddLines(z, 4.0, 0.05));
    float pads = 1.0 - step(0.12, length(fract(vec2(x * 5.0, z * 4.0)) - 0.5));
    return max(g, pads);
  }
  if (id == ${INDEX.grid}) return max(ddLines(x, 8.0, 0.04), ddLines(z, 6.0, 0.04));
  if (id == ${INDEX.camo}) {
    float v = ddNoise(vec2(x, z) * 4.0) * 0.6 + ddNoise(vec2(x, z) * 9.0) * 0.4;
    return step(0.52, v);
  }
  if (id == ${INDEX.splatter}) return step(0.66, ddNoise(vec2(x, z) * 16.0));
  if (id == ${INDEX.tiger}) return step(0.55, abs(sin(z * 11.0 + ddNoise(vec2(x, z) * 3.0) * 5.0)));
  if (id == ${INDEX.blaze}) {
    float edge = smoothstep(-0.9, 0.5, z);
    return step(edge, ddNoise(vec2(x * 5.0, z * 2.2)) * 0.7 + 0.35);
  }
  if (id == ${INDEX.bolt}) {
    float zig = (abs(fract(z * 1.5) - 0.5) * 4.0 - 1.0) * 0.22;
    return ddBand(x - zig, 0.085);
  }
  if (id == ${INDEX.wave}) return ddBand(y - 0.30 - sin(z * 3.6) * 0.09, 0.055);
  if (id == ${INDEX.twoTone}) return step(0.0, z);
  if (id == ${INDEX.diagonalFade}) return smoothstep(-0.6, 0.7, x * 0.8 + z * 0.7);
  if (id == ${INDEX.topFade}) return smoothstep(0.30, 0.40, y);
  if (id == ${INDEX.chromeSweep}) return ddBand(fract((z * 0.6 + y * 0.9) * 1.6) - 0.5, 0.13);
  if (id == ${INDEX.iridescent}) return 1.0;
  if (id == ${INDEX.carbon}) {
    float a = ddChecker(vec2(x, z) * 46.0);
    float b = ddLines(x + z, 46.0, 0.22);
    return clamp(a * 0.55 + b * 0.45, 0.0, 1.0);
  }
  if (id == ${INDEX.holo}) return 1.0;
  if (id == ${INDEX.starfield}) {
    vec2 g = vec2(x, z) * 11.0;
    float s = ddHash(floor(g));
    float size = 0.14 + s * 0.22;
    return step(0.55, s) * (1.0 - step(size, length(fract(g) - 0.5)));
  }
  if (id == ${INDEX.glitch}) {
    float row = floor(z * 14.0 + t * 3.0);
    float jitter = ddHash(vec2(row, 3.0));
    return step(0.72, jitter) * step(0.35, ddHash(vec2(floor(x * 9.0 + jitter * 6.0), row)));
  }
  if (id == ${INDEX.wireframe}) {
    float g = max(max(ddLines(x, 7.0, 0.035), ddLines(z, 5.0, 0.035)), ddLines(y, 6.0, 0.035));
    return g;
  }
  return 0.0;
}

vec3 ddTint(int id, vec3 base, vec3 p, vec3 n, float t) {
  if (id == ${INDEX.iridescent}) return ddHue(n.y * 0.5 + p.z * 0.35 + 0.2);
  if (id == ${INDEX.holo}) return ddHue(p.z * 0.7 + t * 0.25);
  return base;
}
`;

const FRAGMENT_HOOK = /* glsl */ `
  if (uPattern != 0) {
    float m = ddMask(uPattern, vObjPos, normalize(vObjNrm), uPatternTime);
    vec3 tint = ddTint(uPattern, uPatternColor, vObjPos, normalize(vObjNrm), uPatternTime);
    diffuseColor.rgb = mix(diffuseColor.rgb, tint, clamp(m, 0.0, 1.0));
  }
`;

export interface PatternHandles {
  setPattern(id: PatternId | undefined): void;
  setColor(hex: number | undefined): void;
}

/**
 * Patches a standard-lit material so it can wear a livery. Safe to call once per material;
 * the returned handles change the look without recompiling.
 */
export function attachPatternShader(material: THREE.Material, defaultColor: number): PatternHandles {
  const uPattern = { value: 0 };
  const uPatternColor = { value: new THREE.Color(defaultColor) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPattern = uPattern;
    shader.uniforms.uPatternColor = uPatternColor;
    shader.uniforms.uPatternTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${COMMON}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_HOOK}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${COMMON}\n${FRAGMENT_LIB}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_HOOK}`);
  };
  // Every patterned body shares one program: same source, no per-pattern defines.
  material.customProgramCacheKey = () => 'kart-livery';
  return {
    setPattern(id) {
      uPattern.value = id ? (INDEX[id] ?? 0) : 0;
    },
    setColor(hex) {
      uPatternColor.value.setHex(hex ?? defaultColor);
    },
  };
}
