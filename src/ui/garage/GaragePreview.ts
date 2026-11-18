/**
 * The garage turntable: one kart, live, in its own WebGL context.
 *
 * Separate from the game renderer on purpose — the garage opens from the title screen where no
 * race exists, and borrowing the main renderer would drag the whole post-FX chain along. The
 * context is created when the panel first opens and torn down when it closes, so an idle lobby
 * costs nothing.
 *
 * A dark floor sits under the kart because the underglow is light: with no surface to catch the
 * spill there is nothing to sell, which is also why the preview keeps rolling the wheels — half
 * of these effects only exist in motion. The exhaust flame only exists under boost, so the
 * turntable boosts: a burst every few seconds, or held open while the flame tab is up.
 */
import * as THREE from 'three';
import type { KartCosmetics } from '../../core/cosmetics';
import type { CharacterDef } from '../../core/types';
import { buildKartModel, setAfterburner, type KartModelPartsEx } from '../../kart/KartModel';
import { tickPatternTime } from '../../kart/patternShader';

const FLOOR_RADIUS = 3.4;
/** Fixed step: the turntable must look identical whatever the display refresh rate is. */
const DT = 1 / 60;
/** Showroom boost: this long burning out of every period, so the flame is seen lighting and dying. */
const BOOST_PERIOD = 3.6;
const BOOST_ON = 2.2;
/** While the boost is held the turntable stops turning and sways about the tail instead. */
const REAR_VIEW = 0;
const REAR_SWAY = 0.48;

export class GaragePreview {
  readonly canvas: HTMLCanvasElement;

  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1.6, 0.1, 40);
  private parts: KartModelPartsEx | null = null;
  private pivot = new THREE.Group();
  private character: CharacterDef | null = null;
  private cosmetics: KartCosmetics = {};
  private spin = Math.PI * 0.75;
  private wheelSpin = 0;
  private running = false;
  private frame = 0;
  private time = 0;
  private glow = 0;
  private boostHold = false;
  private sway = 0;
  private neonTinted = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'garage-canvas';
    parent.appendChild(this.canvas);

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x0a0c12, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.6, 4, 2.4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb0ff, 1.1);
    rim.position.set(-3, 1.6, -2.4);
    this.scene.add(rim);
    // Showroom floor: dark enough for an additive glow to register, lit enough to read as ground.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR_RADIUS, 48),
      new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.55, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.scene.add(this.pivot);
    this.frameCamera(4 / 3);
  }

  /** Rebuilds the model. Called when the character changes, not when a colour does. */
  setCharacter(character: CharacterDef, cosmetics: KartCosmetics): void {
    if (this.character?.id === character.id) {
      this.setCosmetics(cosmetics);
      return;
    }
    this.character = character;
    this.cosmetics = cosmetics;
    this.disposeModel();
    const parts = buildKartModel(character, cosmetics);
    this.pivot.add(parts.root);
    // The pool normally hangs off the kart's ground object; here the pivot plays that part.
    this.pivot.add(parts.underglow.mesh);
    this.parts = parts;
  }

  /** Repaints in place — no rebuild, so dragging a colour slider stays smooth. */
  setCosmetics(cosmetics: KartCosmetics): void {
    this.cosmetics = cosmetics;
    this.parts?.applyCosmetics(cosmetics);
  }

  /**
   * Holds the boost open (the flame tab) instead of pulsing it, and keeps the tail towards the
   * camera: the pipes are at the back, and a flame chosen while the kart shows its nose is a
   * flame nobody saw. Released, the turntable carries on from wherever the sway left it.
   */
  setBoostHold(on: boolean): void {
    if (on === this.boostHold) return;
    this.boostHold = on;
    if (on) this.sway = 0;
    else this.spin = this.pivot.rotation.y;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.setClearColor(0x000000, 0);
    }
    const tick = (): void => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(tick);
      this.render();
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  dispose(): void {
    this.stop();
    this.disposeModel();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.remove();
  }

  private render(): void {
    const r = this.renderer;
    const parts = this.parts;
    if (!r || !parts) return;
    const w = this.canvas.clientWidth || 480;
    const h = this.canvas.clientHeight || 300;
    if (this.canvas.width !== Math.floor(w * r.getPixelRatio()) || this.canvas.height !== Math.floor(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.frameCamera(w / Math.max(1, h));
    }
    tickPatternTime(DT);
    if (this.boostHold) {
      this.sway += DT * 0.55;
      this.pivot.rotation.y = REAR_VIEW + Math.sin(this.sway) * REAR_SWAY;
    } else {
      this.spin += DT * 0.5;
      this.pivot.rotation.y = this.spin;
    }
    // Wheels turn as if rolling at showroom pace, so spoke and rim effects are legible.
    this.wheelSpin = (this.wheelSpin + DT * 6) % (Math.PI * 2);
    const wheels = parts.wheels;
    for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x = -this.wheelSpin;
    this.burn(parts);
    r.render(this.scene, this.camera);
  }

  /** The exhaust under a showroom boost — the same numbers `Kart.updateVisuals` uses in a race. */
  private burn(parts: KartModelPartsEx): void {
    this.time += DT;
    const burning = this.boostHold || this.time % BOOST_PERIOD < BOOST_ON;
    this.glow += ((burning ? 1 : 0) - this.glow) * (1 - Math.exp(-10 * DT));
    const flicker = 0.75 + 0.25 * Math.sin(this.time * 47) * Math.sin(this.time * 31 + 1);
    parts.exhaustGlowMaterial.emissiveIntensity = this.glow * 3 * flicker;
    setAfterburner(parts, this.glow, flicker);
    if (parts.neonCycle) {
      const hue = (this.time * 0.35 + 0.33) % 1;
      parts.neonFlameMaterial.color.setHSL(hue, 1, 0.65);
      parts.neonHaloMaterial.color.copy(parts.neonFlameMaterial.color);
      parts.neonRingMaterial.color.copy(parts.neonFlameMaterial.color);
      this.neonTinted = true;
    } else if (this.neonTinted) {
      parts.neonFlameMaterial.color.copy(parts.neonColor);
      parts.neonHaloMaterial.color.copy(parts.neonColor);
      parts.neonRingMaterial.color.copy(parts.neonColor);
      this.neonTinted = false;
    }
  }

  /**
   * Pulls back on a narrow canvas. The vertical FOV is fixed, so a portrait stage would crop the
   * kart at the wheels; distance has to answer to width, not height.
   */
  private frameCamera(aspect: number): void {
    const dist = 3.9 * Math.max(1, 1.45 / Math.max(0.4, aspect));
    this.camera.aspect = aspect;
    this.camera.position.set(0, 1.05 + dist * 0.1, dist);
    this.camera.lookAt(0, 0.42, 0);
    this.camera.updateProjectionMatrix();
  }

  private disposeModel(): void {
    if (!this.parts) return;
    this.parts.dispose();
    this.parts = null;
  }
}
