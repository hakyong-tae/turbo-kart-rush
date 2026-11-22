/**
 * Small patches to three's standard material, shared by the track builders.
 */
import * as THREE from 'three';
import { noiseTexture } from './noise';

export interface GroundDetail {
  /** How far the ground's brightness wanders over tens of metres (0.25 = ±12%). */
  macro: number;
  /** 0..1: how much of a second, larger reading of the texture is mixed in to hide its repeat. */
  second: number;
}

/**
 * Makes a tiling ground texture stop looking tiled: a second reading of it at a larger, turned
 * scale is mixed in patch by patch, and the whole is brightened and darkened slowly across the
 * field. Expects the material's uv to be world metres times a constant (as the terrain's are).
 */
export function addGroundDetail(mat: THREE.MeshStandardMaterial, detail: GroundDetail): void {
  const noise = noiseTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGfxNoise = { value: noise };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D uGfxNoise;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec2 gfxWide = mat2( 0.80, -0.60, 0.60, 0.80 ) * vMapUv * 0.23;
  vec4 gfxFar = texture2D( map, gfxWide );
  float gfxPick = texture2D( uGfxNoise, vMapUv * 0.031 ).r;
  sampledDiffuseColor = mix( sampledDiffuseColor, gfxFar, smoothstep( 0.35, 0.65, gfxPick ) * ${detail.second.toFixed(3)} );
  float gfxMacro = texture2D( uGfxNoise, vMapUv * 0.0071 ).g;
  sampledDiffuseColor.rgb *= 1.0 + ( gfxMacro - 0.5 ) * ${detail.macro.toFixed(3)};
  diffuseColor *= sampledDiffuseColor;
#endif
`,
      );
  };
  mat.customProgramCacheKey = () => `gfx-ground-${detail.macro}-${detail.second}`;
}
