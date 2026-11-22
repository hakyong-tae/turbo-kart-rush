/**
 * Kart thumbnails: a racer's kart rendered with the real model builder into a small transparent
 * canvas, cached as data URLs for the session. Rendering happens in its own WebGL context so the
 * game renderer / post-FX chain is untouched.
 *
 * Two caches, one image format. The character-select sheet is drawn one kart at a time, when a
 * screen that shows it asks or when the lobby has been idle for a moment, and never while a race
 * is loading or running (`setKartThumbnailsAllowed`). It used to be drawn in one go right after
 * start-up: sixteen karts and every shader they need, about two seconds on a fast machine during
 * which nothing else could happen — for a sheet a first-time player, who goes straight into a
 * race, does not see at all. A garage look (`getLookThumbnail`) is rendered on demand and keyed
 * by character plus packed look, so a records board full of the same player's kart pays for one
 * render.
 *
 * One renderer serves both and is kept for the session: the shaders a kart needs are compiled
 * once, not once per picture.
 */
import * as THREE from 'three';
import { sanitize, unpackCosmetics } from '../core/cosmetics';
import type { CharacterDef } from '../core/types';
import { buildKartModel } from '../kart/KartModel';

const THUMB_W = 320;
const THUMB_H = 200;
const YAW = Math.PI * 0.8; // three-quarter front view, same as the promo lineup

const cache = new Map<string, string>();
const listeners = new Set<(characterId: string, url: string) => void>();
const queue: CharacterDef[] = [];
let waiting: ((map: ReadonlyMap<string, string>) => void)[] = [];
let allowed = true;
let working = false;
let broken = false;

export function getKartThumbnail(characterId: string): string | undefined {
  return cache.get(characterId);
}

/** Called with each thumbnail as it is drawn. Returns the unsubscribe. */
export function onKartThumbnail(listener: (characterId: string, url: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether thumbnails may be drawn right now. The game turns this off for the length of a race
 * (loading screen to results): a picture for a menu must not cost a frame of the race.
 */
export function setKartThumbnailsAllowed(on: boolean): void {
  allowed = on;
  if (on) pump();
}

/**
 * Asks for the sheet. Resolves with the id → data-URL map once every character asked for has a
 * thumbnail (or drawing has failed: no WebGL in a test runner, context lost — the map is then
 * short and the cards keep their colour swatch). Thumbnails also arrive one by one through
 * `onKartThumbnail`.
 */
export function ensureKartThumbnails(characters: readonly CharacterDef[]): Promise<ReadonlyMap<string, string>> {
  for (const c of characters) if (!cache.has(c.id) && !queue.includes(c)) queue.push(c);
  if (queue.length === 0 || broken) return Promise.resolve(cache);
  const done = new Promise<ReadonlyMap<string, string>>((resolve) => waiting.push(resolve));
  pump();
  return done;
}

function settle(): void {
  const list = waiting;
  waiting = [];
  for (const resolve of list) resolve(cache);
}

/** Draws the next kart in the queue, then yields a frame before the one after. */
function pump(): void {
  if (working || !allowed || queue.length === 0) return;
  if (typeof requestAnimationFrame !== 'function') {
    queue.length = 0;
    settle();
    return;
  }
  working = true;
  requestAnimationFrame(() => {
    void drawNext().finally(() => {
      working = false;
      if (queue.length === 0 || broken) settle();
      else pump();
    });
  });
}

async function drawNext(): Promise<void> {
  if (!allowed) return;
  const c = queue[0];
  if (!c) return;
  try {
    const url = await renderKart(c, undefined, THUMB_W, THUMB_H, true);
    queue.shift();
    cache.set(c.id, url);
    for (const listener of listeners) listener(c.id, url);
  } catch (err) {
    console.warn('[thumbs] kart thumbnail render failed:', err);
    broken = true;
    queue.length = 0;
  }
}

// ── The shared studio ────────────────────────────────────────────────────────

interface Studio {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

let studio: Studio | null = null;

function getStudio(): Studio {
  if (studio) return studio;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  // Asking the driver whether each shader compiled waits for it to finish compiling; in a
  // shipped build nobody reads the answer.
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  renderer.setPixelRatio(1);
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
  // A lost context cannot draw: start over with a new studio the next time one is needed.
  canvas.addEventListener('webglcontextlost', () => {
    if (studio?.canvas === canvas) studio = null;
  });
  studio = { canvas, renderer, scene, camera };
  return studio;
}

function frame(st: Studio, width: number, height: number): void {
  if (st.canvas.width !== width || st.canvas.height !== height) st.renderer.setSize(width, height, false);
  st.camera.aspect = width / height;
  st.camera.updateProjectionMatrix();
}

/**
 * One kart, one picture. With `patient` the shaders are compiled off the main thread first and
 * the call waits for them; without it the picture is drawn now, whatever that costs.
 */
function renderKart(character: CharacterDef, packed: string | undefined, width: number, height: number, patient: true): Promise<string>;
function renderKart(character: CharacterDef, packed: string | undefined, width: number, height: number, patient: false): string;
function renderKart(character: CharacterDef, packed: string | undefined, width: number, height: number, patient: boolean): string | Promise<string> {
  const st = getStudio();
  // Rendered with the gate open: a packed look was already sanitized against its owner's
  // entitlement when they saved it, and sanitize still drops unknown ids and stray colours.
  const parts = buildKartModel(character, packed ? sanitize(unpackCosmetics(packed), true) : undefined);
  parts.root.rotation.y = YAW;
  const shoot = (): string => {
    frame(st, width, height);
    st.scene.add(parts.root);
    try {
      st.renderer.render(st.scene, st.camera);
      return st.canvas.toDataURL('image/png');
    } finally {
      st.scene.remove(parts.root);
      parts.dispose();
    }
  };
  if (!patient) return shoot();
  st.scene.add(parts.root);
  return st.renderer
    .compileAsync(st.scene, st.camera)
    .catch(() => undefined)
    .then(() => {
      st.scene.remove(parts.root);
      return shoot();
    });
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
  return renderKart(character, packed, LOOK_W, LOOK_H, false);
}
