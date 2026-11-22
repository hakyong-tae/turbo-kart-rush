/**
 * Per-kart engine voices. Sawtooth + detuned square + sub sine → lowpass whose
 * cutoff tracks rpm → tanh soft-clip → gain, with optional turbo whistle and a
 * filtered-noise skid loop. Non-player voices are positioned with a PannerNode.
 *
 * The stock voice (a kart with no engine pack) is different: its body is a recorded exhaust
 * loop played at a rate tied to the revs (engineSample.ts), with the synth kept low underneath
 * for weight. The engine packs are still pure synthesis.
 */
import type { EnginePackId } from '../core/cosmetics';
import type { KartState, WeightClass } from '../core/types';
import { clamp, clamp01, damp } from '../core/math';
import { glide, noiseBuffer, softClipCurve } from './synth';
import { ENGINE_LOOP_END, ENGINE_LOOP_START, engineSample } from './engineSample';

/**
 * F1-style voice: a high-revving firing fundamental (idle ≈ 130 Hz → ~900 Hz at the limiter)
 * with two detuned saws + an octave saw for the metallic scream, an open lowpass that tracks
 * revs, a resonant formant around 2–4 kHz for the shriek, and a hard-ish soft clip for rasp.
 */
const BASE_FREQ: Record<WeightClass, number> = { light: 150, medium: 130, heavy: 112 };
const IDLE_RPM = 0.12;
/** Pitch sweep across the rev range: freq = base * (PITCH_LO + PITCH_SPAN * rpm). */
const PITCH_LO = 0.55;
const PITCH_SPAN = 5.2;
/** Virtual 7-speed box: speed ratio at which each gear tops out. RPM climbs inside a gear and drops on the shift. */
const GEAR_TOPS = [0.13, 0.24, 0.36, 0.5, 0.65, 0.82, 1.4];
const SHIFT_TIME = 0.09;
const LIMITER_RPM = 0.985;

/**
 * Engine packs: a re-voicing of the same graph, not a second synth. Every pack moves the same
 * nodes — oscillator shapes, the pitch window, the lowpass sweep, the resonant formant, the
 * clip drive — so switching one costs a handful of parameter writes and no allocation, and a
 * grid of eight karts running eight packs is still eight voices.
 *
 * `scream` reproduces the stock F1 numbers exactly: a player who owns nothing hears no change.
 */
interface VoicePack {
  /** Multiplier on the weight-class base frequency, and on the rev sweep width. */
  pitch: number;
  span: number;
  oscA: OscillatorType;
  oscB: OscillatorType;
  /** Frequency of the upper layer relative to the fundamental, and its level. */
  oscBRatio: number;
  oscBGain: number;
  /** Lowpass cutoff at idle and at the limiter, and its resonance. */
  cutoff0: number;
  cutoff1: number;
  q: number;
  /** Resonant band that gives each pack its character, swept with the revs. */
  formant0: number;
  formant1: number;
  formantGain: number;
  /** Soft-clip drive: rasp. */
  clip: number;
  /** Level scales for the turbo whistle and the sub layer. */
  turbo: number;
  sub: number;
  /**
   * Combustion roar: filtered noise tracking the revs. This is what separates an engine from a
   * synth — a piston engine is explosions plus turbulent intake and exhaust, and without the
   * turbulence a stack of oscillators reads as an electric motor no matter how it is tuned.
   */
  roar: number;
  /** A recorded loop as the body of the voice (the stock voice only). */
  sample?: SampleLayer;
}

interface SampleLayer {
  /** Playback rate at zero revs and at the limiter (times the weight class's own scale). */
  rate0: number;
  rate1: number;
  /** Lowpass over the loop, idle and limiter: sped up, its metallic tick climbs with it. */
  cutoff0: number;
  cutoff1: number;
  gain: number;
  /**
   * A broad lift in the middle of the loop, idle and limiter centre frequency and its size in dB.
   * The recording keeps four fifths of its energy under 250 Hz, which a phone's speaker does not
   * play at all: this is what is left of the engine there. It sits well under the 2 kHz where
   * "shrill" starts.
   */
  presence0: number;
  presence1: number;
  presenceDb: number;
  /** What is left of the oscillator layers while the loop is playing (1 = all of it). */
  synth: number;
}

/**
 * What a kart sounded like before anyone bought an engine pack, until the stock voice became the
 * recorded kart (`KART_VOICE`); still reachable with `?engine=old`. The classes are different machines,
 * not the same machine at different pitches: the heavies are big rough combustion units, the
 * middleweights are the high-revving race engine, and the lightweights are hybrids — near-silent
 * of combustion, all inverter whine and instant torque, which is also how they drive (the light
 * roster carries the highest acceleration stats in the game).
 */
const CLASS_PACK: Readonly<Record<WeightClass, EnginePackId>> = {
  light: 'electric',
  medium: 'scream',
  heavy: 'rumble',
};

/**
 * The stock voice: what every kart sounds like until its owner buys an engine pack.
 *
 * Players called the old stock voices shrill, and they were: the middleweight "scream" swept its
 * fundamental from 150 Hz to 750 Hz with an octave layer and a formant up to 3.4 kHz on top, and
 * the lightweights' hybrid whine — the first kart anyone drives — reached 2 kHz at the limiter.
 * This one stays low. The loop carries the character; under it the synth is a fundamental that
 * runs 53 → 178 Hz (medium), closed down to a couple of kilohertz, lightly clipped. Without the
 * loop (not yet loaded, or never) the same synth plays at full level, which is still a low voice.
 * Weight classes differ by the pitch of the whole thing: light 15% up, heavy 14% down.
 */
const KART_VOICE: VoicePack = {
  pitch: 0.5, span: 0.42, oscA: 'sawtooth', oscB: 'sawtooth', oscBRatio: 2, oscBGain: 0.4,
  cutoff0: 380, cutoff1: 2400, q: 1.3, formant0: 500, formant1: 1300, formantGain: 0.4,
  clip: 2.2, turbo: 0.6, sub: 1.3, roar: 1.1,
  sample: { rate0: 0.8, rate1: 2.0, cutoff0: 2000, cutoff1: 4600, gain: 2.3, presence0: 600, presence1: 1150, presenceDb: 11, synth: 0.3 },
};

/**
 * `?engine=old` puts the stock voices back as they were before 2026-11-22 (per weight class:
 * electric, scream, rumble), so the two can be compared by ear in the same build.
 */
const OLD_STOCK = (() => {
  try {
    return new URLSearchParams(location.search).get('engine') === 'old';
  } catch {
    return false;
  }
})();

function stockVoice(weightClass: WeightClass): VoicePack {
  return OLD_STOCK ? VOICE_PACKS[CLASS_PACK[weightClass]] : KART_VOICE;
}

const VOICE_PACKS: Readonly<Record<EnginePackId, VoicePack>> = {
  // Stock: high-revving F1 scream. Deliberately light on pure tones — the octave saw and the sine
  // sub are what made players hear an electric motor — and heavy on turbulence instead.
  scream: { pitch: 1, span: 1, oscA: 'sawtooth', oscB: 'sawtooth', oscBRatio: 2, oscBGain: 0.72, cutoff0: 700, cutoff1: 7700, q: 1.7, formant0: 1400, formant1: 3400, formantGain: 0.72, clip: 3.2, turbo: 1, sub: 0.7, roar: 1.15 },
  // American V8: an octave down, fat and lazy, resonance low in the chest.
  rumble: { pitch: 0.6, span: 0.72, oscA: 'sawtooth', oscB: 'square', oscBRatio: 1.5, oscBGain: 0.8, cutoff0: 300, cutoff1: 3200, q: 3.0, formant0: 620, formant1: 1500, formantGain: 1.5, clip: 5.0, turbo: 0.5, sub: 1.9, roar: 0.9 },
  // EV: no combustion, just inverter whine climbing with speed. Brought down on 2026-11-22: it
  // topped out at 1.8 kHz (2.1 kHz on a light kart) with a third harmonic and a formant above
  // that, and at the limiter nearly all of its energy sat over 2 kHz. Still the highest voice
  // there is, now peaking at 1.1 kHz with the formant kept under 4 kHz.
  electric: { pitch: 1.5, span: 1.0, oscA: 'triangle', oscB: 'sine', oscBRatio: 3, oscBGain: 0.6, cutoff0: 1800, cutoff1: 7000, q: 1.0, formant0: 1800, formant1: 3800, formantGain: 0.6, clip: 1.3, turbo: 1.5, sub: 0.45, roar: 0.05 },
  // Diesel: slow, clattery, almost no top end.
  diesel: { pitch: 0.48, span: 0.55, oscA: 'square', oscB: 'sawtooth', oscBRatio: 1.01, oscBGain: 0.7, cutoff0: 240, cutoff1: 1700, q: 4.0, formant0: 480, formant1: 1100, formantGain: 1.7, clip: 6.0, turbo: 0.8, sub: 2.1, roar: 1.05 },
  // Turbine: gas turbine, wide sweep, whistle-forward. The same day and for the same reason: the
  // sweep is narrower (1.1 kHz at the top, not 1.5), the lowpass and the whistle's band lower.
  turbine: { pitch: 1.3, span: 1.15, oscA: 'sawtooth', oscB: 'triangle', oscBRatio: 2.5, oscBGain: 0.9, cutoff0: 1200, cutoff1: 8000, q: 0.8, formant0: 2200, formant1: 4600, formantGain: 1.0, clip: 2.0, turbo: 2.3, sub: 0.7, roar: 0.95 },
  // Chiptune: two square waves and no shame.
  chiptune: { pitch: 1.2, span: 1.05, oscA: 'square', oscB: 'square', oscBRatio: 2, oscBGain: 1, cutoff0: 2600, cutoff1: 9000, q: 0.7, formant0: 1800, formant1: 3000, formantGain: 0.4, clip: 1.0, turbo: 1, sub: 0.5, roar: 0 },
};

/** Clip curves are shared per drive amount; six packs mean at most six tables for the whole grid. */
const clipCurves = new Map<number, Float32Array<ArrayBuffer>>();
function clipCurve(amount: number): Float32Array<ArrayBuffer> {
  let c = clipCurves.get(amount);
  if (!c) {
    c = softClipCurve(amount);
    clipCurves.set(amount, c);
  }
  return c;
}

export class EngineVoice {
  readonly kartId: number;
  readonly isPlayer: boolean;
  private readonly ctx: AudioContext;
  private readonly baseFreq: number;

  private readonly out: GainNode;
  private readonly panner: PannerNode | null;
  private readonly filter: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly engineGain: GainNode;
  private readonly saw: OscillatorNode;
  private readonly sawGain: GainNode;
  private readonly saw2: OscillatorNode;
  private readonly saw2Gain: GainNode;
  private readonly formant: BiquadFilterNode;
  private readonly formantGain: GainNode;
  private limiterPhase = 0;
  private square: OscillatorNode | null = null;
  private squareGain: GainNode | null = null;
  private sub: OscillatorNode | null = null;
  private subGain: GainNode | null = null;

  private readonly turboOsc: OscillatorNode;
  private readonly turboNoise: AudioBufferSourceNode;
  private readonly turboFilter: BiquadFilterNode;
  private readonly turboGain: GainNode;

  private readonly roarSrc: AudioBufferSourceNode;
  private readonly roarFilter: BiquadFilterNode;
  private readonly roarGain: GainNode;
  private readonly firingOsc: OscillatorNode;
  private readonly firingDepth: GainNode;

  private readonly skidSrc: AudioBufferSourceNode;
  private readonly skidFilter: BiquadFilterNode;
  private readonly skidGain: GainNode;

  private readonly weightClass: WeightClass;
  private pack: VoicePack = VOICE_PACKS.scream;
  /** The recorded loop, started the first time it is wanted and available; kept running after. */
  private sampleSrc: AudioBufferSourceNode | null = null;
  private sampleFilter: BiquadFilterNode | null = null;
  private samplePresence: BiquadFilterNode | null = null;
  private sampleGain: GainNode | null = null;
  /** How much of the oscillator layers is sounding (below 1 while the loop carries the voice). */
  private synthLevel = 1;
  private rpm = IDLE_RPM;
  private gear = 0;
  private shiftTimer = 0;
  private rich = false;
  private disposed = false;
  // Last scheduled targets for the optional layers, so silent layers don't
  // push a new automation event every frame.
  private turboLevel = -1;
  private skidLevel = -1;

  constructor(ctx: AudioContext, dest: AudioNode, kartId: number, weightClass: WeightClass, isPlayer: boolean) {
    this.ctx = ctx;
    this.kartId = kartId;
    this.isPlayer = isPlayer;
    this.weightClass = BASE_FREQ[weightClass] ? weightClass : 'medium';
    this.baseFreq = BASE_FREQ[this.weightClass];
    this.pack = stockVoice(this.weightClass);

    this.out = ctx.createGain();
    this.out.gain.value = isPlayer ? 1 : 0.85;

    if (!isPlayer) {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 6;
      panner.maxDistance = 90;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      this.out.connect(panner);
      panner.connect(dest);
      this.panner = panner;
    } else {
      this.panner = null;
      this.out.connect(dest);
    }

    // --- core engine ------------------------------------------------------
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.7;
    this.filter.frequency.value = 900;

    // Formant: a resonant band that rides the revs — the "shriek" component of an F1 engine.
    this.formant = ctx.createBiquadFilter();
    this.formant.type = 'bandpass';
    this.formant.Q.value = 5;
    this.formant.frequency.value = 1800;
    this.formantGain = ctx.createGain();
    this.formantGain.gain.value = 0.35;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = clipCurve(this.pack.clip);
    this.shaper.oversample = 'none';

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.filter.connect(this.shaper);
    this.formant.connect(this.formantGain);
    this.formantGain.connect(this.shaper);
    this.shaper.connect(this.engineGain);
    this.engineGain.connect(this.out);

    this.saw = ctx.createOscillator();
    this.saw.type = 'sawtooth';
    this.saw.frequency.value = this.baseFreq;
    this.sawGain = ctx.createGain();
    this.sawGain.gain.value = 0.42;
    this.saw.connect(this.sawGain);
    this.sawGain.connect(this.filter);
    this.sawGain.connect(this.formant);
    this.saw.start();
    // Octave saw, slightly flat: the metallic edge on top of the fundamental.
    this.saw2 = ctx.createOscillator();
    this.saw2.type = 'sawtooth';
    this.saw2.detune.value = -7;
    this.saw2.frequency.value = this.baseFreq * 2;
    this.saw2Gain = ctx.createGain();
    this.saw2Gain.gain.value = isPlayer ? 0.2 : 0.12;
    this.saw2.connect(this.saw2Gain);
    this.saw2Gain.connect(this.filter);
    this.saw2Gain.connect(this.formant);
    this.saw2.start();

    // --- turbo whistle layer ------------------------------------------------
    this.turboFilter = ctx.createBiquadFilter();
    this.turboFilter.type = 'bandpass';
    this.turboFilter.Q.value = 2.5;
    this.turboFilter.frequency.value = 1400;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboFilter.connect(this.turboGain);
    this.turboGain.connect(this.out);

    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'triangle';
    this.turboOsc.frequency.value = 1200;
    const turboOscGain = ctx.createGain();
    turboOscGain.gain.value = 0.5;
    this.turboOsc.connect(turboOscGain);
    turboOscGain.connect(this.turboFilter);
    this.turboOsc.start();

    this.turboNoise = ctx.createBufferSource();
    this.turboNoise.buffer = noiseBuffer(ctx, 'white');
    this.turboNoise.loop = true;
    const turboNoiseGain = ctx.createGain();
    turboNoiseGain.gain.value = 0.35;
    this.turboNoise.connect(turboNoiseGain);
    turboNoiseGain.connect(this.turboFilter);
    this.turboNoise.start(0, Math.random());

    // --- combustion roar ------------------------------------------------------
    // Joins after the shaper, not before it. The clip's gain reduction is driven by the
    // oscillators, so noise fed into it is simply squashed by them — measured: raising the roar
    // three-fold ahead of the clip moved the output peak not at all.
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.Q.value = 1.15;
    this.roarFilter.frequency.value = 320;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.roarSrc = ctx.createBufferSource();
    this.roarSrc.buffer = noiseBuffer(ctx, 'pink');
    this.roarSrc.loop = true;
    this.roarSrc.connect(this.roarFilter);
    this.roarFilter.connect(this.roarGain);
    this.roarGain.connect(this.engineGain);
    this.roarSrc.start(0, Math.random());

    // Chop the roar at the firing rate. This is the difference the complaint was about: an
    // electric motor is a steady whine, a piston engine is a burst per firing stroke, and a
    // constant-amplitude tone stack sounds like the former however it is voiced. Modulating the
    // noise at the fundamental gives the bursts, and the tones keep carrying the pitch.
    this.firingOsc = ctx.createOscillator();
    this.firingOsc.type = 'sawtooth';
    this.firingOsc.frequency.value = this.baseFreq;
    this.firingDepth = ctx.createGain();
    this.firingDepth.gain.value = 0;
    this.firingOsc.connect(this.firingDepth);
    this.firingDepth.connect(this.roarGain.gain);
    this.firingOsc.start();

    // --- skid loop ------------------------------------------------------------
    this.skidSrc = ctx.createBufferSource();
    this.skidSrc.buffer = noiseBuffer(ctx, 'pink');
    this.skidSrc.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1900;
    this.skidFilter.Q.value = 1.4;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidSrc.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.out);
    this.skidSrc.start(0, Math.random());

    this.applyPack(this.pack);
    this.setRich(isPlayer);
  }

  /**
   * Swaps the engine pack. Only parameter writes: no node is created or reconnected, so this is
   * safe mid-race and safe to call every frame while the garage auditions a pack.
   */
  setPack(id: EnginePackId | undefined): void {
    if (this.disposed) return;
    // No pack bought (or an id this build does not know) falls back to the class voice, not to a
    // single global default — a heavy kart should never come up sounding like the light one.
    const pack = (id && VOICE_PACKS[id]) || stockVoice(this.weightClass);
    if (pack === this.pack) return;
    this.applyPack(pack);
  }

  /**
   * Writes a pack onto the running nodes. Also called once at build time, because the oscillators
   * are created with fixed defaults — without this a fresh voice wore half of one pack and half
   * of another.
   */
  private applyPack(pack: VoicePack): void {
    this.pack = pack;
    this.saw.type = pack.oscA;
    this.saw2.type = pack.oscB;
    this.filter.Q.value = pack.q;
    this.shaper.curve = clipCurve(pack.clip);
    if (this.subGain) this.subGain.gain.value = 0.16 * pack.sub;
    if (this.square) this.square.type = pack.oscA === 'square' ? 'sawtooth' : 'square';
    this.applyLevels();
  }

  /**
   * Levels of the oscillator layers and of the recorded loop. The loop takes over the moment it
   * is both wanted (the pack has one) and playing; the oscillators then drop to a supporting
   * level. Called when the pack changes and when the loop starts, not every frame.
   */
  private applyLevels(): void {
    const layer = this.pack.sample;
    const live = Boolean(layer && this.sampleSrc);
    const synth = live && layer ? layer.synth : 1;
    this.synthLevel = synth;
    const now = this.ctx.currentTime;
    glide(this.sawGain.gain, 0.42 * synth, now, 0.08);
    glide(this.saw2Gain.gain, (this.isPlayer ? 0.2 : 0.12) * this.pack.oscBGain * synth, now, 0.08);
    if (this.squareGain) glide(this.squareGain.gain, 0.18 * synth, now, 0.08);
    if (this.sampleGain) glide(this.sampleGain.gain, live && layer ? layer.gain : 0, now, 0.08);
  }

  /** Builds the loop's three nodes and starts it. Once per voice: a pack without a loop only mutes it. */
  private startSample(buffer: AudioBuffer): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = ENGINE_LOOP_START;
    src.loopEnd = ENGINE_LOOP_END;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = 1800;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.Q.value = 0.7;
    presence.frequency.value = this.pack.sample?.presence0 ?? 700;
    presence.gain.value = this.pack.sample?.presenceDb ?? 0;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(presence);
    presence.connect(filter);
    filter.connect(gain);
    // After the clip, like the roar: the loop is the sound as recorded, not a signal to distort.
    gain.connect(this.engineGain);
    // Each kart starts somewhere else in the loop, or a grid of eight would pulse as one.
    src.start(0, ENGINE_LOOP_START + Math.random() * (ENGINE_LOOP_END - ENGINE_LOOP_START));
    this.sampleSrc = src;
    this.sampleFilter = filter;
    this.samplePresence = presence;
    this.sampleGain = gain;
    this.applyLevels();
  }

  /** Full (saw + square + sub) vs cheap (saw only) voice. */
  setRich(rich: boolean): void {
    if (this.disposed || rich === this.rich) return;
    this.rich = rich;
    const ctx = this.ctx;
    if (rich) {
      const now = ctx.currentTime;
      this.square = ctx.createOscillator();
      this.square.type = this.pack.oscA === 'square' ? 'sawtooth' : 'square';
      this.square.detune.value = 11;
      this.square.frequency.value = this.saw.frequency.value;
      this.squareGain = ctx.createGain();
      this.squareGain.gain.setValueAtTime(0, now);
      this.squareGain.gain.linearRampToValueAtTime(0.18 * this.synthLevel, now + 0.2);
      this.square.connect(this.squareGain);
      this.squareGain.connect(this.filter);
      this.square.start();

      this.sub = ctx.createOscillator();
      this.sub.type = 'sine';
      this.sub.frequency.value = this.saw.frequency.value * 0.5;
      this.subGain = ctx.createGain();
      this.subGain.gain.setValueAtTime(0, now);
      this.subGain.gain.linearRampToValueAtTime(0.16 * this.pack.sub, now + 0.2);
      this.sub.connect(this.subGain);
      this.subGain.connect(this.filter);
      this.sub.start();
    } else {
      this.stopExtras();
    }
  }

  private stopExtras(): void {
    const now = this.ctx.currentTime;
    const square = this.square;
    const squareGain = this.squareGain;
    const sub = this.sub;
    const subGain = this.subGain;
    if (square && squareGain) {
      squareGain.gain.setTargetAtTime(0, now, 0.05);
      square.stop(now + 0.3);
      square.onended = () => {
        square.disconnect();
        squareGain.disconnect();
      };
    }
    if (sub && subGain) {
      subGain.gain.setTargetAtTime(0, now, 0.05);
      sub.stop(now + 0.3);
      sub.onended = () => {
        sub.disconnect();
        subGain.disconnect();
      };
    }
    this.square = null;
    this.squareGain = null;
    this.sub = null;
    this.subGain = null;
  }

  update(dt: number, state: KartState, throttle: number, topSpeed: number): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const speed = Math.abs(state.speed);
    const ratio = clamp(speed / Math.max(1, topSpeed), 0, 1.4);

    // Gear selection with hysteresis so the note steps up through the box instead of sliding.
    let gear = this.gear;
    while (gear < GEAR_TOPS.length - 1 && ratio > GEAR_TOPS[gear] + 0.015) gear++;
    while (gear > 0 && ratio < GEAR_TOPS[gear - 1] - 0.03) gear--;
    if (gear !== this.gear) {
      this.gear = gear;
      this.shiftTimer = SHIFT_TIME;
    }
    const lo = gear === 0 ? 0 : GEAR_TOPS[gear - 1];
    const hi = GEAR_TOPS[gear];
    const inGear = clamp01((ratio - lo) / Math.max(0.01, hi - lo));
    // Each gear sweeps ~0.38 → 0.98 of the rev range; higher gears sit slightly higher.
    let target = ratio < 0.03 ? IDLE_RPM : 0.38 + 0.6 * inGear + gear * 0.01;
    target += 0.1 * clamp01(throttle) * (1 - inGear);
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      target *= 0.74; // clutch dip → the blip between gears
    }
    // Bouncing off the limiter in top gear / on the grid at full throttle.
    if (target > LIMITER_RPM && throttle > 0.9) {
      this.limiterPhase += dt * 26;
      target = LIMITER_RPM + 0.02 * Math.sin(this.limiterPhase * Math.PI * 2);
    }
    if (state.isFrozen) {
      const rev = clamp01(throttle) * (0.45 + 0.5 * clamp01(state.startCharge / 2.6));
      target = IDLE_RPM + rev;
      if (state.startCharge > 2.2) {
        this.limiterPhase += dt * 26;
        target = Math.min(target, LIMITER_RPM) + 0.02 * Math.sin(this.limiterPhase * Math.PI * 2);
      }
    }
    if (state.isAirborne) target = Math.max(target, Math.min(1.35, target + state.airTime * 0.7));
    if (state.isSpinning || state.isSquished) target *= 0.7;
    if (state.isBoosting) target = Math.max(target, 1.05);

    const lambda = this.shiftTimer > 0 ? 20 : target > this.rpm ? 7 : 9;
    this.rpm = damp(this.rpm, target, lambda, dt);
    this.voiceAt(now, this.rpm, throttle, state, speed, ratio);
  }

  /**
   * For tools that measure a voice: holds the revs at `rpm` (0..1) under `throttle`, with no
   * gearbox and no kart behind it. Not used by the game.
   */
  hold(rpm: number, throttle: number): void {
    if (this.disposed) return;
    this.rpm = rpm;
    this.voiceAt(this.ctx.currentTime, rpm, throttle, null, 0, 0);
  }

  /** Writes every parameter of the voice for these revs and this load. */
  private voiceAt(now: number, rpm: number, throttle: number, state: KartState | null, speed: number, ratio: number): void {
    const pack = this.pack;
    // The loop joins as soon as it has arrived and this pack wants it.
    const layer = pack.sample;
    if (layer && !this.sampleSrc) {
      const buffer = engineSample();
      if (buffer) this.startSample(buffer);
    }
    const pitchMul = state?.isShrunk ? 1.5 : 1;
    const freq = this.baseFreq * pack.pitch * (PITCH_LO + PITCH_SPAN * pack.span * rpm) * pitchMul;
    glide(this.saw.frequency, freq, now, 0.025);
    glide(this.saw2.frequency, freq * pack.oscBRatio, now, 0.025);
    if (this.square) glide(this.square.frequency, freq, now, 0.025);
    if (this.sub) glide(this.sub.frequency, freq * 0.5, now, 0.025);
    glide(this.filter.frequency, pack.cutoff0 + rpm * (pack.cutoff1 - pack.cutoff0), now, 0.05);
    glide(this.formant.frequency, pack.formant0 + rpm * (pack.formant1 - pack.formant0), now, 0.05);
    glide(this.formantGain.gain, (0.2 + 0.3 * rpm) * pack.formantGain * this.synthLevel, now, 0.08);
    if (layer && this.sampleSrc && this.sampleFilter) {
      const revs = clamp(rpm, 0, 1.35);
      // Heavier karts turn the same engine slower: the class's base pitch scales the loop too.
      const rate = (layer.rate0 + (layer.rate1 - layer.rate0) * revs) * (this.baseFreq / BASE_FREQ.medium) * pitchMul;
      glide(this.sampleSrc.playbackRate, rate, now, 0.03);
      glide(this.sampleFilter.frequency, layer.cutoff0 + revs * (layer.cutoff1 - layer.cutoff0), now, 0.05);
      if (this.samplePresence) glide(this.samplePresence.frequency, layer.presence0 + revs * (layer.presence1 - layer.presence0), now, 0.05);
    }

    // Roar tracks the firing frequency and opens up with load: off-throttle it drops back to a
    // murmur, which is what makes lifting for a corner audible.
    const roarLevel = pack.roar * (0.18 + 0.82 * clamp01(throttle)) * (0.35 + 0.65 * rpm);
    glide(this.roarFilter.frequency, Math.min(6000, freq * 1.7 + 120), now, 0.05);
    // Two thirds of the roar rides the firing pulses, one third sits under them as steady rush.
    glide(this.roarGain.gain, roarLevel * 0.34, now, 0.06);
    glide(this.firingDepth.gain, roarLevel * 0.66, now, 0.06);
    glide(this.firingOsc.frequency, freq, now, 0.025);

    const load = 0.5 + 0.5 * clamp01(throttle);
    const base = this.isPlayer ? 0.26 : 0.22;
    const vol = base * load * (0.6 + 0.4 * Math.min(1, rpm));
    glide(this.engineGain.gain, vol, now, 0.06);

    // Turbo whistle while boosting.
    const boosting = Boolean(state?.isBoosting);
    const turbo = boosting ? 0.11 * pack.turbo : 0;
    glide(this.turboGain.gain, turbo, now, 0.08);
    if (state && boosting) {
      const tf = 900 + rpm * 700 + clamp01(state.boostTimer) * 400;
      glide(this.turboOsc.frequency, tf, now, 0.06);
      glide(this.turboFilter.frequency, tf * 1.1, now, 0.06);
    }

    // Skid loop while drifting on the ground.
    const skid = state && state.isDrifting && !state.isAirborne ? 0.14 * clamp01(speed / 14) * (0.6 + 0.4 * Math.abs(state.steerVisual)) : 0;
    glide(this.skidGain.gain, skid, now, 0.06);
    if (skid > 0) {
      glide(this.skidSrc.playbackRate, 0.75 + 0.5 * clamp01(ratio), now, 0.08);
      glide(this.skidFilter.frequency, 1500 + ratio * 900, now, 0.08);
    }

    if (this.panner && state) {
      const p = state.position;
      setPannerPosition(this.panner, p.x, p.y, p.z);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, now, 0.03);
    this.stopExtras();
    const stopAt = now + 0.15;
    try {
      this.saw.stop(stopAt);
      this.saw2.stop(stopAt);
      this.turboOsc.stop(stopAt);
      this.turboNoise.stop(stopAt);
      this.roarSrc.stop(stopAt);
      this.firingOsc.stop(stopAt);
      this.skidSrc.stop(stopAt);
      this.sampleSrc?.stop(stopAt);
    } catch {
      // already stopped
    }
    const out = this.out;
    const panner = this.panner;
    this.saw.onended = () => {
      out.disconnect();
      panner?.disconnect();
    };
  }
}

export function setPannerPosition(panner: PannerNode, x: number, y: number, z: number): void {
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}

export function setListenerPose(
  listener: AudioListener,
  px: number, py: number, pz: number,
  fx: number, fy: number, fz: number,
  ux: number, uy: number, uz: number,
): void {
  if (listener.positionX) {
    listener.positionX.value = px;
    listener.positionY.value = py;
    listener.positionZ.value = pz;
    listener.forwardX.value = fx;
    listener.forwardY.value = fy;
    listener.forwardZ.value = fz;
    listener.upX.value = ux;
    listener.upY.value = uy;
    listener.upZ.value = uz;
  } else {
    listener.setPosition(px, py, pz);
    listener.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}
