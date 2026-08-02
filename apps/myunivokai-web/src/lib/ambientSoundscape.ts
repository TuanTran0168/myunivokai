import { isForestScene, pointsOfInterestFromScene, randomFromSeed } from "./scene";
import type { SceneConfig } from "./types";

// --- Procedural ambient soundscape recipe ------------------------------------
//
// The audio counterpart of the scene config: a drone pad plus a filtered noise
// bed, derived from the SAME seed and the SAME DNA-shaped fields the visuals
// use. Nothing here touches the Web Audio API — this module is the
// deterministic half, unit-testable in a node environment. features/audio turns
// a recipe into actual nodes.
//
// Rules carried over from the scene builders:
//
// 1. `Math.random()` is banned. Every rolled value comes from randomFromSeed on
//    a dedicated stream suffix, so the same world always sounds the same, and
//    adding an audio roll can never shift a visual roll.
// 2. Character comes from the config the backend already produced — not from a
//    parallel table. Two visitors hear different music for the same reason they
//    see different worlds:
//
//      how many planets / landmarks  ->  how many voices in the chord
//      their average energy          ->  how bright and how fast it breathes
//      universe theme                ->  root pitch and the colour of the bed
//      forest weather / intensity    ->  how loud and how wide the bed opens
//      forest time of day            ->  how far the pad drops and dulls
//      forest season                 ->  how full the chord stays
//      postFX bloom                  ->  how open the pad filter sits
//
//    That is the same ProfileDNA reaching the ears that reaches the eyes: the
//    planet count is the visitor's interests, the energy is theirs, and the
//    theme came out of their preferred world style.
//
// Every output is clamped. A soundscape is played straight into someone's ears,
// so an out-of-range config must degrade to something quiet and dull rather
// than something loud and shrill.

export type AmbientWaveform = "sine" | "triangle";
export type AmbientBedFilterType = "lowpass" | "bandpass";

/**
 * Timbre of the melodic layer. Each one is a different small synth in the graph
 * module, not a different setting on one synth — a bell and a plucked string
 * differ in their harmonic content and their envelope, not in their filter
 * cutoff.
 */
export type AmbientInstrument = "bell" | "glass" | "pluck" | "marimba";

export type AmbientMelodyRecipe = {
  instrument: AmbientInstrument;
  /** Semitone offsets of one octave of the scale, from the melodic root. */
  scaleSemitones: number[];
  rootFrequencyHertz: number;
  octaveCount: number;
  /** Notes arrive at a rolled gap inside this range — never on a grid. */
  minimumGapSeconds: number;
  maximumGapSeconds: number;
  decaySeconds: number;
  gain: number;
  /** Probability a slot plays a second note just behind the first. */
  graceNoteChance: number;
};

export type AmbientChordProgressionRecipe = {
  /** Semitone offsets applied to the pad root, cycled in order. */
  rootOffsetsSemitones: number[];
  changeIntervalSeconds: number;
  /** How long the pad glides between chords. Long, so it reads as drift. */
  glideSeconds: number;
};

export type AmbientSpaceRecipe = {
  reverbDecaySeconds: number;
  reverbWetMix: number;
  delayTimeSeconds: number;
  delayFeedback: number;
  delayMix: number;
};

export type AmbientDroneVoiceRecipe = {
  frequencyHertz: number;
  waveform: AmbientWaveform;
  gain: number;
  /** Small per-voice offset so two voices on the same pitch beat slowly. */
  detuneCents: number;
  /** Sub-audio LFO rate that makes the voice swell and recede. */
  breathRateHertz: number;
  /** How much of the voice's gain the breath LFO removes at its trough. */
  breathDepth: number;
};

export type AmbientSoundscapeRecipe = {
  /** Stable identity of this recipe; use it as a React effect dependency. */
  signature: string;
  masterGain: number;
  droneVoices: AmbientDroneVoiceRecipe[];
  droneFilterCutoffHertz: number;
  droneFilterQuality: number;
  /** Filtered noise under the pad: space air, or wind through leaves. */
  bedGain: number;
  bedFilterType: AmbientBedFilterType;
  bedFilterFrequencyHertz: number;
  bedFilterQuality: number;
  /** Slow sweep of the bed filter — gusts in a forest, drift in space. */
  bedSweepRateHertz: number;
  bedSweepDepthHertz: number;
  /** Seed for the looping noise buffer, so even the hiss is reproducible. */
  bedNoiseSeed: string;
  /** The layer that makes this music rather than a drone. */
  melody: AmbientMelodyRecipe;
  /** Slow harmonic movement under it, so the pad is not one chord forever. */
  chordProgression: AmbientChordProgressionRecipe;
  /** Reverb and delay. Without these the synths read as clinical and dry. */
  space: AmbientSpaceRecipe;
  /** Seed for the reverb impulse response and the note scheduler. */
  performanceSeed: string;
};

const AMBIENT_AUDIO_SEED_SUFFIX = "-ambient-audio";
const BED_NOISE_SEED_SUFFIX = "-ambient-bed";

const FALLBACK_SCENE_SEED = "myunivokai-silent";
const UNIVERSE_FAMILY_KEY = "universe";
const FOREST_FAMILY_KEY = "forest";

// Deliberately quiet. This plays behind a scene nobody opened for the audio;
// it should sit under a conversation, not over one.
const MASTER_GAIN = 0.28;

// REGISTER — the constraint that decides whether any of this is audible at all.
//
// The first version of this file put the universe pad at 47-106 Hz with the
// noise bed lowpassed to 170-320 Hz. On studio monitors that is a deep, correct
// space rumble. On the laptop and phone speakers people actually use, which
// roll off steeply below roughly 150 Hz, it is silence — the feature shipped
// mute while every unit test stayed green, because they checked determinism and
// bounds and never asked whether the output lands where a speaker can produce
// it.
//
// So: roots sit at or above 98 Hz, every interval stack reaches at least an
// octave above its root, and the noise bed is centred in the midrange where
// even a phone speaker has output. The audibility test in ambientSoundscape.test.ts
// is the guard that keeps it that way.
export const SMALL_SPEAKER_PRESENCE_FLOOR_HERTZ = 180;
export const SMALL_SPEAKER_BED_FLOOR_HERTZ = 400;

const MINIMUM_DRONE_VOICE_COUNT = 3;
const MAXIMUM_DRONE_VOICE_COUNT = 5;

// Harmonic ratios above the root. Fixed stacks rather than rolled intervals:
// random ratios produce beating dissonance about as often as they produce a
// chord, and a pad that is subtly out of tune is worse than no pad.
//
// Keyed by voice count rather than truncated to it. Slicing a five-note stack
// down to three used to drop [1, 1.25, 1.5, 2, 3] to [1, 1.25, 1.5], whose top
// note is a fifth rather than an octave — which pushed the whole chord back
// under the small-speaker floor. Every stack here tops out at 2x or above, so
// the chord keeps its presence at any width.
const DRONE_INTERVAL_STACKS_BY_VOICE_COUNT: Record<number, number[][]> = {
  3: [
    [1, 1.5, 2], // root, fifth, octave — open and stable
    [1, 4 / 3, 2], // root, fourth, octave — suspended
    [1, 1.2, 2] // minor third then octave — inward
  ],
  4: [
    [1, 1.5, 2, 3], // adds the twelfth for air at the top
    [1, 4 / 3, 2, 8 / 3], // fourth, octave, eleventh
    [1, 1.2, 1.8, 2.4], // minor third and its octave
    [1, 1.25, 1.5, 2] // major triad plus octave — warm
  ],
  5: [
    [1, 1.25, 1.5, 2, 3], // major triad, octave, twelfth — full
    [1, 1.5, 2, 2.5, 3], // fifth-led stack, evenly spread
    [1, 4 / 3, 2, 8 / 3, 4] // suspended, two octaves wide
  ]
};

// Upper partials carry less weight, or the pad turns into a whistle. The base
// level sits well under half: the pad is the floor the melody stands on, and it
// used to be the whole piece, which is exactly why it read as a drone.
const DRONE_BASE_VOICE_GAIN = 0.22;
const DRONE_VOICE_GAIN_FALLOFF_PER_INDEX = 0.85;
const MAXIMUM_DRONE_DETUNE_CENTS = 7;
const MINIMUM_BREATH_RATE_HERTZ = 0.025;
const BREATH_RATE_SPREAD_HERTZ = 0.055;
const MINIMUM_BREATH_DEPTH = 0.25;
const BREATH_DEPTH_SPREAD = 0.35;

const MINIMUM_DRONE_FREQUENCY_HERTZ = 30;
const MAXIMUM_DRONE_FREQUENCY_HERTZ = 2000;
const MINIMUM_FILTER_CUTOFF_HERTZ = 90;
const MAXIMUM_FILTER_CUTOFF_HERTZ = 6000;
const MINIMUM_BED_GAIN = 0;
const MAXIMUM_BED_GAIN = 0.16;
const MINIMUM_FILTER_QUALITY = 0.2;
const MAXIMUM_FILTER_QUALITY = 4;
const MINIMUM_SWEEP_RATE_HERTZ = 0.01;
const MAXIMUM_SWEEP_RATE_HERTZ = 0.4;

// Rolled spread applied on top of each character table, so two universes with
// the same theme are related but not identical.
const ROOT_FREQUENCY_JITTER_RATIO = 0.06;
const CUTOFF_JITTER_RATIO = 0.18;
const DRONE_FILTER_QUALITY = 0.7;

type SoundscapeCharacter = {
  rootFrequencyHertz: number;
  waveform: AmbientWaveform;
  droneFilterCutoffHertz: number;
  bedGain: number;
  bedFilterType: AmbientBedFilterType;
  bedFilterFrequencyHertz: number;
  bedFilterQuality: number;
  bedSweepRateHertz: number;
  bedSweepDepthHertz: number;
};

// Universe themes. Sine or triangle roots in the low midrange with a wide-open
// lowpass bed: the reference is a pressurised hull, not weather.
const UNIVERSE_CHARACTER_BY_THEME: Record<string, SoundscapeCharacter> = {
  "cosmic-galaxy": {
    rootFrequencyHertz: 110, // A2
    waveform: "sine",
    droneFilterCutoffHertz: 1250,
    bedGain: 0.055,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 700,
    bedFilterQuality: 0.6,
    bedSweepRateHertz: 0.035,
    bedSweepDepthHertz: 220
  },
  nebula: {
    rootFrequencyHertz: 98, // G2
    waveform: "sine",
    droneFilterCutoffHertz: 1050,
    bedGain: 0.06,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 600,
    bedFilterQuality: 0.5,
    bedSweepRateHertz: 0.028,
    bedSweepDepthHertz: 190
  },
  crystal: {
    rootFrequencyHertz: 146.83, // D3
    waveform: "triangle",
    droneFilterCutoffHertz: 2400,
    bedGain: 0.042,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 1100,
    bedFilterQuality: 0.9,
    bedSweepRateHertz: 0.05,
    bedSweepDepthHertz: 320
  },
  aurora: {
    rootFrequencyHertz: 130.81, // C3
    waveform: "sine",
    droneFilterCutoffHertz: 1700,
    bedGain: 0.058,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 900,
    bedFilterQuality: 0.7,
    bedSweepRateHertz: 0.04,
    bedSweepDepthHertz: 260
  },
  "cyber-orbit": {
    rootFrequencyHertz: 123.47, // B2
    waveform: "triangle",
    droneFilterCutoffHertz: 2000,
    bedGain: 0.055,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 850,
    bedFilterQuality: 1.1,
    bedSweepRateHertz: 0.07,
    bedSweepDepthHertz: 300
  }
};

const DEFAULT_UNIVERSE_CHARACTER: SoundscapeCharacter = UNIVERSE_CHARACTER_BY_THEME["cosmic-galaxy"];

// Forest base. Triangle root a fourth above the universe default, and a bandpass
// bed centred where wind in foliage actually lives; weather and time of day bend
// it from here.
const FOREST_BASE_CHARACTER: SoundscapeCharacter = {
  rootFrequencyHertz: 146.83, // D3
  waveform: "triangle",
  droneFilterCutoffHertz: 2000,
  bedGain: 0.085,
  bedFilterType: "bandpass",
  bedFilterFrequencyHertz: 900,
  bedFilterQuality: 0.9,
  bedSweepRateHertz: 0.1,
  bedSweepDepthHertz: 300
};

type WeatherBedModifier = {
  gainMultiplier: number;
  frequencyMultiplier: number;
  qualityMultiplier: number;
  sweepRateMultiplier: number;
};

const NEUTRAL_WEATHER_BED_MODIFIER: WeatherBedModifier = {
  gainMultiplier: 1,
  frequencyMultiplier: 1,
  qualityMultiplier: 1,
  sweepRateMultiplier: 1
};

// Rain opens the bed up into broadband hiss (low Q, high centre, loud); snow
// closes it down to a muffled hush. These are the full-intensity endpoints —
// `weather.intensity` blends each one back toward neutral.
const WEATHER_BED_MODIFIERS: Record<string, WeatherBedModifier> = {
  clear: NEUTRAL_WEATHER_BED_MODIFIER,
  sunRays: { gainMultiplier: 0.85, frequencyMultiplier: 1.05, qualityMultiplier: 1.1, sweepRateMultiplier: 0.85 },
  overcast: { gainMultiplier: 1.15, frequencyMultiplier: 0.8, qualityMultiplier: 0.75, sweepRateMultiplier: 0.9 },
  // Rain opens the bed, but measured at frequencyMultiplier 1.7 with a Q of
  // 0.4 it was effectively white noise: 52% of all energy above 1200 Hz,
  // burying the music it was supposed to sit under.
  rain: { gainMultiplier: 1.25, frequencyMultiplier: 1.3, qualityMultiplier: 0.8, sweepRateMultiplier: 1.5 },
  snow: { gainMultiplier: 0.7, frequencyMultiplier: 0.6, qualityMultiplier: 0.6, sweepRateMultiplier: 0.55 }
};

const DEFAULT_WEATHER_INTENSITY = 0.5;

type TimeOfDayModifier = {
  frequencyMultiplier: number;
  cutoffMultiplier: number;
};

// The pad drops and dulls as the light goes.
const TIME_OF_DAY_MODIFIERS: Record<string, TimeOfDayModifier> = {
  day: { frequencyMultiplier: 1, cutoffMultiplier: 1 },
  goldenHour: { frequencyMultiplier: 0.94, cutoffMultiplier: 0.85 },
  dusk: { frequencyMultiplier: 0.86, cutoffMultiplier: 0.68 }
};

const NEUTRAL_TIME_OF_DAY_MODIFIER: TimeOfDayModifier = TIME_OF_DAY_MODIFIERS.day;

// A winter forest keeps fewer voices than a summer one — the stack thins out
// the same way the canopy does.
const SEASON_VOICE_COUNT_OFFSET: Record<string, number> = {
  spring: 0,
  summer: 1,
  autumn: 0,
  winter: -1
};

// Bloom is the closest thing a scene config has to "how bright is this world",
// and it maps naturally onto how open the pad's filter sits.
const NEUTRAL_BLOOM_INTENSITY = 1;
const BLOOM_CUTOFF_INFLUENCE = 0.35;
const MINIMUM_BLOOM_INTENSITY = 0.2;
const MAXIMUM_BLOOM_INTENSITY = 2;

// The visitor's own energy, averaged across their planets or landmarks. This is
// the most directly personal number in the whole config, so it gets the two
// things an ear notices first: brightness, and how fast the pad breathes.
const NEUTRAL_POINT_ENERGY = 50;
const MAXIMUM_POINT_ENERGY = 100;
const MINIMUM_ENERGY_CUTOFF_MULTIPLIER = 0.75;
const ENERGY_CUTOFF_MULTIPLIER_SPREAD = 0.6;
const MINIMUM_ENERGY_BREATH_MULTIPLIER = 0.7;
const ENERGY_BREATH_MULTIPLIER_SPREAD = 0.8;

// --- The melodic layer -------------------------------------------------------
//
// A sustained chord with no events in it is a drone, and a drone in a minor
// register is a funeral. What turns this into music is the same thing every
// generative-ambient system does: a sparse stream of short notes over the pad,
// drawn from a scale, with a long reverb tail holding them together.
//
// Scales are pentatonic or hexatonic on purpose. With five or six notes and no
// semitone clashes, notes picked in any order still sound consonant — which is
// what makes an unattended random generator safe to listen to for an hour. The
// major seventh is dropped from the modal scales for the same reason.

const SEMITONES_PER_OCTAVE = 12;

const SCALE_SEMITONES: Record<string, number[]> = {
  majorPentatonic: [0, 2, 4, 7, 9], // open, warm, unambiguously bright
  minorPentatonic: [0, 3, 5, 7, 10], // introspective without being mournful
  kumoi: [0, 2, 3, 7, 9], // Japanese; still, spacious, a little wistful
  lydian: [0, 2, 4, 6, 7, 9], // raised fourth — wonder, distance, weightlessness
  dorian: [0, 2, 3, 5, 7, 9] // gentle melancholy that still resolves upward
};

const DEFAULT_SCALE_KEY = "majorPentatonic";

// Pad root movement, in semitones. Small intervals so the pad never leaves its
// register, and every progression returns home.
const CHORD_PROGRESSIONS: number[][] = [
  [0, -3, -5, -3], // down to the relative minor and back
  [0, 2, -3, -5], // step up, then a long settle downward
  [0, -5, -7, -5], // fourth, fifth, fourth — plainly tonal
  [0, 3, 5, 3] // upward and open
];

const MINIMUM_CHORD_CHANGE_SECONDS = 18;
const CHORD_CHANGE_SPREAD_SECONDS = 16;
// The glide is most of the interval on purpose: the pad should never be heard
// arriving at a chord, only found already in one.
const CHORD_GLIDE_RATIO = 0.55;

// The melodic root sits two octaves above the pad, which is where "tone cao"
// actually lives — 400-1600 Hz, the band a laptop speaker reproduces best.
const MELODY_OCTAVES_ABOVE_PAD = 2;
const MELODY_OCTAVE_COUNT = 2;
const MAXIMUM_MELODY_ROOT_HERTZ = 700;

const MINIMUM_NOTE_GAP_SECONDS = 1.4;
const NOTE_GAP_SPREAD_SECONDS = 2.2;
// High-energy worlds play more often; calm ones leave more air.
const ENERGY_NOTE_GAP_MULTIPLIER_AT_ZERO = 1.6;
const ENERGY_NOTE_GAP_MULTIPLIER_SPREAD = -0.9;
const MINIMUM_GRACE_NOTE_CHANCE = 0.12;
const GRACE_NOTE_CHANCE_SPREAD = 0.25;

type InstrumentCharacter = {
  instrument: AmbientInstrument;
  decaySeconds: number;
  gain: number;
};

const INSTRUMENT_CHARACTERS: Record<AmbientInstrument, InstrumentCharacter> = {
  bell: { instrument: "bell", decaySeconds: 4.5, gain: 0.52 },
  glass: { instrument: "glass", decaySeconds: 6, gain: 0.46 },
  pluck: { instrument: "pluck", decaySeconds: 2.4, gain: 0.5 },
  marimba: { instrument: "marimba", decaySeconds: 1.6, gain: 0.55 }
};

type MelodicIdentity = { instrument: AmbientInstrument; scaleKey: string };

// Universe: the theme already decided the visual character, so it decides the
// instrument and the mode too.
const UNIVERSE_MELODIC_IDENTITY_BY_THEME: Record<string, MelodicIdentity> = {
  "cosmic-galaxy": { instrument: "bell", scaleKey: "majorPentatonic" },
  nebula: { instrument: "glass", scaleKey: "kumoi" },
  crystal: { instrument: "glass", scaleKey: "lydian" },
  aurora: { instrument: "bell", scaleKey: "lydian" },
  "cyber-orbit": { instrument: "pluck", scaleKey: "minorPentatonic" }
};

const DEFAULT_UNIVERSE_MELODIC_IDENTITY: MelodicIdentity = { instrument: "bell", scaleKey: "majorPentatonic" };

// Forest: season sets the mode the way it sets the foliage, and the weather
// decides whether the notes ring out or are struck dry.
const FOREST_SCALE_KEY_BY_SEASON: Record<string, string> = {
  spring: "majorPentatonic",
  summer: "majorPentatonic",
  autumn: "dorian",
  winter: "kumoi"
};

const FOREST_INSTRUMENT_BY_WEATHER: Record<string, AmbientInstrument> = {
  clear: "marimba",
  sunRays: "marimba",
  overcast: "pluck",
  rain: "pluck",
  snow: "glass"
};

const DEFAULT_FOREST_INSTRUMENT: AmbientInstrument = "marimba";

// --- Space -------------------------------------------------------------------
//
// The single biggest reason the first version sounded hard and clinical: it had
// none. Dry synthesis has no room around it, and an ear reads that as cheap.
// Every ambient reference applies a long reverb or delay so notes overlap into
// each other rather than ending.

const MINIMUM_REVERB_DECAY_SECONDS = 2.6;
const REVERB_DECAY_SPREAD_SECONDS = 2.8;
const MINIMUM_REVERB_WET_MIX = 0.4;
const REVERB_WET_MIX_SPREAD = 0.22;
const MINIMUM_DELAY_TIME_SECONDS = 0.28;
const DELAY_TIME_SPREAD_SECONDS = 0.34;
const MINIMUM_DELAY_FEEDBACK = 0.24;
const DELAY_FEEDBACK_SPREAD = 0.2;
const MINIMUM_DELAY_MIX = 0.16;
const DELAY_MIX_SPREAD = 0.16;

const PERFORMANCE_SEED_SUFFIX = "-ambient-performance";

function clampToRange(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function blendTowardNeutral(modifierValue: number, blendAmount: number): number {
  return 1 + (modifierValue - 1) * blendAmount;
}

/**
 * How many planets or landmarks the scene carries, and how energetic they are.
 * Both come straight from the ProfileDNA: the count is how many interests and
 * traits the visitor gave, the energy is the value the AI assigned each one.
 */
function resolveDnaSignals(scene: SceneConfig): { pointCount: number; averageEnergy: number } {
  const pointsOfInterest = pointsOfInterestFromScene(scene);
  if (pointsOfInterest.length === 0) {
    return { pointCount: 0, averageEnergy: NEUTRAL_POINT_ENERGY };
  }
  const energyValues = pointsOfInterest
    .map((pointOfInterest) => pointOfInterest.energy)
    .filter((energy): energy is number => typeof energy === "number" && Number.isFinite(energy));
  if (energyValues.length === 0) {
    return { pointCount: pointsOfInterest.length, averageEnergy: NEUTRAL_POINT_ENERGY };
  }
  const energyTotal = energyValues.reduce((runningTotal, energy) => runningTotal + energy, 0);
  return {
    pointCount: pointsOfInterest.length,
    averageEnergy: clampToRange(energyTotal / energyValues.length, 0, MAXIMUM_POINT_ENERGY)
  };
}

function resolveWeatherBedModifier(scene: SceneConfig): WeatherBedModifier {
  const weatherKind = typeof scene.weather?.kind === "string" ? scene.weather.kind : "";
  const modifier = WEATHER_BED_MODIFIERS[weatherKind] ?? NEUTRAL_WEATHER_BED_MODIFIER;
  const rawIntensity = scene.weather?.intensity;
  const intensity = clampToRange(typeof rawIntensity === "number" ? rawIntensity : DEFAULT_WEATHER_INTENSITY, 0, 1);
  return {
    gainMultiplier: blendTowardNeutral(modifier.gainMultiplier, intensity),
    frequencyMultiplier: blendTowardNeutral(modifier.frequencyMultiplier, intensity),
    qualityMultiplier: blendTowardNeutral(modifier.qualityMultiplier, intensity),
    sweepRateMultiplier: blendTowardNeutral(modifier.sweepRateMultiplier, intensity)
  };
}

function resolveForestCharacter(scene: SceneConfig): SoundscapeCharacter {
  const weatherModifier = resolveWeatherBedModifier(scene);
  const timeOfDayKey = typeof scene.lighting?.timeOfDay === "string" ? scene.lighting.timeOfDay : "";
  const timeOfDayModifier = TIME_OF_DAY_MODIFIERS[timeOfDayKey] ?? NEUTRAL_TIME_OF_DAY_MODIFIER;
  return {
    rootFrequencyHertz: FOREST_BASE_CHARACTER.rootFrequencyHertz * timeOfDayModifier.frequencyMultiplier,
    waveform: FOREST_BASE_CHARACTER.waveform,
    droneFilterCutoffHertz: FOREST_BASE_CHARACTER.droneFilterCutoffHertz * timeOfDayModifier.cutoffMultiplier,
    bedGain: FOREST_BASE_CHARACTER.bedGain * weatherModifier.gainMultiplier,
    bedFilterType: FOREST_BASE_CHARACTER.bedFilterType,
    bedFilterFrequencyHertz: FOREST_BASE_CHARACTER.bedFilterFrequencyHertz * weatherModifier.frequencyMultiplier,
    bedFilterQuality: FOREST_BASE_CHARACTER.bedFilterQuality * weatherModifier.qualityMultiplier,
    bedSweepRateHertz: FOREST_BASE_CHARACTER.bedSweepRateHertz * weatherModifier.sweepRateMultiplier,
    bedSweepDepthHertz: FOREST_BASE_CHARACTER.bedSweepDepthHertz
  };
}

function resolveUniverseCharacter(scene: SceneConfig): SoundscapeCharacter {
  const theme = typeof scene.theme === "string" ? scene.theme : "";
  return UNIVERSE_CHARACTER_BY_THEME[theme] ?? DEFAULT_UNIVERSE_CHARACTER;
}

function bloomCutoffMultiplier(scene: SceneConfig): number {
  const rawBloomIntensity = scene.postFX?.bloomIntensity;
  if (typeof rawBloomIntensity !== "number") {
    return 1;
  }
  const bloomIntensity = clampToRange(rawBloomIntensity, MINIMUM_BLOOM_INTENSITY, MAXIMUM_BLOOM_INTENSITY);
  return 1 + (bloomIntensity - NEUTRAL_BLOOM_INTENSITY) * BLOOM_CUTOFF_INFLUENCE;
}

function seasonVoiceCountOffset(scene: SceneConfig): number {
  const seasonKind = typeof scene.season?.kind === "string" ? scene.season.kind : "";
  return SEASON_VOICE_COUNT_OFFSET[seasonKind] ?? 0;
}

function buildDroneVoices(
  character: SoundscapeCharacter,
  intervalStack: number[],
  breathRateMultiplier: number,
  nextRandomValue: () => number
): AmbientDroneVoiceRecipe[] {
  return intervalStack.map((intervalRatio, voiceIndex) => {
    const frequencyHertz = clampToRange(
      character.rootFrequencyHertz * intervalRatio,
      MINIMUM_DRONE_FREQUENCY_HERTZ,
      MAXIMUM_DRONE_FREQUENCY_HERTZ
    );
    const gain = DRONE_BASE_VOICE_GAIN * Math.pow(DRONE_VOICE_GAIN_FALLOFF_PER_INDEX, voiceIndex);
    const detuneCents = (nextRandomValue() * 2 - 1) * MAXIMUM_DRONE_DETUNE_CENTS;
    const breathRateHertz =
      (MINIMUM_BREATH_RATE_HERTZ + nextRandomValue() * BREATH_RATE_SPREAD_HERTZ) * breathRateMultiplier;
    const breathDepth = MINIMUM_BREATH_DEPTH + nextRandomValue() * BREATH_DEPTH_SPREAD;
    return { frequencyHertz, waveform: character.waveform, gain, detuneCents, breathRateHertz, breathDepth };
  });
}

function resolveMelodicIdentity(scene: SceneConfig, isForest: boolean): MelodicIdentity {
  if (!isForest) {
    const theme = typeof scene.theme === "string" ? scene.theme : "";
    return UNIVERSE_MELODIC_IDENTITY_BY_THEME[theme] ?? DEFAULT_UNIVERSE_MELODIC_IDENTITY;
  }
  const seasonKind = typeof scene.season?.kind === "string" ? scene.season.kind : "";
  const weatherKind = typeof scene.weather?.kind === "string" ? scene.weather.kind : "";
  return {
    instrument: FOREST_INSTRUMENT_BY_WEATHER[weatherKind] ?? DEFAULT_FOREST_INSTRUMENT,
    scaleKey: FOREST_SCALE_KEY_BY_SEASON[seasonKind] ?? DEFAULT_SCALE_KEY
  };
}

function buildMelodyRecipe(
  padRootFrequencyHertz: number,
  identity: MelodicIdentity,
  energyRatio: number,
  nextRandomValue: () => number
): AmbientMelodyRecipe {
  const instrumentCharacter = INSTRUMENT_CHARACTERS[identity.instrument];
  const rootFrequencyHertz = Math.min(
    padRootFrequencyHertz * Math.pow(2, MELODY_OCTAVES_ABOVE_PAD),
    MAXIMUM_MELODY_ROOT_HERTZ
  );
  const noteGapMultiplier = ENERGY_NOTE_GAP_MULTIPLIER_AT_ZERO + energyRatio * ENERGY_NOTE_GAP_MULTIPLIER_SPREAD;
  const minimumGapSeconds = MINIMUM_NOTE_GAP_SECONDS * noteGapMultiplier;
  return {
    instrument: identity.instrument,
    scaleSemitones: SCALE_SEMITONES[identity.scaleKey] ?? SCALE_SEMITONES[DEFAULT_SCALE_KEY],
    rootFrequencyHertz,
    octaveCount: MELODY_OCTAVE_COUNT,
    minimumGapSeconds,
    maximumGapSeconds: minimumGapSeconds + NOTE_GAP_SPREAD_SECONDS * noteGapMultiplier,
    decaySeconds: instrumentCharacter.decaySeconds,
    gain: instrumentCharacter.gain,
    graceNoteChance: MINIMUM_GRACE_NOTE_CHANCE + nextRandomValue() * GRACE_NOTE_CHANCE_SPREAD
  };
}

function buildChordProgressionRecipe(nextRandomValue: () => number): AmbientChordProgressionRecipe {
  const progressionIndex = Math.floor(nextRandomValue() * CHORD_PROGRESSIONS.length);
  const changeIntervalSeconds =
    MINIMUM_CHORD_CHANGE_SECONDS + nextRandomValue() * CHORD_CHANGE_SPREAD_SECONDS;
  return {
    rootOffsetsSemitones: CHORD_PROGRESSIONS[progressionIndex] ?? CHORD_PROGRESSIONS[0],
    changeIntervalSeconds,
    glideSeconds: changeIntervalSeconds * CHORD_GLIDE_RATIO
  };
}

function buildSpaceRecipe(nextRandomValue: () => number): AmbientSpaceRecipe {
  return {
    reverbDecaySeconds: MINIMUM_REVERB_DECAY_SECONDS + nextRandomValue() * REVERB_DECAY_SPREAD_SECONDS,
    reverbWetMix: MINIMUM_REVERB_WET_MIX + nextRandomValue() * REVERB_WET_MIX_SPREAD,
    delayTimeSeconds: MINIMUM_DELAY_TIME_SECONDS + nextRandomValue() * DELAY_TIME_SPREAD_SECONDS,
    delayFeedback: MINIMUM_DELAY_FEEDBACK + nextRandomValue() * DELAY_FEEDBACK_SPREAD,
    delayMix: MINIMUM_DELAY_MIX + nextRandomValue() * DELAY_MIX_SPREAD
  };
}

/** Frequency ratio for a semitone offset. Exported for the graph's scheduler. */
export function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / SEMITONES_PER_OCTAVE);
}

/**
 * Short stable string identifying the soundscape a config asks for. Used as the
 * effect dependency that rebuilds the audio graph: the recipe object is rebuilt
 * on every render, but the graph must only be torn down when the sound actually
 * changes — selecting a variant, not hovering a planet.
 */
export function ambientSoundscapeSignature(scene?: SceneConfig): string {
  if (!scene) {
    return `${FALLBACK_SCENE_SEED}|${UNIVERSE_FAMILY_KEY}`;
  }
  const seed = String(scene.seed ?? FALLBACK_SCENE_SEED);
  const { pointCount, averageEnergy } = resolveDnaSignals(scene);
  const dnaPart = `${pointCount}|${averageEnergy.toFixed(1)}`;
  if (isForestScene(scene)) {
    const weatherKind = String(scene.weather?.kind ?? "");
    const weatherIntensity = String(scene.weather?.intensity ?? "");
    const timeOfDay = String(scene.lighting?.timeOfDay ?? "");
    const seasonKind = String(scene.season?.kind ?? "");
    return `${seed}|${FOREST_FAMILY_KEY}|${dnaPart}|${seasonKind}|${timeOfDay}|${weatherKind}|${weatherIntensity}`;
  }
  const theme = String(scene.theme ?? "");
  const bloomIntensity = String(scene.postFX?.bloomIntensity ?? "");
  return `${seed}|${UNIVERSE_FAMILY_KEY}|${dnaPart}|${theme}|${bloomIntensity}`;
}

/**
 * Deterministic soundscape for a scene. Same config in, same recipe out, on
 * every page and every reload — the audio equivalent of the seed contract the
 * renderers already keep.
 */
export function buildAmbientSoundscapeRecipe(scene?: SceneConfig): AmbientSoundscapeRecipe {
  const resolvedScene = scene ?? {};
  const seed = String(resolvedScene.seed ?? FALLBACK_SCENE_SEED);
  const nextRandomValue = randomFromSeed(`${seed}${AMBIENT_AUDIO_SEED_SUFFIX}`);
  const isForest = isForestScene(resolvedScene);
  const character = isForest ? resolveForestCharacter(resolvedScene) : resolveUniverseCharacter(resolvedScene);
  const { pointCount, averageEnergy } = resolveDnaSignals(resolvedScene);

  const rootFrequencyJitter = 1 + (nextRandomValue() * 2 - 1) * ROOT_FREQUENCY_JITTER_RATIO;
  const cutoffJitter = 1 + (nextRandomValue() * 2 - 1) * CUTOFF_JITTER_RATIO;
  const rolledVoiceCount = MINIMUM_DRONE_VOICE_COUNT + Math.floor(nextRandomValue() * 2);

  // The chord is as wide as the visitor's world is populated. A scene with no
  // points of interest yet (an empty preview) falls back to the rolled count.
  const dnaVoiceCount = pointCount > 0 ? pointCount : rolledVoiceCount;
  const voiceCount = Math.round(
    clampToRange(
      dnaVoiceCount + (isForest ? seasonVoiceCountOffset(resolvedScene) : 0),
      MINIMUM_DRONE_VOICE_COUNT,
      MAXIMUM_DRONE_VOICE_COUNT
    )
  );

  const energyRatio = averageEnergy / MAXIMUM_POINT_ENERGY;
  const energyCutoffMultiplier = MINIMUM_ENERGY_CUTOFF_MULTIPLIER + energyRatio * ENERGY_CUTOFF_MULTIPLIER_SPREAD;
  const energyBreathMultiplier = MINIMUM_ENERGY_BREATH_MULTIPLIER + energyRatio * ENERGY_BREATH_MULTIPLIER_SPREAD;

  const candidateStacks =
    DRONE_INTERVAL_STACKS_BY_VOICE_COUNT[voiceCount] ?? DRONE_INTERVAL_STACKS_BY_VOICE_COUNT[MINIMUM_DRONE_VOICE_COUNT];
  const intervalStackIndex = Math.floor(nextRandomValue() * candidateStacks.length);
  const intervalStack = candidateStacks[intervalStackIndex] ?? candidateStacks[0];

  const jitteredCharacter: SoundscapeCharacter = {
    ...character,
    rootFrequencyHertz: character.rootFrequencyHertz * rootFrequencyJitter
  };
  const droneVoices = buildDroneVoices(jitteredCharacter, intervalStack, energyBreathMultiplier, nextRandomValue);

  return {
    signature: ambientSoundscapeSignature(resolvedScene),
    masterGain: MASTER_GAIN,
    droneVoices,
    droneFilterCutoffHertz: clampToRange(
      character.droneFilterCutoffHertz * cutoffJitter * energyCutoffMultiplier * bloomCutoffMultiplier(resolvedScene),
      MINIMUM_FILTER_CUTOFF_HERTZ,
      MAXIMUM_FILTER_CUTOFF_HERTZ
    ),
    droneFilterQuality: DRONE_FILTER_QUALITY,
    bedGain: clampToRange(character.bedGain, MINIMUM_BED_GAIN, MAXIMUM_BED_GAIN),
    bedFilterType: character.bedFilterType,
    bedFilterFrequencyHertz: clampToRange(
      character.bedFilterFrequencyHertz,
      MINIMUM_FILTER_CUTOFF_HERTZ,
      MAXIMUM_FILTER_CUTOFF_HERTZ
    ),
    bedFilterQuality: clampToRange(character.bedFilterQuality, MINIMUM_FILTER_QUALITY, MAXIMUM_FILTER_QUALITY),
    bedSweepRateHertz: clampToRange(character.bedSweepRateHertz, MINIMUM_SWEEP_RATE_HERTZ, MAXIMUM_SWEEP_RATE_HERTZ),
    bedSweepDepthHertz: character.bedSweepDepthHertz,
    bedNoiseSeed: `${seed}${BED_NOISE_SEED_SUFFIX}`,
    melody: buildMelodyRecipe(
      jitteredCharacter.rootFrequencyHertz,
      resolveMelodicIdentity(resolvedScene, isForest),
      energyRatio,
      nextRandomValue
    ),
    chordProgression: buildChordProgressionRecipe(nextRandomValue),
    space: buildSpaceRecipe(nextRandomValue),
    performanceSeed: `${seed}${PERFORMANCE_SEED_SUFFIX}`
  };
}
