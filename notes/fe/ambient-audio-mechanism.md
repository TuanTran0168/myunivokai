# Ambient audio — how the music is generated and how to audition it

> **Document status:** Active mechanism reference
> **Last source review:** 2026-08-02

Every world plays procedurally generated music. No audio files, no library, no
AI call: a new variant costs nothing to hear, and the same seed sounds the same
forever. `Math.random()` is banned here exactly as it is in scene code.

## The two halves

| File | Purity | Job |
| --- | --- | --- |
| [`lib/ambientSoundscape.ts`](../../apps/myunivokai-web/src/lib/ambientSoundscape.ts) | Pure | Rolls a numeric recipe from the seed and the scene config. Unit-testable in node. |
| [`features/audio/ambientSoundscapeGraph.ts`](../../apps/myunivokai-web/src/features/audio/ambientSoundscapeGraph.ts) | Impure | Turns a recipe into Web Audio nodes and performs it. |
| [`features/audio/useAmbientSoundscape.ts`](../../apps/myunivokai-web/src/features/audio/useAmbientSoundscape.ts) | Impure | AudioContext lifecycle, gesture gate, crossfade on scene change. |

Same split as the scene builders: all the decisions are in the testable half.

## What is actually playing

Four layers. The first version shipped with only the first two, which is why it
was described as a drone and as funeral music — both fair.

1. **Pad** — three to five detuned oscillators, each with its own slow breath
   LFO, through a lowpass. This is the floor, not the piece; its level sits
   deliberately under the melody.
2. **Bed** — looping seeded noise through a lowpass (universe: air) or bandpass
   (forest: wind in foliage). Stays dry: reverberated noise is fog and buries
   everything above it.
3. **Melody** — short notes at irregular gaps from a pentatonic or hexatonic
   scale, on one of four instruments. This is the layer that makes it music.
4. **Space** — convolution reverb plus a feedback delay. Without these the
   synthesis reads as hard and clinical no matter how good the notes are.

Scales are five or six notes with no semitone clashes, so notes drawn in any
order stay consonant — which is what makes an unattended generator safe to leave
running. The pad also glides through a chord progression rather than holding one
chord forever.

Instruments are genuinely different synths, not one synth re-filtered:

| Instrument | Construction |
| --- | --- |
| `bell` | Inharmonic partials (1, 2.76, 5.4) plus FM whose modulation index decays |
| `glass` | Near-harmonic partials (1, 2, 3.01), soft attack, very long tail |
| `marimba` | Partials (1, 4, 9.2) with the upper ones gone almost immediately |
| `pluck` | Two detuned sawtooths through a lowpass that slams shut |

## What the DNA controls

The same ProfileDNA that reaches the eyes reaches the ears:

| From the scene config | Becomes |
| --- | --- |
| Planet / landmark count | How many voices the pad chord has |
| Their average energy | Pad brightness, breath rate, how often notes fall |
| Universe `theme` | Root pitch, bed colour, instrument, scale |
| Forest `weather` + `intensity` | Bed level and width |
| Forest `lighting.timeOfDay` | How far the pad drops and dulls |
| Forest `season` | Scale, and how full the chord stays |
| `postFX.bloomIntensity` | How open the pad filter sits |

## Two constraints that are not negotiable

**Register.** Laptop and phone speakers roll off steeply below ~150 Hz. The
first version put the whole universe pad at 47–106 Hz: correct on studio
monitors, silent on real hardware, and every unit test passed because none of
them asked where the energy landed. Roots now sit at or above 98 Hz and every
interval stack reaches at least an octave above its root. The audibility sweep in
`ambientSoundscape.test.ts` is the guard; it caught a second instance of the same
bug within minutes of being written.

**Gesture.** A browser will not emit audio before the visitor has interacted
with the document. The AudioContext is therefore constructed inside the click
handler, never in an effect. Ambience defaults to on, which does not mean
autoplay — it means the hook arms the first gesture, which on a world page is the
first orbit-drag.

## Auditioning it — the only way to know it sounds good

Topology tests prove the graph is wired correctly. They cannot tell you it is
music. Twice now the audio shipped verified-and-wrong, so render it and listen:

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

`node-web-audio-api` is installed with `--no-save` on purpose: it is a
development aid, not a runtime or CI dependency.

Worth measuring on the rendered files, because ears alone miss it:

- **Band balance.** Rain weather was once measured at 52% of all energy above
  1200 Hz — hiss burying the music it was supposed to sit under.
- **Onset count via spectral flux.** RMS envelope is useless here; a continuous
  pad under a long reverb tail looks flat no matter how many notes play. Spectral
  flux found that `glass` produced one detectable onset in 37 seconds, because
  its 90 ms attack dissolved every note into the pad.
