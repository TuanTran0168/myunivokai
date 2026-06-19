import type { PlanetSceneConfig, SceneConfig, ScenePalette, World, WorldVariant } from "./types";

const FALLBACK_PALETTE = ["#8B5CF6", "#06B6D4", "#FACC15", "#44624a", "#101418"];
const FALLBACK_BACKGROUND_COLOR = "#050816";
const MAXIMUM_PALETTE_COLORS = 6;

/**
 * The single fallback seed for the whole frontend. Every renderer must derive
 * its seed from here (UniverseCanvas imports it) so the same world never draws
 * a different star field / orbit layout depending on which page renders it.
 */
export const CANONICAL_FALLBACK_SEED = "myunivokai";

export function selectedVariant(world: World): WorldVariant | undefined {
  return (
    world.variants.find((variant) => variant.id === world.selectedVariantId) ??
    world.variants.find((variant) => variant.selected) ??
    world.variants[0]
  );
}

/**
 * Resolves the deterministic seed for a variant. Tried in order: the variant
 * seed, the seed embedded in its scene config, the variant id, then the
 * canonical fallback. This is the ONLY place seed resolution happens, so every
 * page agrees on the seed for a given variant.
 */
export function resolveVariantSeed(variant?: WorldVariant): string {
  return (
    variant?.seed ??
    variant?.sceneConfig?.seed ??
    variant?.id ??
    CANONICAL_FALLBACK_SEED
  );
}

/**
 * Builds the SceneConfig the canvas renders for a variant. Used by every page
 * (world dashboard and public share) so a given variant always renders the
 * same way. The resolved seed is written last so a stale seed inside
 * sceneConfig can never override it.
 */
export function sceneFromVariant(variant?: WorldVariant): SceneConfig {
  return {
    ...(variant?.sceneConfig ?? {}),
    seed: resolveVariantSeed(variant)
  };
}

function isPaletteObject(palette: SceneConfig["palette"]): palette is ScenePalette {
  return Boolean(palette) && typeof palette === "object" && !Array.isArray(palette);
}

export function paletteFromScene(scene?: SceneConfig): string[] {
  const palette = scene?.palette;
  if (Array.isArray(palette) && palette.every((color) => typeof color === "string")) {
    return palette.slice(0, MAXIMUM_PALETTE_COLORS);
  }
  if (isPaletteObject(palette)) {
    const orderedColors = [
      palette.primary,
      palette.secondary,
      palette.accent,
      palette.background,
      ...(Array.isArray(palette.gradient) ? palette.gradient : [])
    ].filter((color): color is string => typeof color === "string" && color.length > 0);
    if (orderedColors.length > 0) {
      return orderedColors.slice(0, MAXIMUM_PALETTE_COLORS);
    }
  }
  return FALLBACK_PALETTE;
}

export function backgroundColorFromScene(scene?: SceneConfig): string {
  const palette = scene?.palette;
  if (isPaletteObject(palette) && typeof palette.background === "string" && palette.background.length > 0) {
    return palette.background;
  }
  return FALLBACK_BACKGROUND_COLOR;
}

export function planetsFromScene(scene?: SceneConfig): PlanetSceneConfig[] {
  if (!scene?.planets || !Array.isArray(scene.planets)) {
    return [];
  }
  return scene.planets.filter((planet) => typeof planet === "object" && planet !== null);
}

export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function randomFromSeed(seed: string) {
  let value = hashSeed(seed) || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) % 10000) / 10000;
  };
}

// --- Live DNA preview -------------------------------------------------------
//
// The create page must show what the generated universe will look like without
// calling the backend / AI (which only happens on submit). The preview is a
// deterministic local SceneConfig built from the current form inputs, rendered
// by the SAME SolarSystemRenderer the real world uses, so the preview matches
// the look-and-feel of the result. The value ranges below mirror the backend
// scene builder (services/.../world_config_builder.go) so the preview looks
// native rather than like an abstract placeholder.

export type PreviewSceneInput = {
  nickname: string;
  interests: string[];
  traits: string[];
  mood: string;
  preferredWorldStyle: string;
  favoriteColors: string[];
};

const DEFAULT_PREVIEW_PRIMARY_COLOR = "#8B5CF6";
const DEFAULT_PREVIEW_SECONDARY_COLOR = "#06B6D4";
const PREVIEW_ACCENT_COLOR = "#FACC15";
const PREVIEW_BACKGROUND_COLOR = "#050816";
const PREVIEW_SCHEMA_VERSION = "1.0";

const MINIMUM_PREVIEW_PLANET_COUNT = 3;
const MAXIMUM_PREVIEW_PLANET_COUNT = 7;
const MINIMUM_PLANET_NAME_LENGTH = 2;
const MAXIMUM_PLANET_NAME_LENGTH = 40;
const DEFAULT_PREVIEW_PLANET_NAMES = ["Core", "Drive", "Spark", "Origin"];

const MINIMUM_PLANET_SIZE = 0.45;
const PLANET_SIZE_RANGE = 0.8;
const FIRST_PLANET_ORBIT_RADIUS = 3.2;
const ORBIT_RADIUS_STEP_PER_PLANET = 1.05;
const ORBIT_RADIUS_JITTER_RANGE = 0.65;
const MINIMUM_PLANET_ORBIT_SPEED = 0.04;
const PLANET_ORBIT_SPEED_RANGE = 0.32;
const MINIMUM_PLANET_ENERGY = 30;
const PLANET_ENERGY_RANGE = 65;

const MINIMUM_CORE_SCALE = 1.05;
const CORE_SCALE_RANGE = 0.45;
const MINIMUM_CORE_SPIN_SPEED = 0.08;
const CORE_SPIN_SPEED_RANGE = 0.18;
const PREVIEW_CORE_SHAPES = ["sphere", "octahedron", "torus", "box"];

const MINIMUM_DESKTOP_PARTICLE_COUNT = 600;
const DESKTOP_PARTICLE_COUNT_RANGE = 900;
const MINIMUM_MOBILE_PARTICLE_COUNT = 250;
const MOBILE_PARTICLE_COUNT_RANGE = 450;
const MINIMUM_PARTICLE_SPREAD = 12;
const PARTICLE_SPREAD_RANGE = 8;

const MINIMUM_CAMERA_DISTANCE = 7;
const CAMERA_DISTANCE_RANGE = 5;
const PREVIEW_CAMERA_FIELD_OF_VIEW = 50;

const MINIMUM_BLOOM_INTENSITY = 0.3;
const BLOOM_INTENSITY_RANGE = 1.1;

const FULL_CIRCLE_RADIANS = Math.PI * 2;
const PLANET_COLOR_CYCLE_LENGTH = 3;

// Mirror of services/universe-service/internal/services/mood_scene_profile.go.
// The atmospheric mood tunes glow, star density, motion and background; keeping
// these values identical to the backend keeps the preview and the generated
// world reacting to mood in the same direction.
type MoodSceneProfile = {
  bloomMultiplier: number;
  particleMultiplier: number;
  motionMultiplier: number;
  backgroundColor: string;
};

const NEUTRAL_MOOD_SCENE_PROFILE: MoodSceneProfile = {
  bloomMultiplier: 1,
  particleMultiplier: 1,
  motionMultiplier: 1,
  backgroundColor: PREVIEW_BACKGROUND_COLOR
};

const MOOD_SCENE_PROFILES: Record<string, MoodSceneProfile> = {
  focused: { bloomMultiplier: 1, particleMultiplier: 1, motionMultiplier: 1, backgroundColor: "#050816" },
  dreamy: { bloomMultiplier: 1.4, particleMultiplier: 1.25, motionMultiplier: 0.7, backgroundColor: "#0b0720" },
  energetic: { bloomMultiplier: 1.5, particleMultiplier: 1.2, motionMultiplier: 1.5, backgroundColor: "#140712" },
  reflective: { bloomMultiplier: 0.65, particleMultiplier: 0.7, motionMultiplier: 0.6, backgroundColor: "#04070c" }
};

const MINIMUM_BLOOM_INTENSITY_CLAMP = 0.2;
const MAXIMUM_BLOOM_INTENSITY_CLAMP = 1.8;

export function moodSceneProfile(mood: string): MoodSceneProfile {
  return MOOD_SCENE_PROFILES[mood.trim().toLowerCase()] ?? NEUTRAL_MOOD_SCENE_PROFILE;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function previewSeedFromInputs(input: PreviewSceneInput): string {
  return [
    "preview",
    input.nickname.trim(),
    input.preferredWorldStyle,
    input.mood,
    input.interests.join("-"),
    input.traits.join("-"),
    input.favoriteColors.join("-")
  ].join("|");
}

function previewPlanetColor(planetIndex: number, primaryColor: string, secondaryColor: string): string {
  const colorCyclePosition = planetIndex % PLANET_COLOR_CYCLE_LENGTH;
  if (colorCyclePosition === 1) {
    return PREVIEW_ACCENT_COLOR;
  }
  if (colorCyclePosition === 2) {
    return primaryColor;
  }
  return secondaryColor;
}

// Names the preview planets from the user's interests then traits, deduplicated
// and clamped to 3-7. This mirrors the backend mock's collectPlanetSources
// (services/.../mock_presets.go) so the preview shows the same planet count and
// names as the generated world.
function previewPlanetNames(interests: string[], traits: string[]): string[] {
  const seenNames = new Set<string>();
  const planetNames: string[] = [];
  const addName = (rawName: string) => {
    // Mirror the backend sanitizePlanetName: measure and truncate by code point
    // (Go []rune semantics) BEFORE computing the dedup key, so names that only
    // differ past the 40th character dedup the same way on both sides.
    const trimmedName = rawName.trim();
    const codePoints = Array.from(trimmedName);
    if (codePoints.length < MINIMUM_PLANET_NAME_LENGTH) {
      return;
    }
    const name =
      codePoints.length > MAXIMUM_PLANET_NAME_LENGTH
        ? codePoints.slice(0, MAXIMUM_PLANET_NAME_LENGTH).join("").trim()
        : trimmedName;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      return;
    }
    seenNames.add(nameKey);
    planetNames.push(name);
  };

  interests.forEach(addName);
  traits.forEach(addName);
  for (const fallbackName of DEFAULT_PREVIEW_PLANET_NAMES) {
    if (planetNames.length >= MINIMUM_PREVIEW_PLANET_COUNT) {
      break;
    }
    addName(fallbackName);
  }
  return planetNames.slice(0, MAXIMUM_PREVIEW_PLANET_COUNT);
}

export function buildPreviewSceneConfig(input: PreviewSceneInput): SceneConfig {
  const seed = previewSeedFromInputs(input);
  const nextRandomValue = randomFromSeed(seed);

  const primaryColor = input.favoriteColors[0] ?? DEFAULT_PREVIEW_PRIMARY_COLOR;
  const secondaryColor = input.favoriteColors[1] ?? DEFAULT_PREVIEW_SECONDARY_COLOR;
  const moodProfile = moodSceneProfile(input.mood);

  const planetNameSources = previewPlanetNames(input.interests, input.traits);
  const planetCount = planetNameSources.length;

  const planets: PlanetSceneConfig[] = Array.from({ length: planetCount }, (_, planetIndex) => ({
    key: `preview-planet-${planetIndex + 1}`,
    name: planetNameSources[planetIndex] ?? `Orbit ${planetIndex + 1}`,
    color: previewPlanetColor(planetIndex, primaryColor, secondaryColor),
    size: roundToTwoDecimals(MINIMUM_PLANET_SIZE + nextRandomValue() * PLANET_SIZE_RANGE),
    orbitRadius: roundToTwoDecimals(
      FIRST_PLANET_ORBIT_RADIUS +
        planetIndex * ORBIT_RADIUS_STEP_PER_PLANET +
        nextRandomValue() * ORBIT_RADIUS_JITTER_RANGE
    ),
    orbitSpeed: roundToTwoDecimals(
      (MINIMUM_PLANET_ORBIT_SPEED + nextRandomValue() * PLANET_ORBIT_SPEED_RANGE) * moodProfile.motionMultiplier
    ),
    phase: roundToTwoDecimals(nextRandomValue() * FULL_CIRCLE_RADIANS),
    energy: Math.round(MINIMUM_PLANET_ENERGY + nextRandomValue() * PLANET_ENERGY_RANGE)
  }));

  const coreShape = PREVIEW_CORE_SHAPES[Math.floor(nextRandomValue() * PREVIEW_CORE_SHAPES.length)];
  const coreScale = roundToTwoDecimals(MINIMUM_CORE_SCALE + nextRandomValue() * CORE_SCALE_RANGE);
  const coreSpinSpeed = roundToTwoDecimals(
    (MINIMUM_CORE_SPIN_SPEED + nextRandomValue() * CORE_SPIN_SPEED_RANGE) * moodProfile.motionMultiplier
  );

  const desktopParticleCount = Math.floor(
    (MINIMUM_DESKTOP_PARTICLE_COUNT + Math.floor(nextRandomValue() * (DESKTOP_PARTICLE_COUNT_RANGE + 1))) *
      moodProfile.particleMultiplier
  );
  const mobileParticleCount = Math.floor(
    (MINIMUM_MOBILE_PARTICLE_COUNT + Math.floor(nextRandomValue() * (MOBILE_PARTICLE_COUNT_RANGE + 1))) *
      moodProfile.particleMultiplier
  );
  const particleSpread = roundToTwoDecimals(MINIMUM_PARTICLE_SPREAD + nextRandomValue() * PARTICLE_SPREAD_RANGE);

  const cameraDistance = roundToTwoDecimals(MINIMUM_CAMERA_DISTANCE + nextRandomValue() * CAMERA_DISTANCE_RANGE);
  const bloomIntensity = roundToTwoDecimals(
    clampNumber(
      (MINIMUM_BLOOM_INTENSITY + nextRandomValue() * BLOOM_INTENSITY_RANGE) * moodProfile.bloomMultiplier,
      MINIMUM_BLOOM_INTENSITY_CLAMP,
      MAXIMUM_BLOOM_INTENSITY_CLAMP
    )
  );

  return {
    seed,
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    theme: input.preferredWorldStyle,
    palette: {
      background: moodProfile.backgroundColor,
      primary: primaryColor,
      secondary: secondaryColor,
      accent: PREVIEW_ACCENT_COLOR,
      gradient: [primaryColor, secondaryColor, PREVIEW_ACCENT_COLOR]
    },
    core: {
      shape: coreShape,
      color: primaryColor,
      emissive: secondaryColor,
      scale: coreScale,
      spinSpeed: coreSpinSpeed
    },
    planets,
    particles: {
      desktopCount: desktopParticleCount,
      mobileCount: mobileParticleCount,
      color: secondaryColor,
      spread: particleSpread
    },
    camera: {
      distance: cameraDistance,
      fov: PREVIEW_CAMERA_FIELD_OF_VIEW
    },
    postFX: { bloomIntensity },
    hud: { showTraitBars: true, showLabels: true }
  };
}
