/**
 * Environment probe: what the race scene looks like from the start line, filtered into the
 * texture three's physical materials read for reflections and ambient light.
 *
 * Without it nothing in a race reflects anything: paint has only its one sun highlight, chrome
 * is faked with a grey glow, and the shadowed side of everything is the flat hemisphere colour.
 * With it a kart carries the sky on its bodywork, the ground's colour comes up under it, and a
 * wet road at night mirrors the city.
 *
 * The filtered texture is allocated once and reused for every race. That matters for loading:
 * a material's shader depends on whether there is an environment and on its size, so the scene
 * can be given the (still empty) texture before shaders are compiled, and filled in afterwards
 * without a single program changing.
 */
import * as THREE from 'three';
import { findSky } from '../track/builders/sky';

export class EnvProbe {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator | null;
  private target: THREE.WebGLRenderTarget | null = null;
  private failed = false;

  constructor(renderer: THREE.WebGLRenderer, size: number) {
    this.renderer = renderer;
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.cubeCamera = new THREE.CubeCamera(0.5, 2600, this.cubeTarget);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    try {
      // Filter the empty cube once: this is what fixes the texture's size for good.
      this.target = this.pmrem.fromCubemap(this.cubeTarget.texture);
    } catch (err) {
      console.warn('[EnvProbe] could not build the environment texture; scenes go without reflections', err);
      this.failed = true;
    }
  }

  /** The texture to hand to `scene.environment` (null if the device cannot make one). */
  get texture(): THREE.Texture | null {
    return this.failed || !this.target ? null : this.target.texture;
  }

  /**
   * Looks at `scene` from `position` and refills the environment texture. Objects in `hide` are
   * left out (karts, items, particles: things that move must not be baked into reflections).
   */
  capture(scene: THREE.Scene, position: THREE.Vector3, hide: readonly THREE.Object3D[]): void {
    if (this.failed || !this.pmrem || !this.target) return;
    const renderer = this.renderer;
    const wasVisible = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const sky = findSky(scene);
    const prevTarget = renderer.getRenderTarget();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevIntensity = scene.environmentIntensity;
    try {
      sky?.setSunDisc(false);
      // The probe must not light itself with the last race's reflections. Turned down rather
      // than taken away: removing the environment would change every material's shader.
      scene.environmentIntensity = 0;
      // One shadow pass serves all six faces.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      this.cubeCamera.position.copy(position);
      this.cubeCamera.update(renderer, scene);
      this.pmrem.fromCubemap(this.cubeTarget.texture, this.target);
    } catch (err) {
      console.warn('[EnvProbe] capture failed; keeping the previous environment', err);
    } finally {
      scene.environmentIntensity = prevIntensity;
      sky?.setSunDisc(true);
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      renderer.setRenderTarget(prevTarget);
      for (let i = 0; i < hide.length; i++) hide[i].visible = wasVisible[i];
    }
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.cubeTarget.dispose();
    this.pmrem?.dispose();
    this.pmrem = null;
  }
}
