/**
 * Post-processing pipeline.
 *
 *   scene → HDR buffer (multisampled where the device can afford it)
 *         → bloom (a small chain of half-size blurs)
 *         → one last pass to the screen: bloom, sun shafts and flare, speed lines, radial blur,
 *           chromatic aberration, vignette, hit tint, flash, exposure, tone mapping, colour grade,
 *           grain.
 *
 * The scene's look — exposure, tone curve, contrast, saturation, tints, how much it blooms — is a
 * `PostLook`, set per circuit by the game. Falls back to a plain renderer.render() when disabled
 * or if the device cannot render to a float buffer.
 */
import * as THREE from 'three';
import type { IPostFX } from '../core/types';
import { events } from '../core/events';
import { clamp01, damp } from '../core/math';
import { quality, type GfxQuality } from '../gfx/quality';
import {
  BLOOM_DOWN_FRAGMENT,
  BLOOM_PREFILTER_FRAGMENT,
  BLOOM_UP_FRAGMENT,
  FINAL_FRAGMENT,
  FINAL_VERTEX,
  POST_VERTEX,
} from './shaders';

const HIT_EVENT_DECAY = 0.6;
/** Display-space grain amplitude at rest / added at full boost. */
const GRAIN_REST = 0.014;
const GRAIN_BOOST = 0.012;

/** How a scene is developed into the picture on screen. */
export interface PostLook {
  /** Multiplier on the linear scene colour before tone mapping. */
  exposure: number;
  /** 1 = ACES filmic (soft, slightly desaturated), 0 = neutral (colours kept as lit). */
  filmic: number;
  contrast: number;
  saturation: number;
  /** Extra saturation given mostly to muted colours. */
  vibrance: number;
  /** Multipliers on the dark and the bright end of the picture (display space). */
  shadowTint: number;
  highTint: number;
  bloom: number;
  bloomThreshold: number;
  bloomKnee: number;
  vignette: number;
  /** Sun shafts and lens flare strength (only seen when the game has told us where the sun is). */
  shafts: number;
  flare: number;
}

/** The look of the menus and of anything nobody has given a look: what the game always had. */
export const DEFAULT_LOOK: PostLook = {
  exposure: 1.05,
  filmic: 1,
  contrast: 1,
  saturation: 1,
  vibrance: 0,
  shadowTint: 0xffffff,
  highTint: 0xffffff,
  bloom: 0.5,
  bloomThreshold: 0.9,
  bloomKnee: 0.25,
  vignette: 0.22,
  shafts: 0,
  flare: 0,
};

const MAX_BLOOM_LEVELS = 6;

function fullScreenTriangle(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geo;
}

export class PostFX implements IPostFX {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private q: GfxQuality = quality();

  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private readonly bloomTargets: THREE.WebGLRenderTarget[] = [];
  private readonly triangle = fullScreenTriangle();
  private readonly quad: THREE.Mesh;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private prefilter: THREE.ShaderMaterial | null = null;
  private down: THREE.ShaderMaterial | null = null;
  private up: THREE.ShaderMaterial | null = null;
  private final: THREE.ShaderMaterial | null = null;

  private enabled = true;
  private failed = false;
  /** Set by the resolution governor when the floor was not enough: no multisampling, no sun effects, a short bloom. */
  private lean = false;

  private speedTarget = 0;
  private boostTarget = 0;
  private hitTarget = 0;
  private speed = 0;
  private boost = 0;
  private hit = 0;
  private hitPulse = 0;
  private flashLevel = 0;
  private flashDuration = 0;
  private flashPeak = 0;
  private time = 0;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  private look: PostLook = DEFAULT_LOOK;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly sunColor = new THREE.Color(1, 1, 1);
  private sunPresence = 0;
  private sunSeen = 0;

  private readonly flashColor = new THREE.Color(1, 1, 1);
  private readonly tmp = new THREE.Vector3();
  private readonly unsubs: (() => void)[] = [];

  constructor() {
    this.quad = new THREE.Mesh(this.triangle);
    this.quad.frustumCulled = false;
    this.unsubs.push(events.on('item:lightning', () => this.flash(0xcfe6ff, 0.5)));
    this.unsubs.push(events.on('item:hit', (e) => {
      if (e.isPlayer) this.hitPulse = 1;
    }));
    this.unsubs.push(events.on('kart:spin', (e) => {
      if (e.kartId === 0) this.hitPulse = Math.max(this.hitPulse, 0.8);
    }));
  }

  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.disposePipeline();
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.failed = false;
    this.q = quality();

    const size = renderer.getSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);
    this.pixelRatio = renderer.getPixelRatio();

    try {
      // Float colour buffers are core in WebGL2 only with this extension; without it the HDR
      // buffer cannot be rendered to at all.
      if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
        throw new Error('no float render targets');
      }
      const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}): THREE.ShaderMaterial =>
        new THREE.ShaderMaterial({
          vertexShader: POST_VERTEX,
          fragmentShader,
          uniforms,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          ...extra,
        });
      this.prefilter = pass(BLOOM_PREFILTER_FRAGMENT, {
        tSource: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: this.look.bloomThreshold },
        uKnee: { value: this.look.bloomKnee },
      });
      this.down = pass(BLOOM_DOWN_FRAGMENT, { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } });
      this.up = pass(
        BLOOM_UP_FRAGMENT,
        { tSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
        { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true },
      );
      this.final = pass(
        FINAL_FRAGMENT,
        {
          tScene: { value: null },
          tBloom: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uSpeed: { value: 0 },
          uBoost: { value: 0 },
          uHit: { value: 0 },
          uFlash: { value: 0 },
          uFlashColor: { value: new THREE.Color(1, 1, 1) },
          uGrain: { value: GRAIN_REST },
          uBloom: { value: 0 },
          uSunUv: { value: new THREE.Vector3(0.5, 0.5, 0) },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uShafts: { value: 0 },
          uFlare: { value: 0 },
          uExposure: { value: 1 },
          uFilmic: { value: 1 },
          uContrast: { value: 1 },
          uSaturation: { value: 1 },
          uVibrance: { value: 0 },
          uShadowTint: { value: new THREE.Color(1, 1, 1) },
          uHighTint: { value: new THREE.Color(1, 1, 1) },
          uVignette: { value: 0.22 },
        },
        { vertexShader: FINAL_VERTEX, defines: this.q.sunShafts ? { SUN_SHAFTS: 1 } : {} },
      );
      this.allocate();
      this.applyLook();
    } catch (err) {
      console.warn('[PostFX] failed to build pipeline, falling back to plain rendering', err);
      this.failed = true;
      this.disposePipeline();
    }
  }

  /** (Re)creates every buffer at the current size. */
  private allocate(): void {
    const w = Math.max(1, Math.floor(this.width * this.pixelRatio));
    const h = Math.max(1, Math.floor(this.height * this.pixelRatio));
    this.sceneTarget?.dispose();
    for (const t of this.bloomTargets) t.dispose();
    this.bloomTargets.length = 0;

    const samples = this.lean ? 0 : Math.min(this.q.msaa, this.renderer?.capabilities.maxSamples ?? 0);
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sceneTarget.texture.name = 'postfx-scene';

    const levels = Math.min(this.lean ? 3 : this.q.bloomLevels, MAX_BLOOM_LEVELS);
    let bw = w;
    let bh = h;
    for (let i = 0; i < levels; i++) {
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
      const t = new THREE.WebGLRenderTarget(bw, bh, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      t.texture.name = `postfx-bloom-${i}`;
      this.bloomTargets.push(t);
      if (bw <= 8 || bh <= 8) break;
    }
    if (this.final) (this.final.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  /** The buffer the scene is drawn into: shaders warmed against it are the ones a race uses. */
  get sceneRenderTarget(): THREE.WebGLRenderTarget | null {
    return this.failed ? null : this.sceneTarget;
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /** How the scene is developed. Pass nothing to go back to the default (menus). */
  setLook(look: PostLook | null): void {
    this.look = look ?? DEFAULT_LOOK;
    this.applyLook();
  }

  /**
   * Where the sun is, for shafts and flare. `presence` 0 turns them off (night, menus).
   * `direction` points from the scene toward the sun.
   */
  setSun(direction: THREE.Vector3 | null, color?: THREE.Color, presence = 1): void {
    if (!direction) {
      this.sunPresence = 0;
      return;
    }
    this.sunDir.copy(direction).normalize();
    if (color) this.sunColor.copy(color);
    this.sunPresence = clamp01(presence);
  }

  private applyLook(): void {
    const f = this.final;
    if (!f) return;
    const l = this.look;
    const u = f.uniforms;
    u.uExposure.value = l.exposure;
    u.uFilmic.value = l.filmic;
    u.uContrast.value = l.contrast;
    u.uSaturation.value = l.saturation;
    u.uVibrance.value = l.vibrance;
    // Tints are picked as sRGB colours and applied to sRGB values: keep the numbers as written.
    (u.uShadowTint.value as THREE.Color).setHex(l.shadowTint, THREE.LinearSRGBColorSpace);
    (u.uHighTint.value as THREE.Color).setHex(l.highTint, THREE.LinearSRGBColorSpace);
    u.uVignette.value = l.vignette;
    u.uBloom.value = this.bloomTargets.length > 0 ? l.bloom : 0;
    u.uShafts.value = this.lean ? 0 : l.shafts;
    u.uFlare.value = this.lean ? 0 : l.flare;
    if (this.prefilter) {
      this.prefilter.uniforms.uThreshold.value = l.bloomThreshold;
      this.prefilter.uniforms.uKnee.value = l.bloomKnee;
    }
  }

  private drawQuad(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.quad, this.quadCamera);
  }

  render(dt: number): void {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!renderer || !scene || !camera) return;

    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;

    // Smooth targets; hit combines the API target with the event pulse.
    this.speed = damp(this.speed, this.speedTarget, 6, dt);
    this.boost = damp(this.boost, this.boostTarget, this.boostTarget > this.boost ? 10 : 4, dt);
    if (this.hitPulse > 0) this.hitPulse = Math.max(0, this.hitPulse - dt / HIT_EVENT_DECAY);
    this.hit = damp(this.hit, Math.max(this.hitTarget, this.hitPulse), 12, dt);

    if (this.flashLevel > 0 && this.flashDuration > 0) {
      this.flashLevel = Math.max(0, this.flashLevel - dt / this.flashDuration);
    } else {
      this.flashLevel = 0;
    }

    const final = this.final;
    const sceneTarget = this.sceneTarget;
    if (!this.enabled || this.failed || !final || !sceneTarget || !this.prefilter || !this.down || !this.up) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    try {
      // ---- scene ------------------------------------------------------------
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);

      // The passes below draw one triangle each and must not clear what they add to.
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;

      // ---- bloom ------------------------------------------------------------
      const mips = this.bloomTargets;
      if (mips.length > 0 && this.look.bloom > 0.001) {
        this.prefilter.uniforms.tSource.value = sceneTarget.texture;
        (this.prefilter.uniforms.uTexel.value as THREE.Vector2).set(1 / sceneTarget.width, 1 / sceneTarget.height);
        this.drawQuad(this.prefilter, mips[0]);
        for (let i = 1; i < mips.length; i++) {
          this.down.uniforms.tSource.value = mips[i - 1].texture;
          (this.down.uniforms.uTexel.value as THREE.Vector2).set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
          this.drawQuad(this.down, mips[i]);
        }
        for (let i = mips.length - 2; i >= 0; i--) {
          this.up.uniforms.tSource.value = mips[i + 1].texture;
          (this.up.uniforms.uTexel.value as THREE.Vector2).set(0.5 / mips[i + 1].width, 0.5 / mips[i + 1].height);
          this.drawQuad(this.up, mips[i]);
        }
        final.uniforms.tBloom.value = mips[0].texture;
      } else {
        final.uniforms.tBloom.value = null;
      }

      // ---- to the screen ----------------------------------------------------
      const u = final.uniforms;
      u.tScene.value = sceneTarget.texture;
      u.uTime.value = this.time;
      u.uSpeed.value = this.speed;
      u.uBoost.value = this.boost;
      u.uHit.value = this.hit;
      u.uGrain.value = GRAIN_REST + GRAIN_BOOST * this.boost;
      // ease-out curve so the flash pops then lingers briefly
      const f = this.flashLevel;
      u.uFlash.value = this.flashPeak * f * f;
      (u.uFlashColor.value as THREE.Color).copy(this.flashColor);
      this.updateSun(dt, camera);
      this.drawQuad(final, null);
      renderer.autoClear = autoClear;
    } catch (err) {
      console.warn('[PostFX] render failed, disabling post-processing', err);
      this.failed = true;
      renderer.autoClear = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  /** Projects the sun onto the screen and fades it in and out as it enters and leaves the frame. */
  private updateSun(dt: number, camera: THREE.Camera): void {
    const final = this.final;
    if (!final) return;
    const uv = final.uniforms.uSunUv.value as THREE.Vector3;
    let target = 0;
    if (this.sunPresence > 0.001 && (this.look.shafts > 0.001 || this.look.flare > 0.001)) {
      camera.getWorldDirection(this.tmp);
      const facing = this.tmp.dot(this.sunDir);
      if (facing > 0.05) {
        // A point far along the sun's direction, in clip space.
        this.tmp.copy(camera.position).addScaledVector(this.sunDir, 1000).project(camera);
        const x = this.tmp.x * 0.5 + 0.5;
        const y = this.tmp.y * 0.5 + 0.5;
        // Still counted a little way outside the frame, so the light does not pop as it leaves.
        const off = Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) - 0.5;
        target = this.sunPresence * clamp01(1 - off / 0.35) * clamp01(facing * 4);
        uv.x = x;
        uv.y = y;
      }
    }
    this.sunSeen = damp(this.sunSeen, target, 6, dt);
    uv.z = this.sunSeen < 0.002 ? 0 : this.sunSeen;
    (final.uniforms.uSunColor.value as THREE.Color).copy(this.sunColor);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const pr = Math.max(0.25, pixelRatio);
    if (w === this.width && h === this.height && pr === this.pixelRatio && this.sceneTarget) return;
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    if (!this.failed && this.final) {
      this.allocate();
      this.applyLook();
    }
  }

  /** Drops the costliest parts of the pipeline (and restores them). Buffers are rebuilt. */
  setLean(lean: boolean): void {
    if (lean === this.lean) return;
    this.lean = lean;
    if (!this.failed && this.final) {
      this.allocate();
      this.applyLook();
    }
  }

  setSpeedEffect(intensity: number): void {
    this.speedTarget = clamp01(intensity);
  }

  setBoostEffect(intensity: number): void {
    this.boostTarget = clamp01(intensity);
  }

  setHitEffect(intensity: number): void {
    this.hitTarget = clamp01(intensity);
  }

  flash(color: number, duration: number): void {
    this.flashColor.setHex(color);
    this.flashDuration = Math.max(0.05, duration);
    this.flashLevel = 1;
    this.flashPeak = 0.9;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private disposePipeline(): void {
    this.sceneTarget?.dispose();
    this.sceneTarget = null;
    for (const t of this.bloomTargets) t.dispose();
    this.bloomTargets.length = 0;
    this.prefilter?.dispose();
    this.down?.dispose();
    this.up?.dispose();
    this.final?.dispose();
    this.prefilter = null;
    this.down = null;
    this.up = null;
    this.final = null;
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.disposePipeline();
    this.triangle.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
