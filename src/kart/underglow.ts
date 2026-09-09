/**
 * Underglow: the light pool a kart casts on the road.
 *
 * One additive quad lying flat under the chassis, shaded analytically. No texture, no light, no
 * extra draw state per style: the six looks are branches on a single uniform, so switching one in
 * the garage is a uniform write and every kart on the grid shares one program.
 *
 * The quad hangs off the kart's ground object rather than the visual body, so it follows the
 * chassis over the road surface without inheriting drift roll or the squash-and-stretch spring:
 * a glow that banks and squashes reads as a floating card, not as light on tarmac.
 */
import * as THREE from 'three';
import { UNDERGLOWS, type UnderglowId } from '../core/cosmetics';
import { cosmeticTime } from './patternShader';

/** Style id → shader branch, in catalogue order. `none` is 0 and skips the draw entirely. */
const INDEX: Readonly<Record<string, number>> = Object.fromEntries(UNDERGLOWS.map((e, i) => [e.id, i]));

/** Footprint of the pool in metres; wider than the kart so the spill is visible from the seat. */
const WIDTH = 2.6;
const LENGTH = 3.6;
/** Just above the road, below the chassis. High enough to beat z-fighting on sloped track. */
const HEIGHT = 0.035;

const VERTEX = /* glsl */ `
varying vec2 vUvPos;
void main() {
  vUvPos = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform int uStyle;
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
varying vec2 vUvPos;

vec3 hue(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

void main() {
  // Rounded-rectangle field: bright under the floor pan, falling off past the sills.
  vec2 q = abs(vUvPos);
  float d = length(max(q - vec2(0.34, 0.46), 0.0));
  float pool = 1.0 - smoothstep(0.0, 0.62, d);
  pool *= pool;

  float amp = 1.0;
  vec3 tint = uColor;
  if (uStyle == ${INDEX.pulse}) {
    // Sawtooth throb: fast attack, slow decay, like a bass hit.
    float p = fract(uTime * 1.6);
    amp = 0.35 + 0.65 * pow(1.0 - p, 2.2);
  } else if (uStyle == ${INDEX.breathe}) {
    amp = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.5));
  } else if (uStyle == ${INDEX.strobe}) {
    amp = step(0.5, fract(uTime * 5.0)) * 1.15;
  } else if (uStyle == ${INDEX.rainbow}) {
    tint = hue(uTime * 0.25 + vUvPos.y * 0.15);
  } else if (uStyle == ${INDEX.ripple}) {
    // Rings running outward from under the seat.
    float r = length(vUvPos * vec2(1.0, 0.78));
    amp = 0.5 + 0.5 * sin(r * 9.0 - uTime * 4.5);
    amp = 0.35 + 0.85 * amp;
  }

  float a = pool * amp * uStrength;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

export interface UnderglowHandles {
  /** Flat quad to parent under the kart root. */
  readonly mesh: THREE.Mesh;
  setStyle(id: UnderglowId | undefined): void;
  setColor(hex: number | undefined): void;
  /** 0..1 master fade. Dims as the kart leaves the road, since light needs something to land on. */
  setStrength(v: number): void;
}

/**
 * Builds one underglow quad. `track`/`mat` hand ownership to the caller's dispose set, matching
 * the rest of the kart model.
 */
export function createUnderglow(
  track: <T extends THREE.BufferGeometry>(g: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
  defaultColor: number,
): UnderglowHandles {
  const uStyle = { value: 0 };
  const uColor = { value: new THREE.Color(defaultColor) };
  const uStrength = { value: 1 };
  const material = mat(
    new THREE.ShaderMaterial({
      uniforms: { uStyle, uColor, uTime: cosmeticTime, uStrength },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(WIDTH, LENGTH)), material);
  mesh.name = 'underglow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = HEIGHT;
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;

  return {
    mesh,
    setStyle(id) {
      const i = id ? (INDEX[id] ?? 0) : 0;
      uStyle.value = i;
      mesh.visible = i !== 0;
    },
    setColor(hex) {
      uColor.value.setHex(hex ?? defaultColor);
    },
    setStrength(v) {
      uStrength.value = v;
    },
  };
}
