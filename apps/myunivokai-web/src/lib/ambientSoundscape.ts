import type { SampledInstrumentKey } from "@/features/audio/instrumentSamples";
import { isForestScene, pointsOfInterestFromScene, randomFromSeed } from "./scene";
import type { SceneConfig } from "./types";

// --- Procedural ambient soundscape recipe ------------------------------------
//
// The audio counterpart of the scene config: which real instrument plays, in
// which key, how often, and in what room — all derived from the SAME seed and
// the SAME DNA-shaped fields the visuals use. Nothing here touches the Web
// Audio API, so this half is unit-testable in a node environment.
//
// Rules carried over from the scene builders:
//
// 1. `Math.random()` is banned. Every rolled value comes from randomFromSeed on
//    a dedicated stream suffix, so the same world always sounds the same, and
//    adding an audio roll can never shift a visual roll.
// 2. Character comes from the config the backend already produced:
//
//      how many planets / landmarks  ->  how many notes in each harmony chord
//      their average energy          ->  how often notes fall, and how bright
//      universe theme                ->  instrument, scale, room
//      forest weather                ->  instrument, and the noise bed
//      forest time of day            ->  how far the key is transposed down
//      forest season                 ->  the scale
//      postFX bloom                  ->  how open the tone filter sits
//
// THREE ATTEMPTS, and what each got wrong, because the reasoning is worth not
// repeating:
//
// 1. A pad of low sine oscillators. Inaudible on laptop speakers — everything
//    sat under 110 Hz. Every test passed.
// 2. The same pad raised, plus oscillator-synthesised bell and pluck notes.
//    Rejected as a harsh sustained tone whose layers never blended. Rendering
//    the layers in isolation confirmed it: the pad measured 4.3x the melody.
// 3. This one. Real recorded instruments, no sustained oscillator anywhere, and
//    harmonic body supplied by sparse chord swells instead of a drone.
//
// The lesson is the one notes/fe/3d-development-limitations.md already recorded
// for the visuals: the algorithm is the cheap part, the asset decides whether
// the result is beautiful.

export type AmbientBedFilterType = "lowpass" | "bandpass";

export type AmbientMelodyRecipe = {
  instrument: SampledInstrumentKey;
  /** Semitone offsets of one octave of the scale, from the root. */
  scaleSemitones: number[];
  rootMidiNumber: number;
  octaveCount: number;
  /** Notes arrive at a rolled gap inside this range — never on a grid. */
  minimumGapSeconds: number;
  maximumGapSeconds: number;
  gain: number;
  /** Probability a note is answered by a second one just behind it. */
  graceNoteChance: number;
};

/**
 * Sparse chord swells an octave below the melody. This is what replaced the
 * drone: harmonic body without anything ever sustaining indefinitely.
 */
export type AmbientHarmonyRecipe = {
  instrument: SampledInstrumentKey;
  chordSemitones: number[];
  rootMidiNumber: number;
  minimumGapSeconds: number;
  maximumGapSeconds: number;
  gain: number;
  /** Notes are rolled rather than struck together, like a hand across a harp. */
  spreadSeconds: number;
};

export type AmbientChordProgressionRecipe = {
  /** Semitone offsets applied to both layers' roots, cycled in order. */
  rootOffsetsSemitones: number[];
  changeIntervalSeconds: number;
};

export type AmbientSpaceRecipe = {
  reverbDecaySeconds: number;
  reverbWetMix: number;
  delayTimeSeconds: number;
  delayFeedback: number;
  delayMix: number;
};

export type AmbientSoundscapeRecipe = {
  /** Stable identity of this recipe; use it as a React effect dependency. */
  signature: string;
  masterGain: number;
  melody: AmbientMelodyRecipe;
  harmony: AmbientHarmonyRecipe;
  chordProgression: AmbientChordProgressionRecipe;
  /** Gentle lowpass over both instrument layers: the scene's brightness. */
  toneCutoffHertz: number;
  /** Environmental noise under the music — air, or wind in foliage. */
  bedGain: number;
  bedFilterType: AmbientBedFilterType;
  bedFilterFrequencyHertz: number;
  bedFilterQuality: number;
  bedSweepRateHertz: number;
  bedSweepDepthHertz: number;
  bedNoiseSeed: string;
  space: AmbientSpaceRecipe;
  /** Seed for the reverb impulse response and the note scheduler. */
  performanceSeed: string;
};

const AMBIENT_AUDIO_SEED_SUFFIX = "-ambient-audio";
const BED_NOISE_SEED_SUFFIX = "-ambient-bed";
const PERFORMANCE_SEED_SUFFIX = "-ambient-performance";

const FALLBACK_SCENE_SEED = "myunivokai-silent";
const UNIVERSE_FAMILY_KEY = "universe";
const FOREST_FAMILY_KEY = "forest";

// Samples are normalised and played sparsely, so the master sits far higher
// than it did when a continuous oscillator pad was running into it.
const MASTER_GAIN = 0.62;

// REGISTER. Laptop and phone speakers roll off steeply below ~150 Hz. The first
// version put every voice under 110 Hz and shipped mute with a green suite.
//
// Two floors, because a recording is not a sine. A sine at 110 Hz on a laptop
// speaker is silence: there is nothing but the fundamental, and the speaker
// cannot produce it. A recorded harp at the same pitch carries partials at 220,
// 330, 440 Hz, and the ear reconstructs the missing fundamental from them. So
// the harmony, which is harmonically rich and only ever supporting, may sit
// lower than the melody, which has to be heard as the tune.
export const SMALL_SPEAKER_MELODY_FLOOR_MIDI = 52; // E3, about 165 Hz
export const SMALL_SPEAKER_ROOT_FLOOR_MIDI = 43; // G2, about 98 Hz
export const SMALL_SPEAKER_BED_FLOOR_HERTZ = 400;

// --- Scales ------------------------------------------------------------------
//
// Pentatonic and hexatonic on purpose: five or six notes to the octave, so
// notes drawn in any order still sound consonant and an unattended generator is
// safe to leave running for an hour.
//
// Not semitone-free — kumoi and dorian each contain one minor second, and that
// interval is exactly what gives them their character. What is avoided is more
// than one of them, and any tritone against the root.

const SCALE_SEMITONES: Record<string, number[]> = {
  majorPentatonic: [0, 2, 4, 7, 9], // open, warm, unambiguously bright
  minorPentatonic: [0, 3, 5, 7, 10], // introspective without being mournful
  kumoi: [0, 2, 3, 7, 9], // Japanese; still, spacious, a little wistful
  lydian: [0, 2, 4, 6, 7, 9], // raised fourth — wonder, distance, weightlessness
  dorian: [0, 2, 3, 5, 7, 9] // gentle melancholy that still resolves upward
};

const DEFAULT_SCALE_KEY = "majorPentatonic";

// Chord shapes for the harmony swells. All open and consonant — nothing denser
// than a triad, nothing closer than a whole tone.
const HARMONY_CHORD_SHAPES: number[][] = [
  [0, 7], // bare fifth
  [0, 7, 12], // fifth and octave
  [0, 4, 7], // major triad
  [0, 7, 14] // fifth and ninth — the widest it goes
];

// Small movements so the piece never leaves its register, and always comes home.
const CHORD_PROGRESSIONS: number[][] = [
  [0, -3, -5, -3],
  [0, 2, -3, -5],
  [0, -5, -7, -5],
  [0, 3, 5, 3]
];

const MINIMUM_CHORD_CHANGE_SECONDS = 20;
const CHORD_CHANGE_SPREAD_SECONDS = 16;

// --- Instruments -------------------------------------------------------------

type MelodicIdentity = { instrument: SampledInstrumentKey; scaleKey: string };

const UNIVERSE_MELODIC_IDENTITY_BY_THEME: Record<string, MelodicIdentity> = {
  "cosmic-galaxy": { instrument: "harp", scaleKey: "majorPentatonic" },
  nebula: { instrument: "vibraphone", scaleKey: "kumoi" },
  crystal: { instrument: "glockenspiel", scaleKey: "lydian" },
  aurora: { instrument: "piano", scaleKey: "lydian" },
  "cyber-orbit": { instrument: "saxello", scaleKey: "minorPentatonic" }
};

const DEFAULT_UNIVERSE_MELODIC_IDENTITY: MelodicIdentity = {
  instrument: "harp",
  scaleKey: "majorPentatonic"
};

const FOREST_INSTRUMENT_BY_WEATHER: Record<string, SampledInstrumentKey> = {
  clear: "kalimba",
  sunRays: "harp",
  overcast: "piano",
  rain: "recorder",
  snow: "glockenspiel"
};

const DEFAULT_FOREST_INSTRUMENT: SampledInstrumentKey = "kalimba";

const FOREST_SCALE_KEY_BY_SEASON: Record<string, string> = {
  spring: "majorPentatonic",
  summer: "majorPentatonic",
  autumn: "dorian",
  winter: "kumoi"
};

// The harmony instrument is always softer and longer-ringing than the melody it
// sits under, and never the same one — two layers of a single timbre read as
// one muddled layer rather than as two.
const HARMONY_INSTRUMENT_BY_MELODY: Record<SampledInstrumentKey, SampledInstrumentKey> = {
  piano: "vibraphone",
  harp: "vibraphone",
  glockenspiel: "harp",
  vibraphone: "harp",
  kalimba: "recorder",
  recorder: "harp",
  saxello: "vibraphone"
};

// Where each instrument sounds best, given the notes actually sampled for it.
const MELODY_ROOT_MIDI_BY_INSTRUMENT: Record<SampledInstrumentKey, number> = {
  piano: 62, // D4
  harp: 62,
  glockenspiel: 72, // C5 — the sparkle belongs high
  vibraphone: 62,
  kalimba: 64, // E4
  recorder: 62,
  saxello: 58 // A#3 — a reed sounds thin above this
};

// How far above the root the melody may wander, in octaves. Bounded per
// instrument by how many notes were sampled: stretching one an octave is
// audible as a cartoon, and glockenspiel has nothing above C6 to reach for.
const MELODY_OCTAVE_COUNT_BY_INSTRUMENT: Record<SampledInstrumentKey, number> = {
  piano: 2,
  harp: 2,
  glockenspiel: 1,
  vibraphone: 2,
  kalimba: 2,
  recorder: 1,
  saxello: 1
};

const HARMONY_SEMITONES_BELOW_MELODY = 12;

const MELODY_GAIN = 0.5;
const HARMONY_GAIN = 0.34;

// Per-instrument level trim, measured by rendering each world offline and
// comparing RMS. A sustained reed holds its level for three seconds where a
// plucked kalimba is gone in one, so equal gains are not equal loudness: the
// spread across instruments was 3x before these.
const INSTRUMENT_LEVEL_TRIM: Record<SampledInstrumentKey, number> = {
  harp: 1.7,
  piano: 1.75,
  glockenspiel: 1.5,
  vibraphone: 1.2,
  kalimba: 1.15,
  recorder: 0.63,
  saxello: 0.6
};
const MINIMUM_HARMONY_SPREAD_SECONDS = 0.12;
const HARMONY_SPREAD_SPREAD_SECONDS = 0.35;
const MINIMUM_HARMONY_GAP_SECONDS = 11;
const HARMONY_GAP_SPREAD_SECONDS = 9;

const MINIMUM_NOTE_GAP_SECONDS = 1.6;
const NOTE_GAP_SPREAD_SECONDS = 2.4;
const ENERGY_NOTE_GAP_MULTIPLIER_AT_ZERO = 1.6;
const ENERGY_NOTE_GAP_MULTIPLIER_SPREAD = -0.85;
const MINIMUM_GRACE_NOTE_CHANCE = 0.12;
const GRACE_NOTE_CHANCE_SPREAD = 0.25;

const MINIMUM_HARMONY_CHORD_SIZE = 2;
const MAXIMUM_HARMONY_CHORD_SIZE = 4;

// --- Tone and space ----------------------------------------------------------

const BASE_TONE_CUTOFF_HERTZ = 4200;
const MINIMUM_TONE_CUTOFF_HERTZ = 900;
const MAXIMUM_TONE_CUTOFF_HERTZ = 12000;
const MINIMUM_ENERGY_TONE_MULTIPLIER = 0.62;
const ENERGY_TONE_MULTIPLIER_SPREAD = 0.7;
const TONE_JITTER_RATIO = 0.15;

const NEUTRAL_BLOOM_INTENSITY = 1;
const BLOOM_TONE_INFLUENCE = 0.3;
const MINIMUM_BLOOM_INTENSITY = 0.2;
const MAXIMUM_BLOOM_INTENSITY = 2;

const MINIMUM_REVERB_DECAY_SECONDS = 3;
const REVERB_DECAY_SPREAD_SECONDS = 3;
const MINIMUM_REVERB_WET_MIX = 0.34;
const REVERB_WET_MIX_SPREAD = 0.2;
const MINIMUM_DELAY_TIME_SECONDS = 0.3;
const DELAY_TIME_SPREAD_SECONDS = 0.32;
const MINIMUM_DELAY_FEEDBACK = 0.22;
const DELAY_FEEDBACK_SPREAD = 0.18;
const MINIMUM_DELAY_MIX = 0.14;
const DELAY_MIX_SPREAD = 0.14;

// --- Environmental bed -------------------------------------------------------

type BedCharacter = {
  gain: number;
  filterType: AmbientBedFilterType;
  filterFrequencyHertz: number;
  filterQuality: number;
  sweepRateHertz: number;
  sweepDepthHertz: number;
};

const UNIVERSE_BED_BY_THEME: Record<string, BedCharacter> = {
  "cosmic-galaxy": {
    gain: 0.05,
    filterType: "lowpass",
    filterFrequencyHertz: 700,
    filterQuality: 0.6,
    sweepRateHertz: 0.035,
    sweepDepthHertz: 220
  },
  nebula: {
    gain: 0.055,
    filterType: "lowpass",
    filterFrequencyHertz: 600,
    filterQuality: 0.5,
    sweepRateHertz: 0.028,
    sweepDepthHertz: 190
  },
  crystal: {
    gain: 0.038,
    filterType: "lowpass",
    filterFrequencyHertz: 1100,
    filterQuality: 0.9,
    sweepRateHertz: 0.05,
    sweepDepthHertz: 320
  },
  aurora: {
    gain: 0.052,
    filterType: "lowpass",
    filterFrequencyHertz: 900,
    filterQuality: 0.7,
    sweepRateHertz: 0.04,
    sweepDepthHertz: 260
  },
  "cyber-orbit": {
    gain: 0.05,
    filterType: "lowpass",
    filterFrequencyHertz: 850,
    filterQuality: 1.1,
    sweepRateHertz: 0.07,
    sweepDepthHertz: 300
  }
};

const DEFAULT_UNIVERSE_BED: BedCharacter = UNIVERSE_BED_BY_THEME["cosmic-galaxy"];

const FOREST_BASE_BED: BedCharacter = {
  gain: 0.075,
  filterType: "bandpass",
  filterFrequencyHertz: 900,
  filterQuality: 0.9,
  sweepRateHertz: 0.1,
  sweepDepthHertz: 300
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

const WEATHER_BED_MODIFIERS: Record<string, WeatherBedModifier> = {
  clear: NEUTRAL_WEATHER_BED_MODIFIER,
  sunRays: { gainMultiplier: 0.85, frequencyMultiplier: 1.05, qualityMultiplier: 1.1, sweepRateMultiplier: 0.85 },
  overcast: { gainMultiplier: 1.15, frequencyMultiplier: 0.8, qualityMultiplier: 0.75, sweepRateMultiplier: 0.9 },
  // Rain opens the bed, but at frequencyMultiplier 1.7 with a Q of 0.4 it was
  // measured as effectively white noise, burying the music it sits under.
  rain: { gainMultiplier: 1.25, frequencyMultiplier: 1.3, qualityMultiplier: 0.8, sweepRateMultiplier: 1.5 },
  snow: { gainMultiplier: 0.7, frequencyMultiplier: 0.6, qualityMultiplier: 0.6, sweepRateMultiplier: 0.55 }
};

const DEFAULT_WEATHER_INTENSITY = 0.5;

const MINIMUM_BED_GAIN = 0;
const MAXIMUM_BED_GAIN = 0.14;
const MINIMUM_BED_FILTER_HERTZ = 120;
const MAXIMUM_BED_FILTER_HERTZ = 6000;
const MINIMUM_FILTER_QUALITY = 0.2;
const MAXIMUM_FILTER_QUALITY = 4;
const MINIMUM_SWEEP_RATE_HERTZ = 0.01;
const MAXIMUM_SWEEP_RATE_HERTZ = 0.4;

// Dusk drops the key rather than detuning it. Transposing is what a musician
// would do, and it keeps every note on the scale.
const TIME_OF_DAY_TRANSPOSE_SEMITONES: Record<string, number> = {
  day: 0,
  goldenHour: -2,
  dusk: -5
};

const NEUTRAL_POINT_ENERGY = 50;
const MAXIMUM_POINT_ENERGY = 100;

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
 * traits the visitor gave, the energy is what the AI assigned each one.
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

function resolveTransposeSemitones(scene: SceneConfig, isForest: boolean): number {
  if (!isForest) {
    return 0;
  }
  const timeOfDayKey = typeof scene.lighting?.timeOfDay === "string" ? scene.lighting.timeOfDay : "";
  return TIME_OF_DAY_TRANSPOSE_SEMITONES[timeOfDayKey] ?? 0;
}

function resolveBedCharacter(scene: SceneConfig, isForest: boolean): BedCharacter {
  if (!isForest) {
    const theme = typeof scene.theme === "string" ? scene.theme : "";
    return UNIVERSE_BED_BY_THEME[theme] ?? DEFAULT_UNIVERSE_BED;
  }
  const weatherKind = typeof scene.weather?.kind === "string" ? scene.weather.kind : "";
  const modifier = WEATHER_BED_MODIFIERS[weatherKind] ?? NEUTRAL_WEATHER_BED_MODIFIER;
  const rawIntensity = scene.weather?.intensity;
  const intensity = clampToRange(typeof rawIntensity === "number" ? rawIntensity : DEFAULT_WEATHER_INTENSITY, 0, 1);
  return {
    gain: FOREST_BASE_BED.gain * blendTowardNeutral(modifier.gainMultiplier, intensity),
    filterType: FOREST_BASE_BED.filterType,
    filterFrequencyHertz:
      FOREST_BASE_BED.filterFrequencyHertz * blendTowardNeutral(modifier.frequencyMultiplier, intensity),
    filterQuality: FOREST_BASE_BED.filterQuality * blendTowardNeutral(modifier.qualityMultiplier, intensity),
    sweepRateHertz: FOREST_BASE_BED.sweepRateHertz * blendTowardNeutral(modifier.sweepRateMultiplier, intensity),
    sweepDepthHertz: FOREST_BASE_BED.sweepDepthHertz
  };
}

function bloomToneMultiplier(scene: SceneConfig): number {
  const rawBloomIntensity = scene.postFX?.bloomIntensity;
  if (typeof rawBloomIntensity !== "number") {
    return 1;
  }
  const bloomIntensity = clampToRange(rawBloomIntensity, MINIMUM_BLOOM_INTENSITY, MAXIMUM_BLOOM_INTENSITY);
  return 1 + (bloomIntensity - NEUTRAL_BLOOM_INTENSITY) * BLOOM_TONE_INFLUENCE;
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
    return [
      seed,
      FOREST_FAMILY_KEY,
      dnaPart,
      String(scene.season?.kind ?? ""),
      String(scene.lighting?.timeOfDay ?? ""),
      String(scene.weather?.kind ?? ""),
      String(scene.weather?.intensity ?? "")
    ].join("|");
  }
  return [
    seed,
    UNIVERSE_FAMILY_KEY,
    dnaPart,
    String(scene.theme ?? ""),
    String(scene.postFX?.bloomIntensity ?? "")
  ].join("|");
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
  const { pointCount, averageEnergy } = resolveDnaSignals(resolvedScene);
  const energyRatio = averageEnergy / MAXIMUM_POINT_ENERGY;

  const identity = resolveMelodicIdentity(resolvedScene, isForest);
  const transposeSemitones = resolveTransposeSemitones(resolvedScene, isForest);
  const melodyRootMidiNumber = MELODY_ROOT_MIDI_BY_INSTRUMENT[identity.instrument] + transposeSemitones;

  const noteGapMultiplier = ENERGY_NOTE_GAP_MULTIPLIER_AT_ZERO + energyRatio * ENERGY_NOTE_GAP_MULTIPLIER_SPREAD;
  const minimumGapSeconds = MINIMUM_NOTE_GAP_SECONDS * noteGapMultiplier;

  const harmonyChordSize = clampToRange(
    pointCount > 0 ? pointCount : MINIMUM_HARMONY_CHORD_SIZE + Math.floor(nextRandomValue() * 2),
    MINIMUM_HARMONY_CHORD_SIZE,
    MAXIMUM_HARMONY_CHORD_SIZE
  );
  const chordShapeCandidates = HARMONY_CHORD_SHAPES.filter((shape) => shape.length <= harmonyChordSize);
  const chordShape =
    chordShapeCandidates[Math.floor(nextRandomValue() * chordShapeCandidates.length)] ?? HARMONY_CHORD_SHAPES[0];

  const progressionIndex = Math.floor(nextRandomValue() * CHORD_PROGRESSIONS.length);
  const bedCharacter = resolveBedCharacter(resolvedScene, isForest);
  const toneJitter = 1 + (nextRandomValue() * 2 - 1) * TONE_JITTER_RATIO;
  const energyToneMultiplier = MINIMUM_ENERGY_TONE_MULTIPLIER + energyRatio * ENERGY_TONE_MULTIPLIER_SPREAD;
  const harmonyGapSeconds = MINIMUM_HARMONY_GAP_SECONDS + nextRandomValue() * HARMONY_GAP_SPREAD_SECONDS;

  return {
    signature: ambientSoundscapeSignature(resolvedScene),
    masterGain: MASTER_GAIN,
    melody: {
      instrument: identity.instrument,
      scaleSemitones: SCALE_SEMITONES[identity.scaleKey] ?? SCALE_SEMITONES[DEFAULT_SCALE_KEY],
      rootMidiNumber: melodyRootMidiNumber,
      octaveCount: MELODY_OCTAVE_COUNT_BY_INSTRUMENT[identity.instrument],
      minimumGapSeconds,
      maximumGapSeconds: minimumGapSeconds + NOTE_GAP_SPREAD_SECONDS * noteGapMultiplier,
      gain: MELODY_GAIN * INSTRUMENT_LEVEL_TRIM[identity.instrument],
      graceNoteChance: MINIMUM_GRACE_NOTE_CHANCE + nextRandomValue() * GRACE_NOTE_CHANCE_SPREAD
    },
    harmony: {
      instrument: HARMONY_INSTRUMENT_BY_MELODY[identity.instrument],
      chordSemitones: chordShape,
      rootMidiNumber: melodyRootMidiNumber - HARMONY_SEMITONES_BELOW_MELODY,
      minimumGapSeconds: harmonyGapSeconds,
      maximumGapSeconds: harmonyGapSeconds + HARMONY_GAP_SPREAD_SECONDS,
      gain: HARMONY_GAIN * INSTRUMENT_LEVEL_TRIM[HARMONY_INSTRUMENT_BY_MELODY[identity.instrument]],
      spreadSeconds: MINIMUM_HARMONY_SPREAD_SECONDS + nextRandomValue() * HARMONY_SPREAD_SPREAD_SECONDS
    },
    chordProgression: {
      rootOffsetsSemitones: CHORD_PROGRESSIONS[progressionIndex] ?? CHORD_PROGRESSIONS[0],
      changeIntervalSeconds: MINIMUM_CHORD_CHANGE_SECONDS + nextRandomValue() * CHORD_CHANGE_SPREAD_SECONDS
    },
    toneCutoffHertz: clampToRange(
      BASE_TONE_CUTOFF_HERTZ * toneJitter * energyToneMultiplier * bloomToneMultiplier(resolvedScene),
      MINIMUM_TONE_CUTOFF_HERTZ,
      MAXIMUM_TONE_CUTOFF_HERTZ
    ),
    bedGain: clampToRange(bedCharacter.gain, MINIMUM_BED_GAIN, MAXIMUM_BED_GAIN),
    bedFilterType: bedCharacter.filterType,
    bedFilterFrequencyHertz: clampToRange(
      bedCharacter.filterFrequencyHertz,
      MINIMUM_BED_FILTER_HERTZ,
      MAXIMUM_BED_FILTER_HERTZ
    ),
    bedFilterQuality: clampToRange(bedCharacter.filterQuality, MINIMUM_FILTER_QUALITY, MAXIMUM_FILTER_QUALITY),
    bedSweepRateHertz: clampToRange(bedCharacter.sweepRateHertz, MINIMUM_SWEEP_RATE_HERTZ, MAXIMUM_SWEEP_RATE_HERTZ),
    bedSweepDepthHertz: bedCharacter.sweepDepthHertz,
    bedNoiseSeed: `${seed}${BED_NOISE_SEED_SUFFIX}`,
    space: {
      reverbDecaySeconds: MINIMUM_REVERB_DECAY_SECONDS + nextRandomValue() * REVERB_DECAY_SPREAD_SECONDS,
      reverbWetMix: MINIMUM_REVERB_WET_MIX + nextRandomValue() * REVERB_WET_MIX_SPREAD,
      delayTimeSeconds: MINIMUM_DELAY_TIME_SECONDS + nextRandomValue() * DELAY_TIME_SPREAD_SECONDS,
      delayFeedback: MINIMUM_DELAY_FEEDBACK + nextRandomValue() * DELAY_FEEDBACK_SPREAD,
      delayMix: MINIMUM_DELAY_MIX + nextRandomValue() * DELAY_MIX_SPREAD
    },
    performanceSeed: `${seed}${PERFORMANCE_SEED_SUFFIX}`
  };
}
