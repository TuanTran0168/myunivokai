import { semitoneRatio, type AmbientInstrument, type AmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import { randomFromSeed } from "@/lib/scene";

// --- Web Audio graph for one soundscape --------------------------------------
//
// Turns a deterministic recipe into live nodes. This is the impure half; the
// numbers all arrive already rolled and already clamped from lib/ambientSoundscape.
//
//   pad oscillators ─► droneFilter ──┐
//   noise ─► bedFilter ─► bedGain ───┤
//                                    ├─► dryBus ────────────────┐
//   scheduled notes ─► panner ───────┤                          │
//         │                          └─► reverbInput ─► convolver ─► reverbReturn ─┤
//         └─────────────────────────────► delayInput ─► delay ─► delayMix ─────────┼─► masterGain ─► destination
//                                                        └─► feedback ─┘           │
//
// Three things here are what separate music from a drone, and all three were
// missing from the first version:
//
// 1. NOTES. A scheduler places short notes from a pentatonic or hexatonic scale
//    at irregular gaps. A sustained chord with no events in it is a drone.
// 2. SPACE. A convolution reverb and a feedback delay. Dry synthesis reads as
//    hard and clinical no matter how good the notes are — the tail is what
//    makes separate notes sound like one piece of music.
// 3. MOVEMENT. The pad glides between the chords of a progression instead of
//    holding one chord forever.
//
// Scheduling uses the standard two-clock pattern: a coarse setInterval wakes up
// and schedules everything falling inside a short lookahead window against the
// audio clock, which is the only clock accurate enough to place a note.

const NOISE_BUFFER_SECONDS = 4;
const NOISE_BUFFER_CHANNEL_COUNT = 1;
const FIRST_CHANNEL_INDEX = 0;

const BREATH_MIDPOINT_RATIO = 0.5;
const MAXIMUM_LFO_START_STAGGER_SECONDS = 6;
const LFO_STAGGER_SEED_SUFFIX = "-lfo-stagger";

// Reverb impulse response: decaying noise, which is the cheapest convincing
// room there is. Stereo, because a mono tail collapses the image to the centre.
const REVERB_CHANNEL_COUNT = 2;
const REVERB_DECAY_CURVE_POWER = 2.4;
const REVERB_SEED_SUFFIX = "-reverb";
// The pad goes into the reverb quieter than the notes: a fully wet pad turns
// into fog and swallows everything above it.
const PAD_REVERB_SEND = 0.55;

const SCHEDULER_INTERVAL_MILLISECONDS = 250;
const SCHEDULER_LOOKAHEAD_SECONDS = 1.2;
// Notes do not begin the moment the sound does; the pad establishes itself
// first, the way an ambient piece opens.
const FIRST_NOTE_DELAY_SECONDS = 3.5;

const NOTE_ATTACK_SECONDS = 0.004;
// Glass is bowed rather than struck, but a 90ms attack measured at only one
// detectable onset in 37 seconds: the notes were dissolving into the pad
// instead of sitting on it. Soft enough to read as bowed, fast enough to be an
// event.
const SOFT_NOTE_ATTACK_SECONDS = 0.035;
// exponentialRampToValueAtTime cannot reach zero, so the envelope lands here.
const MINIMUM_ENVELOPE_LEVEL = 0.0001;
const NOTE_RELEASE_PADDING_SECONDS = 0.08;
const MINIMUM_NOTE_VELOCITY = 0.55;
const NOTE_VELOCITY_SPREAD = 0.45;
const MAXIMUM_NOTE_PAN = 0.55;
const GRACE_NOTE_DELAY_SECONDS = 0.19;
const GRACE_NOTE_LEVEL_RATIO = 0.6;
const GRACE_NOTE_SEMITONE_OFFSETS = [12, 7, -5];

// Partial sets. A timbre is its harmonic content and its envelope, so each
// instrument is a genuinely different stack rather than one synth re-filtered.
type PartialSpecification = {
  frequencyRatio: number;
  gainRatio: number;
  /** Upper partials die first, which is what makes a struck sound read as struck. */
  decayRatio: number;
};

const INSTRUMENT_PARTIALS: Record<AmbientInstrument, PartialSpecification[]> = {
  // Struck metal: inharmonic partials, long ring.
  bell: [
    { frequencyRatio: 1, gainRatio: 1, decayRatio: 1 },
    { frequencyRatio: 2.76, gainRatio: 0.3, decayRatio: 0.55 },
    { frequencyRatio: 5.4, gainRatio: 0.11, decayRatio: 0.3 }
  ],
  // Bowed glass: near-harmonic, soft attack, very long tail.
  glass: [
    { frequencyRatio: 1, gainRatio: 1, decayRatio: 1 },
    { frequencyRatio: 2, gainRatio: 0.34, decayRatio: 0.85 },
    { frequencyRatio: 3.01, gainRatio: 0.14, decayRatio: 0.6 }
  ],
  // Wooden bar: strong fourth-octave partial, gone almost immediately.
  marimba: [
    { frequencyRatio: 1, gainRatio: 1, decayRatio: 1 },
    { frequencyRatio: 4, gainRatio: 0.24, decayRatio: 0.22 },
    { frequencyRatio: 9.2, gainRatio: 0.07, decayRatio: 0.1 }
  ],
  // Pluck is built from a filtered sawtooth instead of partials; this entry is
  // the fallback if its filter path is ever bypassed.
  pluck: [{ frequencyRatio: 1, gainRatio: 1, decayRatio: 1 }]
};

// Bell uses frequency modulation on top of its partials — the modulation index
// falling away is what a real bell's clang does.
const BELL_MODULATOR_RATIO = 3.5;
const BELL_MODULATION_INDEX = 1.6;
const BELL_MODULATION_DECAY_RATIO = 0.28;

// Pluck: a sawtooth whose lowpass slams shut. Two detuned oscillators give it
// body a single one does not have.
const PLUCK_DETUNE_CENTS = 6;
const PLUCK_FILTER_OPEN_RATIO = 9;
const PLUCK_FILTER_CLOSED_RATIO = 2.2;
const PLUCK_FILTER_SWEEP_RATIO = 0.35;
const PLUCK_FILTER_QUALITY = 1.4;

export type AmbientSoundscapeGraph = {
  /** Fade out over `fadeSeconds`, then stop and release every node. */
  stop: (fadeSeconds: number) => void;
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
      channelSamples[sampleIndex] =
        (nextRandomValue() * 2 - 1) * Math.pow(remainingRatio, REVERB_DECAY_CURVE_POWER);
    }
  }
  return impulseResponse;
}

/**
 * Envelope shared by every instrument: near-instant or soft attack, then an
 * exponential decay, which is what a struck or plucked body actually does.
 */
function applyNoteEnvelope(
  gainParameter: AudioParam,
  peakLevel: number,
  startTime: number,
  attackSeconds: number,
  decaySeconds: number
): void {
  gainParameter.setValueAtTime(0, startTime);
  gainParameter.linearRampToValueAtTime(peakLevel, startTime + attackSeconds);
  gainParameter.exponentialRampToValueAtTime(MINIMUM_ENVELOPE_LEVEL, startTime + decaySeconds);
}

type NoteVoice = { sources: OscillatorNode[]; endTime: number };

function createPartialNoteVoice(
  audioContext: AudioContext,
  instrument: AmbientInstrument,
  frequencyHertz: number,
  startTime: number,
  decaySeconds: number,
  noteOutput: GainNode
): NoteVoice {
  const partials = INSTRUMENT_PARTIALS[instrument];
  const attackSeconds = instrument === "glass" ? SOFT_NOTE_ATTACK_SECONDS : NOTE_ATTACK_SECONDS;
  const sources: OscillatorNode[] = [];

  for (const partial of partials) {
    const partialOscillator = audioContext.createOscillator();
    partialOscillator.type = "sine";
    partialOscillator.frequency.setValueAtTime(frequencyHertz * partial.frequencyRatio, startTime);

    const partialGain = audioContext.createGain();
    applyNoteEnvelope(
      partialGain.gain,
      partial.gainRatio,
      startTime,
      attackSeconds,
      decaySeconds * partial.decayRatio
    );
    partialOscillator.connect(partialGain);
    partialGain.connect(noteOutput);
    partialOscillator.start(startTime);
    sources.push(partialOscillator);
  }

  if (instrument === "bell") {
    const modulator = audioContext.createOscillator();
    modulator.type = "sine";
    modulator.frequency.setValueAtTime(frequencyHertz * BELL_MODULATOR_RATIO, startTime);
    const modulationDepth = audioContext.createGain();
    applyNoteEnvelope(
      modulationDepth.gain,
      frequencyHertz * BELL_MODULATION_INDEX,
      startTime,
      NOTE_ATTACK_SECONDS,
      decaySeconds * BELL_MODULATION_DECAY_RATIO
    );
    modulator.connect(modulationDepth);
    // Onto the fundamental only: modulating every partial turns a bell into noise.
    modulationDepth.connect(sources[0].frequency);
    modulator.start(startTime);
    sources.push(modulator);
  }

  return { sources, endTime: startTime + decaySeconds + NOTE_RELEASE_PADDING_SECONDS };
}

function createPluckNoteVoice(
  audioContext: AudioContext,
  frequencyHertz: number,
  startTime: number,
  decaySeconds: number,
  noteOutput: GainNode
): NoteVoice {
  const pluckFilter = audioContext.createBiquadFilter();
  pluckFilter.type = "lowpass";
  pluckFilter.Q.setValueAtTime(PLUCK_FILTER_QUALITY, startTime);
  pluckFilter.frequency.setValueAtTime(frequencyHertz * PLUCK_FILTER_OPEN_RATIO, startTime);
  pluckFilter.frequency.exponentialRampToValueAtTime(
    frequencyHertz * PLUCK_FILTER_CLOSED_RATIO,
    startTime + decaySeconds * PLUCK_FILTER_SWEEP_RATIO
  );

  const bodyGain = audioContext.createGain();
  applyNoteEnvelope(bodyGain.gain, 1, startTime, NOTE_ATTACK_SECONDS, decaySeconds);
  pluckFilter.connect(bodyGain);
  bodyGain.connect(noteOutput);

  const sources: OscillatorNode[] = [];
  for (const detuneCents of [-PLUCK_DETUNE_CENTS, PLUCK_DETUNE_CENTS]) {
    const stringOscillator = audioContext.createOscillator();
    stringOscillator.type = "sawtooth";
    stringOscillator.frequency.setValueAtTime(frequencyHertz, startTime);
    stringOscillator.detune.setValueAtTime(detuneCents, startTime);
    stringOscillator.connect(pluckFilter);
    stringOscillator.start(startTime);
    sources.push(stringOscillator);
  }

  return { sources, endTime: startTime + decaySeconds + NOTE_RELEASE_PADDING_SECONDS };
}

/**
 * Build and start a soundscape. The master gain begins at zero and ramps to the
 * recipe level over `fadeInSeconds`, so enabling sound never arrives as a click.
 */
export function createAmbientSoundscapeGraph(
  audioContext: AudioContext,
  recipe: AmbientSoundscapeRecipe,
  fadeInSeconds: number
): AmbientSoundscapeGraph {
  const startTime = audioContext.currentTime;
  const sustainedSources: Array<OscillatorNode | AudioBufferSourceNode> = [];

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
  // Echoes are fed back into the room too, or they arrive dry against a wet
  // source and read as a separate, obviously artificial repeat.
  delayMix.connect(reverbInput);

  const droneFilter = audioContext.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.setValueAtTime(recipe.droneFilterCutoffHertz, startTime);
  droneFilter.Q.setValueAtTime(recipe.droneFilterQuality, startTime);
  droneFilter.connect(dryBus);
  const padReverbSend = audioContext.createGain();
  padReverbSend.gain.setValueAtTime(PAD_REVERB_SEND, startTime);
  droneFilter.connect(padReverbSend);
  padReverbSend.connect(reverbInput);

  const nextStaggerValue = randomFromSeed(`${recipe.bedNoiseSeed}${LFO_STAGGER_SEED_SUFFIX}`);
  const padOscillators: OscillatorNode[] = [];

  for (const voice of recipe.droneVoices) {
    const oscillator = audioContext.createOscillator();
    oscillator.type = voice.waveform;
    oscillator.frequency.setValueAtTime(voice.frequencyHertz, startTime);
    oscillator.detune.setValueAtTime(voice.detuneCents, startTime);

    const breathSwing = voice.gain * voice.breathDepth * BREATH_MIDPOINT_RATIO;
    const voiceGain = audioContext.createGain();
    voiceGain.gain.setValueAtTime(voice.gain - breathSwing, startTime);

    const breathOscillator = audioContext.createOscillator();
    breathOscillator.type = "sine";
    breathOscillator.frequency.setValueAtTime(voice.breathRateHertz, startTime);
    const breathDepthGain = audioContext.createGain();
    breathDepthGain.gain.setValueAtTime(breathSwing, startTime);
    breathOscillator.connect(breathDepthGain);
    breathDepthGain.connect(voiceGain.gain);

    oscillator.connect(voiceGain);
    voiceGain.connect(droneFilter);

    oscillator.start(startTime);
    breathOscillator.start(startTime + nextStaggerValue() * MAXIMUM_LFO_START_STAGGER_SECONDS);
    padOscillators.push(oscillator);
    sustainedSources.push(oscillator, breathOscillator);
  }

  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = createSeededNoiseBuffer(audioContext, recipe.bedNoiseSeed);
  noiseSource.loop = true;

  const bedFilter = audioContext.createBiquadFilter();
  bedFilter.type = recipe.bedFilterType;
  bedFilter.frequency.setValueAtTime(recipe.bedFilterFrequencyHertz, startTime);
  bedFilter.Q.setValueAtTime(recipe.bedFilterQuality, startTime);

  const sweepOscillator = audioContext.createOscillator();
  sweepOscillator.type = "sine";
  sweepOscillator.frequency.setValueAtTime(recipe.bedSweepRateHertz, startTime);
  const sweepDepthGain = audioContext.createGain();
  sweepDepthGain.gain.setValueAtTime(recipe.bedSweepDepthHertz, startTime);
  sweepOscillator.connect(sweepDepthGain);
  sweepDepthGain.connect(bedFilter.frequency);

  const bedGain = audioContext.createGain();
  bedGain.gain.setValueAtTime(recipe.bedGain, startTime);

  // The bed stays dry. Reverberated noise is fog, and it buries the notes.
  noiseSource.connect(bedFilter);
  bedFilter.connect(bedGain);
  bedGain.connect(dryBus);

  noiseSource.start(startTime);
  sweepOscillator.start(startTime + nextStaggerValue() * MAXIMUM_LFO_START_STAGGER_SECONDS);
  sustainedSources.push(noiseSource, sweepOscillator);

  // --- Performance -----------------------------------------------------------

  const nextPerformanceValue = randomFromSeed(recipe.performanceSeed);
  const activeNoteSources = new Set<OscillatorNode>();
  let currentChordSemitones = recipe.chordProgression.rootOffsetsSemitones[0] ?? 0;
  let chordStepIndex = 0;
  let nextNoteTime = startTime + FIRST_NOTE_DELAY_SECONDS;
  let nextChordChangeTime = startTime + recipe.chordProgression.changeIntervalSeconds;
  let hasStopped = false;

  function playNote(frequencyHertz: number, noteStartTime: number, levelRatio: number): void {
    const noteOutput = audioContext.createGain();
    noteOutput.gain.setValueAtTime(recipe.melody.gain * levelRatio, noteStartTime);

    const panner = audioContext.createStereoPanner();
    panner.pan.setValueAtTime((nextPerformanceValue() * 2 - 1) * MAXIMUM_NOTE_PAN, noteStartTime);
    noteOutput.connect(panner);
    panner.connect(dryBus);
    panner.connect(reverbInput);
    panner.connect(delayInput);

    const noteVoice =
      recipe.melody.instrument === "pluck"
        ? createPluckNoteVoice(audioContext, frequencyHertz, noteStartTime, recipe.melody.decaySeconds, noteOutput)
        : createPartialNoteVoice(
            audioContext,
            recipe.melody.instrument,
            frequencyHertz,
            noteStartTime,
            recipe.melody.decaySeconds,
            noteOutput
          );

    for (const source of noteVoice.sources) {
      source.stop(noteVoice.endTime);
      activeNoteSources.add(source);
      source.onended = () => {
        activeNoteSources.delete(source);
        panner.disconnect();
      };
    }
  }

  function scheduleNoteAt(noteStartTime: number): void {
    const { scaleSemitones, octaveCount, rootFrequencyHertz } = recipe.melody;
    const octaveOffset = Math.floor(nextPerformanceValue() * octaveCount) * 12;
    const scaleDegree = scaleSemitones[Math.floor(nextPerformanceValue() * scaleSemitones.length)] ?? 0;
    // The melody follows the chord, or the two layers drift into different keys.
    const frequencyHertz =
      rootFrequencyHertz * semitoneRatio(scaleDegree + octaveOffset + currentChordSemitones);
    const levelRatio = MINIMUM_NOTE_VELOCITY + nextPerformanceValue() * NOTE_VELOCITY_SPREAD;
    playNote(frequencyHertz, noteStartTime, levelRatio);

    if (nextPerformanceValue() < recipe.melody.graceNoteChance) {
      const graceOffset =
        GRACE_NOTE_SEMITONE_OFFSETS[Math.floor(nextPerformanceValue() * GRACE_NOTE_SEMITONE_OFFSETS.length)] ?? 12;
      playNote(
        frequencyHertz * semitoneRatio(graceOffset),
        noteStartTime + GRACE_NOTE_DELAY_SECONDS,
        levelRatio * GRACE_NOTE_LEVEL_RATIO
      );
    }
  }

  function applyChordChangeAt(changeTime: number): void {
    const { rootOffsetsSemitones, glideSeconds } = recipe.chordProgression;
    chordStepIndex = (chordStepIndex + 1) % rootOffsetsSemitones.length;
    currentChordSemitones = rootOffsetsSemitones[chordStepIndex] ?? 0;
    const chordRatio = semitoneRatio(currentChordSemitones);
    for (let voiceIndex = 0; voiceIndex < padOscillators.length; voiceIndex += 1) {
      const padOscillator = padOscillators[voiceIndex];
      const voiceRecipe = recipe.droneVoices[voiceIndex];
      if (!voiceRecipe) {
        continue;
      }
      // A glide rather than a jump: the pad should never be heard arriving.
      padOscillator.frequency.linearRampToValueAtTime(
        voiceRecipe.frequencyHertz * chordRatio,
        changeTime + glideSeconds
      );
    }
  }

  function runScheduler(): void {
    const horizonTime = audioContext.currentTime + SCHEDULER_LOOKAHEAD_SECONDS;
    while (nextChordChangeTime < horizonTime) {
      applyChordChangeAt(nextChordChangeTime);
      nextChordChangeTime += recipe.chordProgression.changeIntervalSeconds;
    }
    while (nextNoteTime < horizonTime) {
      scheduleNoteAt(nextNoteTime);
      const gapSpreadSeconds = recipe.melody.maximumGapSeconds - recipe.melody.minimumGapSeconds;
      nextNoteTime += recipe.melody.minimumGapSeconds + nextPerformanceValue() * gapSpreadSeconds;
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
    masterGain.gain.linearRampToValueAtTime(0, silenceTime);
    for (const source of sustainedSources) {
      source.stop(silenceTime);
    }
    // Notes already scheduled past the fade would otherwise keep the context
    // busy long after the world has gone.
    for (const noteSource of activeNoteSources) {
      noteSource.stop(silenceTime);
    }
    // One sustained source releases the shared tail once it has actually ended.
    const lastSustainedSource = sustainedSources[sustainedSources.length - 1];
    if (lastSustainedSource) {
      lastSustainedSource.onended = () => masterGain.disconnect();
    }
  }

  return { stop };
}
