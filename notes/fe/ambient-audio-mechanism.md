# Ambient audio — how the music is generated and how to audition it

> **Document status:** Active mechanism reference
> **Last source review:** 2026-08-02

Every world plays music generated from its seed. The composition is procedural
and costs nothing per world; the *sound* comes from recorded instruments. A new
variant is free to hear, and the same seed sounds the same forever.
`Math.random()` is banned here exactly as it is in scene code.

## Three attempts, and why the first two failed

This is the part worth reading. Both failures were shipped with a green test
suite, and both were caught by a person listening.

**1. Oscillator pad, low register.** Every voice sat between 47 and 106 Hz with
the noise bed lowpassed to 170–320 Hz. Correct on studio monitors, *silent* on
the laptop and phone speakers people actually use, which roll off steeply below
~150 Hz. 36 tests passed: they checked determinism and numeric bounds and never
asked whether the output landed where a speaker can reproduce it.

**2. Oscillator pad raised, plus synthesised bell/pluck notes.** Reported as a
long painful sustained tone whose layers never blended. Rendering the three
layers in isolation measured why: the pad was **0.052 RMS against the melody's
0.012** — four times louder than the notes it was supposed to sit under. A
continuous oscillator at that level is the "eeeee", and no amount of note-writing
survives underneath it.

**3. Recorded instruments.** No sustained oscillator anywhere in the musical
path. This is the same lesson [3d-development-limitations.md](3d-development-limitations.md)
already recorded for the visuals: *the algorithm is the cheap part; the asset
decides whether the result is beautiful.* Oscillator synthesis is the audio
equivalent of a chair built out of boxes.

## The two halves

| File | Purity | Job |
| --- | --- | --- |
| [`lib/ambientSoundscape.ts`](../../apps/myunivokai-web/src/lib/ambientSoundscape.ts) | Pure | Rolls a numeric recipe from the seed and the scene config. Unit-testable in node. |
| [`features/audio/instrumentSamples.ts`](../../apps/myunivokai-web/src/features/audio/instrumentSamples.ts) | I/O | Sample catalog, fetch, decode, nearest-note lookup. |
| [`features/audio/ambientSoundscapeGraph.ts`](../../apps/myunivokai-web/src/features/audio/ambientSoundscapeGraph.ts) | Impure | Turns a recipe plus decoded buffers into Web Audio nodes and performs it. Performs **no I/O**, which is what lets the offline renderer feed it buffers from disk. |
| [`features/audio/useAmbientSoundscape.ts`](../../apps/myunivokai-web/src/features/audio/useAmbientSoundscape.ts) | Impure | AudioContext lifecycle, gesture gate, sample loading, crossfade on scene change. |

## What is playing

1. **Melody** — single notes at irregular gaps from a pentatonic or hexatonic
   scale, on a sampled instrument.
2. **Harmony** — sparse rolled chords an octave below, on a *different*, softer
   sampled instrument. This is what replaced the drone: harmonic body without
   anything sustaining indefinitely.
3. **Bed** — looping seeded noise through a lowpass (universe: air) or bandpass
   (forest: wind in foliage). Stays dry; reverberated noise is fog.
4. **Space** — convolution reverb from a generated impulse response, plus a
   feedback delay. Without these, synthesis of any kind reads as clinical.

Seven CC0 instruments: piano, harp, glockenspiel, vibraphone, kalimba, recorder,
saxello. See [ATTRIBUTION.md](../../apps/myunivokai-web/public/assets/audio/ATTRIBUTION.md).

Scales are five or six notes to the octave so notes drawn in any order stay
consonant. They are *not* semitone-free — kumoi and dorian each contain one minor
second, and that interval is what gives them their character.

## What the DNA controls

The same ProfileDNA that reaches the eyes reaches the ears:

| From the scene config | Becomes |
| --- | --- |
| Planet / landmark count | How many notes in each harmony chord |
| Their average energy | How often notes fall, and how bright the tone filter sits |
| Universe `theme` | Instrument, scale, and the colour of the bed |
| Forest `weather` + `intensity` | Instrument, and the bed's level and width |
| Forest `lighting.timeOfDay` | How far the key is transposed down |
| Forest `season` | The scale |
| `postFX.bloomIntensity` | How open the tone filter sits |

## Constraints that are not negotiable

**Register.** Two floors, because a recording is not a sine. A sine at 110 Hz on
a laptop speaker is silence — there is nothing but the fundamental. A recorded
harp at the same pitch carries partials at 220, 330, 440 Hz and the ear
reconstructs the fundamental from them. So the melody clears MIDI 52 (~165 Hz)
and the harmony, which only supports, may sit at MIDI 43 (~98 Hz).

**Gesture.** A browser will not emit audio before the visitor has interacted with
the document. The AudioContext is constructed inside the click handler, never in
an effect. Ambience defaults to on, which is *not* autoplay — the hook arms the
first gesture, which on a world page is the first orbit-drag.

**Sample stretch.** A recording pitch-shifted more than about a fifth stops
sounding like the instrument. The graph folds any note further out by octaves
rather than stretching it.

## Auditioning it — the only way to know it sounds good

Topology tests prove the graph is wired correctly. They cannot tell you it is
music; twice the audio shipped verified-and-wrong. Render it and listen:

```powershell
cd apps/myunivokai-web
npm install --no-save node-web-audio-api
npx vitest run <path-to>/renderAmbientPreview.test.ts --disable-console-intercept
```

The renderer drives the **real** graph module against a Node implementation of
Web Audio and writes WAV files. Two tricks make offline rendering work:

- The graph schedules against `audioContext.currentTime` on a `setInterval`.
  Offline rendering has no wall clock, so the interval callback is captured and
  driven by hand.
- `currentTime` is shadowed with an own property on the context instance. A
  `Proxy` breaks the library's private class fields.

`node-web-audio-api` and `@breezystack/lamejs` are installed `--no-save` on
purpose: they are development aids, not runtime or CI dependencies. Installing
one `--no-save` package prunes a previously `--no-save`-installed one, so install
both in the same command.

### Measure, do not just listen

Each of these found a fault that reading the code did not:

- **Layer isolation.** Render with each layer's gain zeroed. This is what proved
  the pad was 4.3x the melody.
- **Onset count via spectral flux.** An RMS envelope is useless here — a
  continuous layer under a long reverb tail looks flat no matter how many notes
  play. Spectral flux found that a soft-attack instrument was producing *one*
  detectable onset in 37 seconds.
- **Band balance.** Rain weather once measured 52% of all energy above 1200 Hz:
  hiss burying the music it was supposed to sit under.
- **Per-instrument RMS.** A sustained reed holds its level for three seconds
  where a plucked kalimba is gone in one, so equal gains are not equal loudness.
  The spread was 3x before the measured `INSTRUMENT_LEVEL_TRIM` table.
