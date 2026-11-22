// What an engine voice sounds like, in numbers: nobody on this side of the screen can hear it.
//
//   node tools/engine-spectrum.mjs [http://localhost:5178] [--wav <dir>]
//
// Needs the dev server (it imports src/audio/engine.ts in the page). Each voice is rendered with
// an OfflineAudioContext — the real EngineVoice graph, held at fixed revs with full throttle —
// for three seconds, and the last two are analysed:
//   * rms      level, dB re full scale
//   * centroid where the energy sits on average (power-weighted mean frequency)
//   * 0.4-2k   share between 400 Hz and 2 kHz: what a phone speaker, which has no bass, plays of it
//   * >=2 kHz  share of the energy at and above 2 kHz: the "shrill" band
//   * >=4 kHz  the same from 4 kHz
//   * peak     the strongest single component
//   * note     the fundamental the voice is asked to play (oscillators), or the loop's pulse rate
//
// Voices: the stock voice of each weight class before (`old`), the stock voice now with its
// recorded loop (`new`), the same before the loop has loaded (`new, synth only`), and each engine
// pack. --wav writes every render as a 16-bit WAV so a person can listen.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const puppeteer = createRequire('file:///Users/hytae/Downloads/cryzen-downloader/')('puppeteer');

const argv = process.argv.slice(2);
const wavAt = argv.indexOf('--wav');
const WAV = wavAt >= 0 ? argv[wavAt + 1] : null;
const BASE = argv.find((a, i) => !a.startsWith('--') && i !== wavAt + 1) || 'http://localhost:5178';
if (WAV) mkdirSync(WAV, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });

/** Renders and measures in a page loaded with `query` (the old stock voices are behind `?engine=old`). */
async function measure(query, jobs) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('[pageerror]', e.message));
  await page.goto(`${BASE}/?lobby${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__turboKartRush, { timeout: 60000 });
  const out = await page.evaluate(async (jobs, wantWav) => {
    const { EngineVoice } = await import('/src/audio/engine.ts');
    const sampleMod = await import('/src/audio/engineSample.ts');
    const urlMod = await import('/src/assets/audio/exhaust-loop.mp3?url');
    const SR = 44100;
    const SECONDS = 3;
    const decodeCtx = new OfflineAudioContext(1, SR, SR);
    const loop = await decodeCtx.decodeAudioData(await (await fetch(urlMod.default)).arrayBuffer());

    // Radix-2 FFT, in place.
    const fft = (re, im) => {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          [re[i], re[j]] = [re[j], re[i]];
          [im[i], im[j]] = [im[j], im[i]];
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const a = i + k, b = a + len / 2;
            const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr; im[a] += xi;
            const t = cr * wr - ci * wi;
            ci = cr * wi + ci * wr;
            cr = t;
          }
        }
      }
    };
    const analyse = (x) => {
      const N = 16384;
      const P = new Float64Array(N / 2 + 1);
      let frames = 0;
      for (let at = SR; at + N <= x.length; at += N / 2) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
        fft(re, im);
        for (let k = 0; k <= N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
        frames++;
      }
      let total = 0, weighted = 0, hi2 = 0, hi4 = 0, mid = 0, peakK = 1;
      // From 20 Hz: below that is DC and rumble no speaker plays.
      for (let k = Math.ceil((20 * N) / SR); k <= N / 2; k++) {
        const f = (k * SR) / N;
        total += P[k];
        weighted += f * P[k];
        if (f >= 400 && f < 2000) mid += P[k];
        if (f >= 2000) hi2 += P[k];
        if (f >= 4000) hi4 += P[k];
        if (P[k] > P[peakK]) peakK = k;
      }
      let sq = 0, peak = 0;
      for (let i = SR; i < x.length; i++) {
        sq += x[i] * x[i];
        peak = Math.max(peak, Math.abs(x[i]));
      }
      return {
        rmsDb: 10 * Math.log10(sq / (x.length - SR) + 1e-12),
        peak,
        centroid: weighted / total,
        mid: mid / total,
        hi2: hi2 / total,
        hi4: hi4 / total,
        peakHz: (peakK * SR) / N,
        frames,
      };
    };
    const wav = (x) => {
      const out = new Uint8Array(44 + x.length * 2);
      const v = new DataView(out.buffer);
      const put = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      put(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); put(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      put(36, 'data'); v.setUint32(40, x.length * 2, true);
      for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
      let s = '';
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return btoa(s);
    };

    const results = [];
    for (const job of jobs) {
      sampleMod.setEngineSample(job.loop ? loop : null);
      for (const rpm of job.rpms) {
        const ctx = new OfflineAudioContext(1, SR * SECONDS, SR);
        const voice = new EngineVoice(ctx, ctx.destination, 0, job.weight, true);
        if (job.pack) voice.setPack(job.pack);
        voice.hold(rpm, 1);
        const rendered = await ctx.startRendering();
        const x = rendered.getChannelData(0);
        const pack = voice.pack;
        const base = voice.baseFreq;
        const live = Boolean(voice.sampleSrc);
        results.push({
          label: job.label,
          rpm,
          ...analyse(x),
          note: live
            ? `loop ${(11.63 * (pack.sample.rate0 + (pack.sample.rate1 - pack.sample.rate0) * rpm) * (base / 130)).toFixed(1)} pulses/s over ${(base * pack.pitch * (0.55 + 5.2 * pack.span * rpm)).toFixed(0)} Hz`
            : `${(base * pack.pitch * (0.55 + 5.2 * pack.span * rpm)).toFixed(0)} Hz`,
          wav: wantWav ? wav(x) : null,
        });
      }
    }
    sampleMod.setEngineSample(null);
    return results;
  }, jobs, Boolean(WAV));
  await page.close();
  return out;
}

const RPMS = [0.2, 0.6, 1.0];
const before = await measure('&engine=old', [
  { label: 'old stock, light (electric)', weight: 'light', rpms: RPMS },
  { label: 'old stock, medium (scream)', weight: 'medium', rpms: RPMS },
  { label: 'old stock, heavy (rumble)', weight: 'heavy', rpms: RPMS },
]);
const after = await measure('', [
  { label: 'new stock, light', weight: 'light', loop: true, rpms: RPMS },
  { label: 'new stock, medium', weight: 'medium', loop: true, rpms: RPMS },
  { label: 'new stock, heavy', weight: 'heavy', loop: true, rpms: RPMS },
  { label: 'new stock, medium, synth only', weight: 'medium', loop: false, rpms: RPMS },
  ...['rumble', 'electric', 'diesel', 'turbine', 'chiptune'].map((pack) => ({ label: `pack ${pack} (medium)`, weight: 'medium', pack, rpms: RPMS })),
]);

console.log('voice                            revs   rms dB  peak  centroid  0.4-2k  >=2kHz  >=4kHz  strongest  asked to play');
for (const r of [...before, ...after]) {
  console.log(
    `${r.label.padEnd(32)} ${r.rpm.toFixed(1).padStart(4)}  ${r.rmsDb.toFixed(1).padStart(6)}  ${r.peak.toFixed(2)}  ${(r.centroid.toFixed(0) + ' Hz').padStart(8)}  ${(100 * r.mid).toFixed(1).padStart(5)}%  ${(100 * r.hi2).toFixed(1).padStart(5)}%  ${(100 * r.hi4).toFixed(1).padStart(5)}%  ${(r.peakHz.toFixed(0) + ' Hz').padStart(9)}  ${r.note}`,
  );
  if (WAV) writeFileSync(`${WAV}/${r.label.replace(/[^a-z0-9]+/gi, '-')}-${r.rpm}.wav`, Buffer.from(r.wav, 'base64'));
}
await browser.close();
