import { isForestScene, randomFromSeed } from "./scene";
import type { SceneConfig } from "./types";

// --- Procedural ambient soundscape recipe ------------------------------------
//
// The audio counterpart of the scene config: a pure numeric recipe for a drone
// pad plus a filtered noise bed, derived from the SAME seed the visuals use.
// Nothing here touches the Web Audio API — this module is the deterministic
// half, unit-testable in a node environment. features/audio turns a recipe into
// actual nodes.
//
// Two rules carried over from the scene builders:
//
// 1. `Math.random()` is banned. Every rolled value comes from randomFromSeed on
//    a dedicated stream suffix, so the same world always sounds the same, and
//    adding an audio roll can never shift a visual roll.
// 2. Character comes from the config the backend already produced — the
//    universe `theme`, the forest `weather`/`lighting`/`season` — not from a
//    parallel table of moods the scene does not carry. A rainy dusk forest is
//    audibly a rainy dusk forest.
//
// Every output is clamped. A soundscape is played straight into someone's ears,
// so an out-of-range config must degrade to something quiet and dull rather
// than something loud and shrill.

export type AmbientWaveform = "sine" | "triangle";
export type AmbientBedFilterType = "lowpass" | "bandpass";

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
  /** Filtered noise under the pad: space rumble, or wind through leaves. */
  bedGain: number;
  bedFilterType: AmbientBedFilterType;
  bedFilterFrequencyHertz: number;
  bedFilterQuality: number;
  /** Slow sweep of the bed filter — gusts in a forest, tide in space. */
  bedSweepRateHertz: number;
  bedSweepDepthHertz: number;
  /** Seed for the looping noise buffer, so even the hiss is reproducible. */
  bedNoiseSeed: string;
};

const AMBIENT_AUDIO_SEED_SUFFIX = "-ambient-audio";
const BED_NOISE_SEED_SUFFIX = "-ambient-bed";

const FALLBACK_SCENE_SEED = "myunivokai-silent";
const UNIVERSE_FAMILY_KEY = "universe";
const FOREST_FAMILY_KEY = "forest";

// Deliberately quiet. This plays behind a scene nobody opened for the audio;
// it should sit under a conversation, not over one.
const MASTER_GAIN = 0.22;

const MINIMUM_DRONE_VOICE_COUNT = 3;
const DRONE_VOICE_COUNT_SPREAD = 2;

// Harmonic ratios above the root. Fixed stacks rather than rolled intervals:
// random ratios produce beating dissonance about as often as they produce a
// chord, and a pad that is subtly out of tune is worse than no pad.
const DRONE_INTERVAL_STACKS: number[][] = [
  [1, 1.5, 2], // root, fifth, octave — open and stable
  [1, 1.5, 2, 3], // adds the twelfth for air at the top
  [1, 4 / 3, 2], // root, fourth, octave — suspended, unresolved
  [1, 1.2, 1.5], // root, minor third, fifth — inward
  [1, 1.25, 1.5, 2] // root, major third, fifth, octave — warm
];

// Upper partials carry less weight, or the pad turns into a whistle.
const DRONE_BASE_VOICE_GAIN = 0.5;
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
const MAXIMUM_BED_GAIN = 0.3;
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

// Universe themes. Low sine roots and a deep lowpass bed: the reference is a
// pressurised hull, not weather.
const UNIVERSE_CHARACTER_BY_THEME: Record<string, SoundscapeCharacter> = {
  "cosmic-galaxy": {
    rootFrequencyHertz: 55, // A1
    waveform: "sine",
    droneFilterCutoffHertz: 620,
    bedGain: 0.05,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 200,
    bedFilterQuality: 0.6,
    bedSweepRateHertz: 0.035,
    bedSweepDepthHertz: 70
  },
  nebula: {
    rootFrequencyHertz: 49, // G1
    waveform: "sine",
    droneFilterCutoffHertz: 520,
    bedGain: 0.06,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 170,
    bedFilterQuality: 0.5,
    bedSweepRateHertz: 0.028,
    bedSweepDepthHertz: 60
  },
  crystal: {
    rootFrequencyHertz: 73.42, // D2
    waveform: "triangle",
    droneFilterCutoffHertz: 1400,
    bedGain: 0.035,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 320,
    bedFilterQuality: 0.9,
    bedSweepRateHertz: 0.05,
    bedSweepDepthHertz: 110
  },
  aurora: {
    rootFrequencyHertz: 65.41, // C2
    waveform: "sine",
    droneFilterCutoffHertz: 900,
    bedGain: 0.055,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 260,
    bedFilterQuality: 0.7,
    bedSweepRateHertz: 0.04,
    bedSweepDepthHertz: 90
  },
  "cyber-orbit": {
    rootFrequencyHertz: 61.74, // B1
    waveform: "triangle",
    droneFilterCutoffHertz: 1100,
    bedGain: 0.05,
    bedFilterType: "lowpass",
    bedFilterFrequencyHertz: 240,
    bedFilterQuality: 1.1,
    bedSweepRateHertz: 0.07,
    bedSweepDepthHertz: 130
  }
};

const DEFAULT_UNIVERSE_CHARACTER: SoundscapeCharacter = UNIVERSE_CHARACTER_BY_THEME["cosmic-galaxy"];

// Forest base. Higher triangle root and a bandpass bed centred where wind in
// foliage actually lives; weather and time of day bend it from here.
const FOREST_BASE_CHARACTER: SoundscapeCharacter = {
  rootFrequencyHertz: 98, // G2
  waveform: "triangle",
  droneFilterCutoffHertz: 1200,
  bedGain: 0.12,
  bedFilterType: "bandpass",
  bedFilterFrequencyHertz: 760,
  bedFilterQuality: 0.9,
  bedSweepRateHertz: 0.1,
  bedSweepDepthHertz: 260
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
  rain: { gainMultiplier: 1.9, frequencyMultiplier: 1.7, qualityMultiplier: 0.4, sweepRateMultiplier: 1.5 },
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

function clampToRange(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function blendTowardNeutral(modifierValue: number, blendAmount: number): number {
  return 1 + (modifierValue - 1) * blendAmount;
}

function resolveWeatherBedModifier(scene: SceneConfig): WeatherBedModifier {
  const weatherKind = typeof scene.weather?.kind === "string" ? scene.weather.kind : "";
  const modifier = WEATHER_BED_MODIFIERS[weatherKind] ?? NEUTRAL_WEATHER_BED_MODIFIER;
  const rawIntensity = scene.weather?.intensity;
  const intensity = clampToRange(
    typeof rawIntensity === "number" ? rawIntensity : DEFAULT_WEATHER_INTENSITY,
    0,
    1
  );
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
    const breathRateHertz = MINIMUM_BREATH_RATE_HERTZ + nextRandomValue() * BREATH_RATE_SPREAD_HERTZ;
    const breathDepth = MINIMUM_BREATH_DEPTH + nextRandomValue() * BREATH_DEPTH_SPREAD;
    return {
      frequencyHertz,
      waveform: character.waveform,
      gain,
      detuneCents,
      breathRateHertz,
      breathDepth
    };
  });
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
  if (isForestScene(scene)) {
    const weatherKind = String(scene.weather?.kind ?? "");
    const weatherIntensity = String(scene.weather?.intensity ?? "");
    const timeOfDay = String(scene.lighting?.timeOfDay ?? "");
    const seasonKind = String(scene.season?.kind ?? "");
    return `${seed}|${FOREST_FAMILY_KEY}|${seasonKind}|${timeOfDay}|${weatherKind}|${weatherIntensity}`;
  }
  const theme = String(scene.theme ?? "");
  const bloomIntensity = String(scene.postFX?.bloomIntensity ?? "");
  return `${seed}|${UNIVERSE_FAMILY_KEY}|${theme}|${bloomIntensity}`;
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

  const rootFrequencyJitter = 1 + (nextRandomValue() * 2 - 1) * ROOT_FREQUENCY_JITTER_RATIO;
  const cutoffJitter = 1 + (nextRandomValue() * 2 - 1) * CUTOFF_JITTER_RATIO;

  const requestedVoiceCount =
    MINIMUM_DRONE_VOICE_COUNT +
    Math.floor(nextRandomValue() * DRONE_VOICE_COUNT_SPREAD) +
    (isForest ? seasonVoiceCountOffset(resolvedScene) : 0);
  const voiceCount = clampToRange(
    requestedVoiceCount,
    MINIMUM_DRONE_VOICE_COUNT,
    MINIMUM_DRONE_VOICE_COUNT + DRONE_VOICE_COUNT_SPREAD
  );

  const intervalStackIndex = Math.floor(nextRandomValue() * DRONE_INTERVAL_STACKS.length);
  const intervalStack = DRONE_INTERVAL_STACKS[intervalStackIndex] ?? DRONE_INTERVAL_STACKS[0];

  const jitteredCharacter: SoundscapeCharacter = {
    ...character,
    rootFrequencyHertz: character.rootFrequencyHertz * rootFrequencyJitter
  };
  const droneVoices = buildDroneVoices(jitteredCharacter, intervalStack.slice(0, voiceCount), nextRandomValue);

  return {
    signature: ambientSoundscapeSignature(resolvedScene),
    masterGain: MASTER_GAIN,
    droneVoices,
    droneFilterCutoffHertz: clampToRange(
      character.droneFilterCutoffHertz * cutoffJitter * bloomCutoffMultiplier(resolvedScene),
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
    bedNoiseSeed: `${seed}${BED_NOISE_SEED_SUFFIX}`
  };
}
