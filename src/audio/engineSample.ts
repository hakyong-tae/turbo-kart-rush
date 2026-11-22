/**
 * The one recorded sound in the game: a looping kart exhaust, the body of the stock engine voice.
 *
 * Everything else audible is synthesised (see synth.ts). The stock engine was too, and players
 * called it shrill; a stack of oscillators swept over five octaves is hard to make sound like
 * anything else. So the stock voice now plays this loop at a rate tied to the revs and keeps the
 * synth for a little weight underneath (engine.ts).
 *
 * The file is 21 KB and nothing waits for it: the bytes are fetched once the game has drawn its
 * first screen, decoded when the audio context exists, and until then — or for good, if either
 * step fails — voices run on the synth alone, tuned low.
 *
 * Source and licence: src/assets/audio/CREDITS.md.
 */
import url from '../assets/audio/exhaust-loop.mp3?url';

/**
 * Where the loop sits in the file, in seconds. The file carries 0.3 s of the loop's end before it
 * and 0.3 s of its start after it, so a decoder that shifts the audio by a few milliseconds (mp3
 * decoders differ in how much padding they strip) still loops over one whole, continuous turn.
 */
export const ENGINE_LOOP_START = 0.3;
export const ENGINE_LOOP_END = 2.2511;
/** Exhaust pulses per second at playback rate 1. */
export const ENGINE_LOOP_PULSE_HZ = 11.63;

let bytes: Promise<ArrayBuffer | null> | null = null;
let buffer: AudioBuffer | null = null;
let decoding = false;

/** Starts fetching the file (once). Safe to call early and often; never throws. */
export function prefetchEngineSample(): void {
  if (bytes || buffer || typeof fetch !== 'function') return;
  bytes = fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);
}

/** Decodes the file for `ctx` (once), fetching it first if nobody has. Never throws. */
export function loadEngineSample(ctx: BaseAudioContext): void {
  if (buffer || decoding) return;
  prefetchEngineSample();
  if (!bytes) return;
  decoding = true;
  void bytes
    .then((data) => (data ? ctx.decodeAudioData(data.slice(0)) : null))
    .then((decoded) => {
      // A file too short to hold the loop is not the file this code was written for.
      if (decoded && decoded.duration >= ENGINE_LOOP_END) buffer = decoded;
    })
    .catch((err) => console.warn('[audio] engine sample could not be decoded; staying on the synth', err))
    .finally(() => {
      decoding = false;
    });
}

/** The decoded loop, or null while it is on its way (or if it never arrived). */
export function engineSample(): AudioBuffer | null {
  return buffer;
}

/** For tools that render a voice offline: hand in a buffer decoded elsewhere (null to go back to none). */
export function setEngineSample(decoded: AudioBuffer | null): void {
  buffer = decoded;
}
