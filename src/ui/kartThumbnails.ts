/**
 * Kart thumbnails: a racer's kart rendered with the real model builder into a small transparent
 * canvas, cached as data URLs for the session. Rendering happens in a throwaway WebGL context so
 * the game renderer / post-FX chain is untouched.
 *
 * Two caches, one image format. The character-select sheet is rendered in a single batch at
 * startup; a garage look (`getLookThumbnail`) is rendered on demand and keyed by character plus
 * packed look, so a records board full of the same player's kart pays for one render.
 */
import * as THREE from 'three';
import { sanitize, unpackCosmetics } from '../core/cosmetics';
import type { CharacterDef } from '../core/types';
import { buildKartModel } from '../kart/KartModel';

const THUMB_W = 320;
const THUMB_H = 200;
const YAW = Math.PI * 0.8; // three-quarter front view, same as the promo lineup

const cache = new Map<string, string>();
let pending: Promise<ReadonlyMap<string, string>> | null = null;

export function getKartThumbnail(characterId: string): string | undefined {
  return cache.get(characterId);
}

/**
 * Resolves with the id → data-URL map once every character has a thumbnail. Work is
 * deferred to the next frame so the title screen paints first; failures (no WebGL in a
 * test runner, context lost) leave the map short and the cards keep their helmet swatch.
 */
export function ensureKartThumbnails(characters: readonly CharacterDef[]): Promise<ReadonlyMap<string, string>> {
  if (characters.every((c) => cache.has(c.id))) return Promise.resolve(cache);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const run = () => {
      try {
        renderAll(characters);
      } catch (err) {
        console.warn('[thumbs] kart thumbnail render failed:', err);
      }
      pending = null;
      resolve(cache);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  });
  return pending;
}

function renderAll(characters: readonly CharacterDef[]): void {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_W, THUMB_H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f5a, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.position.set(2.5, 4, 3);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8ab4ff, 0.9);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(28, THUMB_W / THUMB_H, 0.1, 20);
  camera.position.set(2.45, 1.5, 2.45);
  camera.lookAt(0, 0.42, 0);

  try {
    for (const c of characters) {
      if (cache.has(c.id)) continue;
      const parts = buildKartModel(c);
      parts.root.rotation.y = YAW;
      scene.add(parts.root);
      renderer.render(scene, camera);
      cache.set(c.id, canvas.toDataURL('image/png'));
      scene.remove(parts.root);
      parts.dispose();
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

// ── Looks (records rows, lobby list, results) ───────────────────────────────

const lookCache = new Map<string, string>();
/** Small: these appear a dozen to a screen and only need to read as "that kart, that colour". */
const LOOK_W = 176;
const LOOK_H = 112;

/**
 * Thumbnail of `characterId` wearing `packed`, or undefined when the look is empty (callers fall
 * back to the plain character thumbnail) or WebGL is unavailable. Synchronous and cached: a row
 * list can call it per row.
 */
export function getLookThumbnail(characterId: string, packed: string | undefined, character: CharacterDef | undefined): string | undefined {
  if (!packed || !character) return undefined;
  const key = `${characterId}|${packed}`;
  const hit = lookCache.get(key);
  if (hit !== undefined) return hit || undefined;
  let url = '';
  try {
    url = renderLook(character, packed);
  } catch (err) {
    console.warn('[thumbs] look thumbnail failed:', err);
  }
  // Cached either way, empty included: a context that cannot render will not start rendering later.
  lookCache.set(key, url);
  return url || undefined;
}

function renderLook(character: CharacterDef, packed: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = LOOK_W;
  canvas.height = LOOK_H;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(LOOK_W, LOOK_H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f5a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(2.5, 4, 3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(28, LOOK_W / LOOK_H, 0.1, 20);
    camera.position.set(2.45, 1.5, 2.45);
    camera.lookAt(0, 0.42, 0);

    // Rendered with the gate open: the packed string was already sanitized against its owner's
    // entitlement when they saved it, and sanitize still drops unknown ids and stray colours.
    const parts = buildKartModel(character, sanitize(unpackCosmetics(packed), true));
    parts.root.rotation.y = YAW;
    scene.add(parts.root);
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    parts.dispose();
    return url;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
