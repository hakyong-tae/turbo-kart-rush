import * as THREE from 'three';
import type { BuildContext } from './context';
import { trackMesh } from './context';
import { detailNormalTexture, noiseTexture } from '../../gfx/noise';
import { quality } from '../../gfx/quality';

/** How far the sea reaches from the middle of the circuit: to the camera's far plane. */
const SEA_RADIUS = 2300;
/** The depth map: a square this wide round the middle of the circuit, this many texels across. */
const DEPTH_SPAN = 1640;
const DEPTH_SIZE = 256;
/** Depths the map can hold, in metres (negative = dry land above the water). */
const DEPTH_MIN = -2;
const DEPTH_MAX = 14;

/**
 * The sea round a beach circuit.
 *
 * One flat disc at sea level, finely divided near the island and coarsely toward the horizon.
 * Each vertex knows how deep the water under it is; from that the shader shades shallows
 * turquoise over the sand and deep water blue, and draws a band of foam lapping at the shore.
 * The surface itself is a standard material — it takes the sun's glitter, the sky's reflection
 * and the distance haze from the same lights as everything else — with two layers of chop
 * sliding across each other for its normal.
 */
export function buildSea(ctx: BuildContext): THREE.Mesh | null {
  const { field, def } = ctx;
  const level = field.seaLevel;
  if (level === null) return null;
  const env = def.environment;
  const high = quality().tier === 'high';
  const spokes = high ? 144 : 96;
  const rings = high ? 84 : 56;

  // How deep the water is, looked up per pixel: a vertex every dozen metres is too coarse to
  // draw a shoreline. Beyond the map the sea is simply deep.
  const depthData = new Uint8Array(DEPTH_SIZE * DEPTH_SIZE);
  for (let j = 0; j < DEPTH_SIZE; j++) {
    const z = field.centerZ - DEPTH_SPAN / 2 + ((j + 0.5) / DEPTH_SIZE) * DEPTH_SPAN;
    for (let i = 0; i < DEPTH_SIZE; i++) {
      const x = field.centerX - DEPTH_SPAN / 2 + ((i + 0.5) / DEPTH_SIZE) * DEPTH_SPAN;
      const d = level - field.heightAt(x, z);
      depthData[j * DEPTH_SIZE + i] = Math.round(THREE.MathUtils.clamp((d - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN), 0, 1) * 255);
    }
  }
  const depthMap = new THREE.DataTexture(depthData, DEPTH_SIZE, DEPTH_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  depthMap.magFilter = THREE.LinearFilter;
  depthMap.minFilter = THREE.LinearFilter;
  depthMap.wrapS = THREE.ClampToEdgeWrapping;
  depthMap.wrapT = THREE.ClampToEdgeWrapping;
  depthMap.colorSpace = THREE.NoColorSpace;
  depthMap.needsUpdate = true;
  ctx.disposables.push(depthMap);

  const verts = new Float32Array((rings + 1) * spokes * 3);
  const uvs = new Float32Array((rings + 1) * spokes * 2);
  for (let k = 0; k <= rings; k++) {
    // Rings crowd toward the island, where the shoreline needs them.
    const r = SEA_RADIUS * Math.pow(k / rings, 1.8);
    for (let a = 0; a < spokes; a++) {
      const ang = (a / spokes) * Math.PI * 2 + (k % 2) * (Math.PI / spokes);
      const x = field.centerX + Math.cos(ang) * r;
      const z = field.centerZ + Math.sin(ang) * r;
      const i = k * spokes + a;
      verts[i * 3] = x;
      verts[i * 3 + 1] = level;
      verts[i * 3 + 2] = z;
      uvs[i * 2] = x / 26;
      uvs[i * 2 + 1] = z / 26;
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < rings; k++) {
    for (let a = 0; a < spokes; a++) {
      const a1 = (a + 1) % spokes;
      const p0 = k * spokes + a;
      const p1 = k * spokes + a1;
      const q0 = (k + 1) * spokes + a;
      const q1 = (k + 1) * spokes + a1;
      // Seen from above: counter-clockwise, so the face looks up.
      idx.push(p0, q0, p1, p1, q0, q1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const normals = new Float32Array(verts.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.computeBoundingSphere();

  // The water takes a little of the hour's colour: a sunset sea is not a noon sea.
  const horizon = new THREE.Color(env.skyHorizon);
  const zenith = new THREE.Color(env.skyTop);
  const shallow = new THREE.Color(0x45ecd9).lerp(horizon, 0.12);
  const deep = new THREE.Color(0x1389dc).lerp(zenith, 0.22);
  const foam = new THREE.Color(0xffffff).lerp(new THREE.Color(env.sunColor), 0.25);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0,
    envMapIntensity: 0.9,
    normalMap: detailNormalTexture('water'),
    normalScale: new THREE.Vector2(0.3, 0.3),
    side: THREE.DoubleSide,
  });
  const time = ctx.timeUniform;
  const noise = noiseTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGfxTime = time;
    shader.uniforms.uGfxNoise = { value: noise };
    shader.uniforms.uGfxShallow = { value: shallow };
    shader.uniforms.uGfxDeep = { value: deep };
    shader.uniforms.uGfxFoam = { value: foam };
    shader.uniforms.uGfxDepthMap = { value: depthMap };
    shader.uniforms.uGfxDepthOrigin = { value: new THREE.Vector2(field.centerX - DEPTH_SPAN / 2, field.centerZ - DEPTH_SPAN / 2) };
    shader.uniforms.uGfxGlow = { value: 0.34 * Math.min(1.2, env.sunIntensity / 2.6) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGfxWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGfxWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uGfxTime;\nuniform sampler2D uGfxNoise;\nuniform sampler2D uGfxDepthMap;\nuniform vec2 uGfxDepthOrigin;\nuniform float uGfxGlow;\nuniform vec3 uGfxShallow;\nuniform vec3 uGfxDeep;\nuniform vec3 uGfxFoam;\nvarying vec2 vGfxWorld;\nvec3 gfxScatter;',
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  vec2 gfxDuv = ( vGfxWorld - uGfxDepthOrigin ) / ${DEPTH_SPAN.toFixed(1)};
  float gfxInside = step( 0.0, gfxDuv.x ) * step( gfxDuv.x, 1.0 ) * step( 0.0, gfxDuv.y ) * step( gfxDuv.y, 1.0 );
  float gfxRaw = mix( 1.0, texture2D( uGfxDepthMap, gfxDuv ).r, gfxInside );
  float gfxD = max( gfxRaw * ${(14 - -2).toFixed(1)} + ${(-2).toFixed(1)}, 0.0 );
  vec3 gfxWater = mix( uGfxShallow, uGfxDeep, 1.0 - exp( - gfxD * 0.16 ) );
  // Foam: a ragged band at the waterline that breathes in and out, and a second, fainter one behind it.
  float gfxRag = texture2D( uGfxNoise, vNormalMapUv * 1.3 + vec2( uGfxTime * 0.015, - uGfxTime * 0.01 ) ).r;
  float gfxLap = 0.45 + 0.35 * sin( uGfxTime * 0.9 + gfxRag * 6.0 );
  float gfxFoamAmt = smoothstep( gfxLap + 0.55, gfxLap - 0.1, gfxD + ( gfxRag - 0.5 ) * 0.9 );
  float gfxSecond = smoothstep( 0.5, 0.0, abs( gfxD - 1.9 - gfxLap + ( gfxRag - 0.5 ) * 1.4 ) ) * 0.35;
  float gfxWhite = clamp( gfxFoamAmt + gfxSecond, 0.0, 1.0 ) * 0.9;
  diffuseColor.rgb = mix( gfxWater, uGfxFoam, gfxWhite );
  // Light that went into the water and came back out: what makes a lagoon glow turquoise.
  gfxScatter = gfxWater * uGfxGlow * ( 1.0 - gfxWhite );
`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gfxScatter;')
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        /* glsl */ `vec3 mapN = texture2D( normalMap, vNormalMapUv + vec2( uGfxTime * 0.021, uGfxTime * 0.013 ) ).xyz * 2.0 - 1.0;
	vec3 gfxN2 = texture2D( normalMap, vNormalMapUv * 1.73 + vec2( - uGfxTime * 0.017, uGfxTime * 0.026 ) ).xyz * 2.0 - 1.0;
	mapN = normalize( vec3( mapN.xy + gfxN2.xy, mapN.z * gfxN2.z ) );`,
      );
  };
  mat.customProgramCacheKey = () => 'gfx-sea';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sea';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  trackMesh(ctx, mesh);
  return mesh;
}
