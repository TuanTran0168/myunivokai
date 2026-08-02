import type { AmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import { randomFromSeed } from "@/lib/scene";
import { midiNumberToFrequencyHertz, nearestSampledNote, type LoadedInstrument } from "./instrumentSamples";

// --- Web Audio graph for one soundscape --------------------------------------
//
// Turns a deterministic recipe into live nodes. The numbers arrive already
// rolled and already clamped from lib/ambientSoundscape; the instrument samples
// arrive already decoded, so this module performs no I/O and the offline
// renderer can feed it buffers read from disk.
//
//   melody notes  ─┐
//   harmony notes ─┼─► toneFilter ─► panner ─┬─► dryBus ──────────────────┐
//                  │                         ├─► reverbInput ─► convolver ─► reverbReturn ─┤
//                  │                         └─► delayInput ─► delay ─► delayMix ──────────┼─► masterGain ─► destination
//                  │                                             └─► feedback ─┘           │
//   noise bed ─► bedFilter ─► bedGain ────────────────────────────────────────────────────┘
//
// There is no oscillator in the musical path at all. Two earlier versions built
// the pad and the notes from oscillators; both were rejected, the second as a
// harsh sustained tone. Harmonic body now comes from sparse rolled chords on a
// sampled instrument, which start, ring and stop like a real one.
//
// Scheduling uses the standard two-clock pattern: a coarse setInterval wakes up
// and schedules everything falling inside a short lookahead window against the
// audio clock, which is the only clock accurate enough to place a note.

const NOISE_BUFFER_SECONDS = 4;
const NOISE_BUFFER_CHANNEL_COUNT = 1;
const FIRST_CHANNEL_INDEX = 0;

const MAXIMUM_LFO_START_STAGGER_SECONDS = 6;
const LFO_STAGGER_SEED_SUFFIX = "-lfo-stagger";

const REVERB_CHANNEL_COUNT = 2;
const REVERB_DECAY_CURVE_POWER = 2.4;
const REVERB_SEED_SUFFIX = "-reverb";

const SCHEDULER_INTERVAL_MILLISECONDS = 250;
const SCHEDULER_LOOKAHEAD_SECONDS = 1.2;
// The room is established before anything is played into it, the way an ambient
// piece opens. Harmony enters first and the melody answers it.
const FIRST_HARMONY_DELAY_SECONDS = 1.5;
const FIRST_MELODY_DELAY_SECONDS = 4;

const TONE_FILTER_QUALITY = 0.5;
const MINIMUM_NOTE_VELOCITY = 0.6;
const NOTE_VELOCITY_SPREAD = 0.4;
const MAXIMUM_NOTE_PAN = 0.5;
const HARMONY_MAXIMUM_PAN = 0.28;
const GRACE_NOTE_DELAY_SECONDS = 0.19;
const GRACE_NOTE_LEVEL_RATIO = 0.6;
const GRACE_NOTE_SEMITONE_OFFSETS = [12, 7, -5];
const SEMITONES_PER_OCTAVE = 12;
// How far a recording may be pitch-shifted before it stops sounding like the
// instrument. Beyond this the note is folded by octaves instead.
const MAXIMUM_SAMPLE_STRETCH_SEMITONES = 7;

// A sample already carries its own attack and decay, so the only envelope it
// needs is a short lift off zero to avoid a click, and a release when the world
// goes away.
const SAMPLE_ATTACK_SECONDS = 0.012;
const HARMONY_ATTACK_SECONDS = 0.35;
const MINIMUM_ENVELOPE_LEVEL = 0.0001;
const STOP_RELEASE_SECONDS = 0.4;

export type AmbientSoundscapeGraph = {
  /** Fade out over `fadeSeconds`, then stop and release every node. */
  stop: (fadeSeconds: number) => void;
};

export type AmbientInstrumentSet = {
  melody: LoadedInstrument;
  harmony: LoadedInstrument;
};

function createSeededNoiseBuffer(audioContext: BaseAudioContext, noiseSeed: string): AudioBuffer {
  const frameCount = Math.floor(audioContext.sampleRate * NOISE_BUFFER_SECONDS);
  const noiseBuffer = audioContext.createBuffer(NOISE_BUFFER_CHANNEL_COUNT, frameCount, audioContext.sampleRate);
  const channelSamples = noiseBuffer.getChannelData(FIRST_CHANNEL_INDEX);
  const nextRandomValue = randomFromSeed(noiseSeed);
  for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
    channelSamples[sampleIndex] = nextRandomValue() * 2 - 1;
  }
  return noiseBuffer;
}

function createReverbImpulseResponse(
  audioContext: BaseAudioContext,
  decaySeconds: number,
  reverbSeed: string
): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * decaySeconds));
  const impulseResponse = audioContext.createBuffer(REVERB_CHANNEL_COUNT, frameCount, audioContext.sampleRate);
  const nextRandomValue = randomFromSeed(reverbSeed);
  for (let channelIndex = 0; channelIndex < REVERB_CHANNEL_COUNT; channelIndex += 1) {
    const channelSamples = impulseResponse.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
      const remainingRatio = 1 - sampleIndex / frameCount;
      channelSamples[sampleIndex] = (nextRandomValue() * 2 - 1) * Math.pow(remainingRatio, REVERB_DECAY_CURVE_POWER);
    }
  }
  return impulseResponse;
}

/**
 * Build and start a soundscape. The master gain begins at zero and ramps to the
 * recipe level over `fadeInSeconds`, so enabling sound never arrives as a click.
 */
export function createAmbientSoundscapeGraph(
  audioContext: AudioContext,
  recipe: AmbientSoundscapeRecipe,
  fadeInSeconds: number,
  instruments: AmbientInstrumentSet
): AmbientSoundscapeGraph {
  const startTime = audioContext.currentTime;
  const sustainedSources: AudioBufferSourceNode[] = [];
  const oscillatorSources: OscillatorNode[] = [];
  const activeNoteSources = new Set<AudioBufferSourceNode>();

  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0, startTime);
  masterGain.gain.linearRampToValueAtTime(recipe.masterGain, startTime + fadeInSeconds);
  masterGain.connect(audioContext.destination);

  const dryBus = audioContext.createGain();
  dryBus.connect(masterGain);

  const reverbConvolver = audioContext.createConvolver();
  reverbConvolver.buffer = createReverbImpulseResponse(
    audioContext,
    recipe.space.reverbDecaySeconds,
    `${recipe.performanceSeed}${REVERB_SEED_SUFFIX}`
  );
  const reverbInput = audioContext.createGain();
  const reverbReturn = audioContext.createGain();
  reverbReturn.gain.setValueAtTime(recipe.space.reverbWetMix, startTime);
  reverbInput.connect(reverbConvolver);
  reverbConvolver.connect(reverbReturn);
  reverbReturn.connect(masterGain);

  const delayInput = audioContext.createGain();
  const delayNode = audioContext.createDelay(recipe.space.delayTimeSeconds + 1);
  delayNode.delayTime.setValueAtTime(recipe.space.delayTimeSeconds, startTime);
  const delayFeedback = audioContext.createGain();
  delayFeedback.gain.setValueAtTime(recipe.space.delayFeedback, startTime);
  const delayMix = audioContext.createGain();
  delayMix.gain.setValueAtTime(recipe.space.delayMix, startTime);
  delayInput.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayMix);
  delayMix.connect(masterGain);
  // Echoes go back into the room too, or they arrive dry against a wet source
  // and read as an obviously artificial repeat.
  delayMix.connect(reverbInput);

  // One shared tone filter over both instrument layers. This is where the
  // scene's brightness lands: a dusk forest is genuinely darker, not just lower.
  const toneFilter = audioContext.createBiquadFilter();
  toneFilter.type = "lowpass";
  toneFilter.frequency.setValueAtTime(recipe.toneCutoffHertz, startTime);
  toneFilter.Q.setValueAtTime(TONE_FILTER_QUALITY, startTime);
  toneFilter.connect(dryBus);
  toneFilter.connect(reverbInput);
  toneFilter.connect(delayInput);

  // --- Environmental bed -----------------------------------------------------

  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = createSeededNoiseBuffer(audioContext, recipe.bedNoiseSeed);
  noiseSource.loop = true;

  const bedFilter = audioContext.createBiquadFilter();
  bedFilter.type = recipe.bedFilterType;
  bedFilter.frequency.setValueAtTime(recipe.bedFilterFrequencyHertz, startTime);
  bedFilter.Q.setValueAtTime(recipe.bedFilterQuality, startTime);

  const bedSweep = audioContext.createOscillator();
  bedSweep.type = "sine";
  bedSweep.frequency.setValueAtTime(recipe.bedSweepRateHertz, startTime);
  const bedSweepDepth = audioContext.createGain();
  bedSweepDepth.gain.setValueAtTime(recipe.bedSweepDepthHertz, startTime);
  bedSweep.connect(bedSweepDepth);
  bedSweepDepth.connect(bedFilter.frequency);

  const bedGain = audioContext.createGain();
  bedGain.gain.setValueAtTime(recipe.bedGain, startTime);

  // The bed stays dry. Reverberated noise is fog, and it buries the music.
  noiseSource.connect(bedFilter);
  bedFilter.connect(bedGain);
  bedGain.connect(masterGain);

  const nextStaggerValue = randomFromSeed(`${recipe.bedNoiseSeed}${LFO_STAGGER_SEED_SUFFIX}`);
  noiseSource.start(startTime);
  bedSweep.start(startTime + nextStaggerValue() * MAXIMUM_LFO_START_STAGGER_SECONDS);
  sustainedSources.push(noiseSource);
  oscillatorSources.push(bedSweep);

  // --- Performance -----------------------------------------------------------

  const nextPerformanceValue = randomFromSeed(recipe.performanceSeed);
  let currentChordSemitones = recipe.chordProgression.rootOffsetsSemitones[0] ?? 0;
  let chordStepIndex = 0;
  let nextMelodyTime = startTime + FIRST_MELODY_DELAY_SECONDS;
  let nextHarmonyTime = startTime + FIRST_HARMONY_DELAY_SECONDS;
  let nextChordChangeTime = startTime + recipe.chordProgression.changeIntervalSeconds;
  let hasStopped = false;

  /**
   * Octave-shift a note back into the range the instrument was actually sampled
   * across. A chord change can transpose the melody past the highest recording,
   * and stretching a sample much beyond an octave stops sounding like the
   * instrument at all. Dropping it an octave keeps it in the scale and in key.
   */
  function foldIntoSampledRange(instrument: LoadedInstrument, midiNumber: number): number {
    const lowestSampled = instrument.midiNumbers[0];
    const highestSampled = instrument.midiNumbers[instrument.midiNumbers.length - 1];
    let foldedMidiNumber = midiNumber;
    while (foldedMidiNumber > highestSampled + MAXIMUM_SAMPLE_STRETCH_SEMITONES) {
      foldedMidiNumber -= SEMITONES_PER_OCTAVE;
    }
    while (foldedMidiNumber < lowestSampled - MAXIMUM_SAMPLE_STRETCH_SEMITONES) {
      foldedMidiNumber += SEMITONES_PER_OCTAVE;
    }
    return foldedMidiNumber;
  }

  function playSampledNote(
    instrument: LoadedInstrument,
    requestedMidiNumber: number,
    noteStartTime: number,
    level: number,
    attackSeconds: number,
    maximumPan: number
  ): void {
    const midiNumber = foldIntoSampledRange(instrument, Math.round(requestedMidiNumber));
    const { sampleMidiNumber, playbackRate } = nearestSampledNote(instrument, midiNumber);
    const sampleBuffer = instrument.buffers.get(sampleMidiNumber);
    if (!sampleBuffer) {
      return;
    }
    const source = audioContext.createBufferSource();
    source.buffer = sampleBuffer;
    source.playbackRate.setValueAtTime(playbackRate, noteStartTime);

    const noteGain = audioContext.createGain();
    noteGain.gain.setValueAtTime(0, noteStartTime);
    noteGain.gain.linearRampToValueAtTime(level, noteStartTime + attackSeconds);

    const panner = audioContext.createStereoPanner();
    panner.pan.setValueAtTime((nextPerformanceValue() * 2 - 1) * maximumPan, noteStartTime);

    source.connect(noteGain);
    noteGain.connect(panner);
    panner.connect(toneFilter);
    source.start(noteStartTime);

    activeNoteSources.add(source);
    source.onended = () => {
      activeNoteSources.delete(source);
      panner.disconnect();
      noteGain.disconnect();
    };
  }

  function scheduleMelodyNoteAt(noteStartTime: number): void {
    const { scaleSemitones, octaveCount, rootMidiNumber } = recipe.melody;
    const octaveOffset = Math.floor(nextPerformanceValue() * octaveCount) * SEMITONES_PER_OCTAVE;
    const scaleDegree = scaleSemitones[Math.floor(nextPerformanceValue() * scaleSemitones.length)] ?? 0;
    // The melody follows the chord, or the two layers drift into different keys.
    const midiNumber = rootMidiNumber + currentChordSemitones + octaveOffset + scaleDegree;
    const level = recipe.melody.gain * (MINIMUM_NOTE_VELOCITY + nextPerformanceValue() * NOTE_VELOCITY_SPREAD);
    playSampledNote(instruments.melody, midiNumber, noteStartTime, level, SAMPLE_ATTACK_SECONDS, MAXIMUM_NOTE_PAN);

    if (nextPerformanceValue() < recipe.melody.graceNoteChance) {
      const graceOffset =
        GRACE_NOTE_SEMITONE_OFFSETS[Math.floor(nextPerformanceValue() * GRACE_NOTE_SEMITONE_OFFSETS.length)] ?? 12;
      playSampledNote(
        instruments.melody,
        midiNumber + graceOffset,
        noteStartTime + GRACE_NOTE_DELAY_SECONDS,
        level * GRACE_NOTE_LEVEL_RATIO,
        SAMPLE_ATTACK_SECONDS,
        MAXIMUM_NOTE_PAN
      );
    }
  }

  function scheduleHarmonyChordAt(chordStartTime: number): void {
    const { chordSemitones, rootMidiNumber, gain, spreadSeconds } = recipe.harmony;
    chordSemitones.forEach((chordInterval, chordVoiceIndex) => {
      playSampledNote(
        instruments.harmony,
        rootMidiNumber + currentChordSemitones + chordInterval,
        chordStartTime + chordVoiceIndex * spreadSeconds,
        gain * (MINIMUM_NOTE_VELOCITY + nextPerformanceValue() * NOTE_VELOCITY_SPREAD),
        HARMONY_ATTACK_SECONDS,
        HARMONY_MAXIMUM_PAN
      );
    });
  }

  function runScheduler(): void {
    const horizonTime = audioContext.currentTime + SCHEDULER_LOOKAHEAD_SECONDS;
    while (nextChordChangeTime < horizonTime) {
      chordStepIndex = (chordStepIndex + 1) % recipe.chordProgression.rootOffsetsSemitones.length;
      currentChordSemitones = recipe.chordProgression.rootOffsetsSemitones[chordStepIndex] ?? 0;
      nextChordChangeTime += recipe.chordProgression.changeIntervalSeconds;
    }
    while (nextHarmonyTime < horizonTime) {
      scheduleHarmonyChordAt(nextHarmonyTime);
      const harmonySpread = recipe.harmony.maximumGapSeconds - recipe.harmony.minimumGapSeconds;
      nextHarmonyTime += recipe.harmony.minimumGapSeconds + nextPerformanceValue() * harmonySpread;
    }
    while (nextMelodyTime < horizonTime) {
      scheduleMelodyNoteAt(nextMelodyTime);
      const melodySpread = recipe.melody.maximumGapSeconds - recipe.melody.minimumGapSeconds;
      nextMelodyTime += recipe.melody.minimumGapSeconds + nextPerformanceValue() * melodySpread;
    }
  }

  const schedulerIntervalId = setInterval(runScheduler, SCHEDULER_INTERVAL_MILLISECONDS);
  runScheduler();

  function stop(fadeSeconds: number): void {
    if (hasStopped) {
      return;
    }
    hasStopped = true;
    clearInterval(schedulerIntervalId);
    const stopRequestTime = audioContext.currentTime;
    const silenceTime = stopRequestTime + fadeSeconds;
    // cancelScheduledValues alone would leave the param wherever the cancelled
    // ramp had reached being re-read as the ramp's start value; anchoring at the
    // current value first makes the fade start from what is actually audible.
    masterGain.gain.cancelScheduledValues(stopRequestTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, stopRequestTime);
    masterGain.gain.linearRampToValueAtTime(MINIMUM_ENVELOPE_LEVEL, silenceTime);
    for (const source of sustainedSources) {
      source.stop(silenceTime);
    }
    for (const oscillator of oscillatorSources) {
      oscillator.stop(silenceTime);
    }
    // Notes already scheduled past the fade would otherwise keep the context
    // busy long after the world has gone.
    for (const noteSource of activeNoteSources) {
      noteSource.stop(silenceTime + STOP_RELEASE_SECONDS);
    }
    const releaseSource = sustainedSources[sustainedSources.length - 1];
    if (releaseSource) {
      releaseSource.onended = () => masterGain.disconnect();
    }
  }

  return { stop };
}
