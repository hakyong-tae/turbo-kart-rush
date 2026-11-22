# Audio credits

Everything audible in the game is synthesised at run time, with one exception.

## exhaust-loop.mp3

The body of the stock engine voice (`src/audio/engineSample.ts`, `src/audio/engine.ts`).

- **Source**: soundeffectgenerator.org, the "rider kart sound effect" page
  (`/sound-effects/rider-kart-sound-effect`): one of the AI-generated effects listed there
  (file id `ef6568c2`, described on the page as a rider kart engine slowing to a stop).
- **Licence**: commercial use under the site's paid plan. The owner of this project confirmed the
  commercial licence himself on 2026-11-22; that confirmation is the basis for shipping it.
  The site's own wording is that commercial rights depend on the model, the plan and the licence
  of the source audio, so anyone redistributing this repository should check their own position.
- **Not used**: the clips on the same page under `instants/…` (named after other companies'
  games and shows). They are third-party property and were never downloaded.
- **What was done to it**: 1.375 s to 3.326 s of the original (the stretch where the exhaust
  pulses are even) was cut into a seamless loop with a 50 ms crossfade and normalised to a peak
  of 0.7, then padded with 0.3 s of itself at either end for decoders that shift the audio.
  Mono, 44.1 kHz, 64 kbps, 21 KB. `python3 tools/engine-loop.py <in.mp3> <out.wav> 1.3 3.9 2.0`
  remakes the loop (needs ffmpeg); the original clip is not in the repository.
- **In the game**: loop points 0.3 s and 2.2511 s; 11.63 exhaust pulses a second at rate 1;
  played at 0.8 to 2.0 times that with the revs, under a lowpass and with a lift around 1 kHz.
