/**
 * Contact shadow: the dark patch right under a kart.
 *
 * The sun's shadow map covers a few dozen metres around the player and is too coarse to show a
 * chassis sitting ten centimetres off the road. Without something under it a kart floats; with
 * a soft dark patch it sits. One alpha-blended quad per kart, shaded analytically, on the kart's
 * ground object so it stays flat on the road while the body rolls and squashes above it.
 */
import * as THREE from 'three';

/** Footprint in metres: a little wider and longer than the chassis. */
const WIDTH = 1.75;
const LENGTH = 2.35;
const HEIGHT = 0.03;

const VERTEX = /* glsl */ `
varying vec2 vUvPos;
void main() {
  vUvPos = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec2 vUvPos;
void main() {
  // Darkest under the floor pan and the four wheels, gone by the edge of the quad.
  vec2 q = abs(vUvPos);
  float d = length(max(q - vec2(0.42, 0.5), 0.0));
  float core = 1.0 - smoothstep(0.0, 0.5, d);
  vec2 w = abs(q - vec2(0.6, 0.48));
  float wheels = 1.0 - smoothstep(0.0, 0.3, length(w * vec2(1.0, 0.8)));
  float a = (core * core * 0.62 + wheels * 0.22) * uStrength;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.02, a);
}
`;

export interface ContactShadowHandles {
  readonly mesh: THREE.Mesh;
  /** 0..1: fades out as the kart leaves the ground. */
  setStrength(v: number): void;
}

export function createContactShadow(
  track: <T extends THREE.BufferGeometry>(g: T) => T,
  mat: <T extends THREE.Material>(m: T) => T,
): ContactShadowHandles {
  const uStrength = { value: 1 };
  const material = mat(
    new THREE.ShaderMaterial({
      uniforms: { uStrength },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    }),
  );
  const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(WIDTH, LENGTH)), material);
  mesh.name = 'contactShadow';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = HEIGHT;
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    setStrength(v) {
      uStrength.value = v;
      mesh.visible = v > 0.01;
    },
  };
}
