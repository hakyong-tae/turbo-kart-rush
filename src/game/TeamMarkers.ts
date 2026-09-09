/**
 * Team-mode chevrons floating above every kart (red / blue). Sprite materials are shared per
 * team for the whole session; the per-race sprites are created on attach and removed on dispose.
 */
import * as THREE from 'three';
import { SIDE_COLORS, sideOf } from '../core/teams';
import type { IKart, RaceMode } from '../core/types';

/** Chevrons are relative to the viewer: allies blue, rivals red. */
type Marker = 'ally' | 'rival';

const materials = new Map<Marker, THREE.SpriteMaterial>();

function markerMaterial(kind: Marker): THREE.SpriteMaterial {
  let mat = materials.get(kind);
  if (mat) return mat;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const hex = '#' + SIDE_COLORS[kind === 'ally' ? 'ally' : 'rival'].toString(16).padStart(6, '0');
    const tri = (x0: number, x1: number, y0: number, y1: number, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(32, y1);
      ctx.closePath();
      ctx.fill();
    };
    tri(8, 56, 8, 56, 'rgba(0,0,0,0.45)');
    tri(12, 52, 10, 50, hex);
    tri(20, 44, 14, 26, 'rgba(255,255,255,0.75)');
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
  materials.set(kind, mat);
  return mat;
}

export class TeamMarkers {
  private readonly sprites: THREE.Sprite[] = [];
  private scene: THREE.Scene | null = null;

  attach(scene: THREE.Scene, karts: readonly IKart[], localKartId: number, mode: RaceMode | undefined): void {
    this.scene = scene;
    for (const k of karts) {
      const side = sideOf(k.state.id, localKartId, mode);
      const sprite = new THREE.Sprite(markerMaterial(side === 'rival' ? 'rival' : 'ally'));
      sprite.scale.set(0.7, 0.7, 1);
      sprite.renderOrder = 5;
      scene.add(sprite);
      this.sprites.push(sprite);
    }
  }

  /** Per frame: hover above each kart; hide retired karts' markers. */
  update(karts: readonly IKart[], time: number): void {
    for (let i = 0; i < this.sprites.length && i < karts.length; i++) {
      const ks = karts[i].state;
      const m = this.sprites[i];
      m.position.set(ks.position.x, ks.position.y + 1.55 + Math.sin(time * 4 + i) * 0.05, ks.position.z);
      m.visible = !ks.finished || ks.finishTime > 0;
    }
  }

  dispose(): void {
    if (this.scene) for (const m of this.sprites) this.scene.remove(m);
    this.sprites.length = 0;
    this.scene = null;
  }
}
