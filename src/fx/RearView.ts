/**
 * Rear-view mirror: renders the scene from a camera on the player's kart looking backwards
 * into a small render target, then composites it (horizontally mirrored, like a real mirror)
 * into a screen rectangle the HUD frames. Only runs while the HUD says a threat is behind.
 */
import * as THREE from 'three';
import type { IKart } from '../core/types';

const RT_W = 448;
const RT_H = 252;

export interface ScreenRect {
  /** CSS pixels, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RearView {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.PerspectiveCamera(62, RT_W / RT_H, 0.3, 320);
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();

  constructor() {
    this.target = new THREE.WebGLRenderTarget(RT_W, RT_H, { depthBuffer: true, stencilBuffer: false, samples: 0 });
    const tex = this.target.texture;
    tex.colorSpace = THREE.SRGBColorSpace;
    // Mirror image: flip U.
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    tex.offset.x = 1;
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.quadScene.add(this.quad);
  }

  /**
   * Draw the mirror into `rect` (CSS px in the canvas' coordinate space). Call after the main
   * frame has been presented; restores renderer viewport/scissor/autoClear afterwards.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, player: IKart, rect: ScreenRect, canvasCssHeight: number): void {
    const s = player.state;
    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    // Camera just above the driver's helmet, looking back down the road.
    this.tmpPos.set(s.position.x + fx * 0.7, s.position.y + 1.45, s.position.z + fz * 0.7);
    this.tmpTarget.set(s.position.x - fx * 24, s.position.y + 0.5, s.position.z - fz * 24);
    this.camera.position.copy(this.tmpPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.tmpTarget);

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.getViewport(this.viewport);
    renderer.getScissor(this.scissor);
    const prevScissorTest = renderer.getScissorTest();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;

    // Pass 1: scene → small target (reuse the shadow map the main frame already rendered).
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    renderer.render(scene, this.camera);
    renderer.shadowMap.autoUpdate = prevShadowAuto;

    // Pass 2: mirrored quad into the HUD frame's rectangle on the default framebuffer.
    //
    // These are CSS pixels, NOT device pixels: setViewport/setScissor multiply by the renderer's
    // pixel ratio themselves. Pre-multiplying here drew the mirror at twice its size and twice its
    // offset on any screen with dpr > 1 — on a phone that threw the image up into the top-left
    // corner while the HUD frame stayed at the bottom, so the game appeared to have two mirrors.
    // Only the y axis is converted, because GL counts from the bottom of the framebuffer.
    renderer.setRenderTarget(prevTarget);
    const px = Math.round(rect.x);
    const py = Math.round(canvasCssHeight - rect.y - rect.h);
    const pw = Math.max(1, Math.round(rect.w));
    const ph = Math.max(1, Math.round(rect.h));
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(px, py, pw, ph);
    renderer.setScissor(px, py, pw, ph);
    renderer.render(this.quadScene, this.quadCamera);

    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(this.viewport);
    renderer.setScissor(this.scissor);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.target.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}
