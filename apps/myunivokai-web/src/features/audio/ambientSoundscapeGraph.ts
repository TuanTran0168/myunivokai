import type { AmbientSoundscapeRecipe } from "@/lib/ambientSoundscape";
import { randomFromSeed } from "@/lib/scene";

// --- Web Audio graph for one soundscape --------------------------------------
//
// Turns a deterministic recipe into live nodes. This is the impure half; the
// numbers all arrive already rolled and already clamped from lib/ambientSoundscape.
//
// Shape:
//
//   oscillator ──► voiceGain ──┐                      (one chain per drone voice)
//     breathLfo ──► depth ──► voiceGain.gain
//                              ├──► droneFilter ──┐
//   noiseSource ──► bedFilter ──► bedGain ────────┼──► masterGain ──► destination
//     sweepLfo ──► depth ──► bedFilter.frequency  │
//
// masterGain owns the fade. Everything else is set once and left alone, because
// an ambience that reacts to the frame loop is a soundtrack, not an ambience.

const NOISE_BUFFER_SECONDS = 4;
const NOISE_BUFFER_CHANNEL_COUNT = 1;
const FIRST_CHANNEL_INDEX = 0;

// A voice sits at (1 - depth/2) of its gain and swings +/- depth/2 around that,
// so the breath never silences the voice and never exceeds its rolled level.
const BREATH_MIDPOINT_RATIO = 0.5;

// Staggering LFO starts is the only way to give each voice its own phase — an
// OscillatorNode always starts at phase zero, and voices breathing in lockstep
// pump audibly instead of drifting.
const MAXIMUM_LFO_START_STAGGER_SECONDS = 6;
const LFO_STAGGER_SEED_SUFFIX = "-lfo-stagger";

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
  const scheduledSources: Array<OscillatorNode | AudioBufferSourceNode> = [];

  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0, startTime);
  masterGain.gain.linearRampToValueAtTime(recipe.masterGain, startTime + fadeInSeconds);
  masterGain.connect(audioContext.destination);

  const droneFilter = audioContext.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.setValueAtTime(recipe.droneFilterCutoffHertz, startTime);
  droneFilter.Q.setValueAtTime(recipe.droneFilterQuality, startTime);
  droneFilter.connect(masterGain);

  const nextStaggerValue = randomFromSeed(`${recipe.bedNoiseSeed}${LFO_STAGGER_SEED_SUFFIX}`);

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
    scheduledSources.push(oscillator, breathOscillator);
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

  noiseSource.connect(bedFilter);
  bedFilter.connect(bedGain);
  bedGain.connect(masterGain);

  noiseSource.start(startTime);
  sweepOscillator.start(startTime + nextStaggerValue() * MAXIMUM_LFO_START_STAGGER_SECONDS);
  scheduledSources.push(noiseSource, sweepOscillator);

  let hasStopped = false;

  function stop(fadeSeconds: number): void {
    if (hasStopped) {
      return;
    }
    hasStopped = true;
    const stopRequestTime = audioContext.currentTime;
    const silenceTime = stopRequestTime + fadeSeconds;
    // cancelScheduledValues alone would leave the param wherever the cancelled
    // ramp had reached being re-read as the ramp's start value; anchoring at the
    // current value first makes the fade start from what is actually audible.
    masterGain.gain.cancelScheduledValues(stopRequestTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, stopRequestTime);
    masterGain.gain.linearRampToValueAtTime(0, silenceTime);
    for (const source of scheduledSources) {
      source.stop(silenceTime);
    }
    // One source releases the shared tail of the graph once it has actually
    // ended. Without this the master gain stays connected to the destination
    // for the lifetime of the context.
    const lastSource = scheduledSources[scheduledSources.length - 1];
    if (lastSource) {
      lastSource.onended = () => masterGain.disconnect();
    }
  }

  return { stop };
}
