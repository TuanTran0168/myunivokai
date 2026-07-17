import { Color } from "three";
import type { ForestSeasonConfig, ForestTerrainConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";

// Deterministic forest geometry helpers shared by every forest component.
// All scatter/shape decisions derive from the placement seeds embedded in the
// config (the MilkyWayConfig.Seed pattern): same seed, same forest — on every
// device, on every visit. Each helper opens its OWN suffixed stream so adding
// draws to one never shifts another.

const HILL_SHAPE_SEED_SUFFIX = "-hills";
const PATH_SHAPE_SEED_SUFFIX = "-path";

export const DEFAULT_CLEARING_RADIUS = 9.5;
export const DEFAULT_TREELINE_RADIUS = 40;
const DEFAULT_HILL_AMPLITUDE = 1.4;
const DEFAULT_HILL_FREQUENCY = 0.05;

const FULL_CIRCLE_RADIANS = Math.PI * 2;

// The clearing floor stays flat so landmarks and animals read clearly; hills
// fade in across this band beyond the clearing edge.
const CLEARING_FLATTEN_INNER_FRACTION = 0.65;
const CLEARING_FLATTEN_OUTER_FRACTION = 1.45;

// Path ribbon shape: a gently S-curving dirt line from the clearing to the
// treeline.
const PATH_CURVE_PHASE_RANGE_RADIANS = FULL_CIRCLE_RADIANS;
const MINIMUM_PATH_CURVE_AMPLITUDE_RADIANS = 0.12;
const PATH_CURVE_AMPLITUDE_RANGE_RADIANS = 0.18;
const PATH_CURVE_RADIAL_FREQUENCY = 0.16;

export function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function smoothstepValue(edgeStart: number, edgeEnd: number, value: number): number {
  const t = clampValue((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Mix two hex colors into a fresh THREE.Color (t=0 → colorA). */
export function mixHexColors(colorA: string, colorB: string, t: number): Color {
  return new Color(colorA).lerp(new Color(colorB), clampValue(t, 0, 1));
}

export function clearingRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return terrain?.clearingRadius ?? DEFAULT_CLEARING_RADIUS;
}

export function treelineRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return terrain?.treelineRadius ?? DEFAULT_TREELINE_RADIUS;
}

export type TerrainHeightSampler = (x: number, z: number) => number;

/**
 * Analytic rolling-hill height field: two crossed sine bands plus a diagonal
 * swell, with seeded phases so every forest rolls differently. Analytic (not
 * noise-array) so trees, animals, landmarks and the ground mesh can all sample
 * the exact same surface at any coordinate.
 */
export function createTerrainHeightSampler(terrain?: ForestTerrainConfig): TerrainHeightSampler {
  const nextRandomValue = randomFromSeed((terrain?.placementSeed ?? "forest-terrain") + HILL_SHAPE_SEED_SUFFIX);
  const phaseA = nextRandomValue() * FULL_CIRCLE_RADIANS;
  const phaseB = nextRandomValue() * FULL_CIRCLE_RADIANS;
  const phaseC = nextRandomValue() * FULL_CIRCLE_RADIANS;

  const hillAmplitude = terrain?.hillAmplitude ?? DEFAULT_HILL_AMPLITUDE;
  const hillFrequency = terrain?.hillFrequency ?? DEFAULT_HILL_FREQUENCY;
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const angularFrequency = hillFrequency * FULL_CIRCLE_RADIANS;

  return (x: number, z: number) => {
    const radiusFromCenter = Math.hypot(x, z);
    const clearingFlattenFactor = smoothstepValue(
      clearingRadius * CLEARING_FLATTEN_INNER_FRACTION,
      clearingRadius * CLEARING_FLATTEN_OUTER_FRACTION,
      radiusFromCenter
    );
    const crossedBands =
      Math.sin(x * angularFrequency + phaseA) * Math.cos(z * angularFrequency * 1.7 + phaseB) * 0.65;
    const diagonalSwell = Math.sin((x + z) * angularFrequency * 0.5 + phaseC) * 0.35;
    return hillAmplitude * (crossedBands + diagonalSwell) * clearingFlattenFactor;
  };
}

export type PathLateralDistanceSampler = (x: number, z: number) => number;

/**
 * Lateral distance (in world units) from a point to the dirt path's seeded
 * centerline. Returns Infinity when the config has no path, so callers can
 * use one code path ("is this inside the path band?") either way.
 */
export function createPathLateralDistanceSampler(terrain?: ForestTerrainConfig): PathLateralDistanceSampler {
  if (!terrain?.pathEnabled) {
    return () => Number.POSITIVE_INFINITY;
  }
  const nextRandomValue = randomFromSeed((terrain.placementSeed ?? "forest-terrain") + PATH_SHAPE_SEED_SUFFIX);
  const pathBaseAngle = nextRandomValue() * FULL_CIRCLE_RADIANS;
  const curvePhase = nextRandomValue() * PATH_CURVE_PHASE_RANGE_RADIANS;
  const curveAmplitude = MINIMUM_PATH_CURVE_AMPLITUDE_RADIANS + nextRandomValue() * PATH_CURVE_AMPLITUDE_RANGE_RADIANS;

  return (x: number, z: number) => {
    const radiusFromCenter = Math.hypot(x, z);
    if (radiusFromCenter < 0.001) {
      return Number.POSITIVE_INFINITY;
    }
    const pointAngle = Math.atan2(z, x);
    const pathAngleAtRadius = pathBaseAngle + Math.sin(radiusFromCenter * PATH_CURVE_RADIAL_FREQUENCY + curvePhase) * curveAmplitude;
    let angularDifference = pointAngle - pathAngleAtRadius;
    while (angularDifference > Math.PI) {
      angularDifference -= FULL_CIRCLE_RADIANS;
    }
    while (angularDifference < -Math.PI) {
      angularDifference += FULL_CIRCLE_RADIANS;
    }
    return Math.abs(angularDifference) * radiusFromCenter;
  };
}

// --- Season blending ---------------------------------------------------------

const GROUND_BASE_COLORS_BY_KIND: Record<string, string> = {
  grass: "#4E7D3C",
  leafLitter: "#8A6134",
  snow: "#E9EFF4"
};

const GROUND_KINDS_BY_SEASON_KIND: Record<string, string> = {
  spring: "grass",
  summer: "grass",
  autumn: "leafLitter",
  winter: "snow"
};

const DEFAULT_GROUND_COLOR = GROUND_BASE_COLORS_BY_KIND.grass;

// How much of the blend amount actually shifts the ground color — a full lerp
// at blendAmount 0.6 would read as the wrong season, not a transition.
const GROUND_BLEND_STRENGTH = 0.6;

/**
 * The renderer half of the "giao mùa" contract: the ground color leans toward
 * the adjacent season's ground by blendAmount (schema: "the renderer lerps
 * tint, ground and particle counts toward the adjacent season").
 */
export function blendedGroundColor(season?: ForestSeasonConfig): Color {
  const baseColor = GROUND_BASE_COLORS_BY_KIND[season?.groundKind ?? "grass"] ?? DEFAULT_GROUND_COLOR;
  const blendTowardKind = season?.blendTowardKind;
  const blendAmount = season?.blendAmount ?? 0;
  if (!blendTowardKind || blendAmount <= 0) {
    return new Color(baseColor);
  }
  const towardGroundKind = GROUND_KINDS_BY_SEASON_KIND[blendTowardKind] ?? "grass";
  const towardColor = GROUND_BASE_COLORS_BY_KIND[towardGroundKind] ?? DEFAULT_GROUND_COLOR;
  return mixHexColors(baseColor, towardColor, blendAmount * GROUND_BLEND_STRENGTH);
}

const FALLBACK_FOLIAGE_COLORS = ["#4F9149", "#6FAF5D", "#89C97C"];

// Foliage anchor per adjacent season for the transition tint (one
// representative color is enough — the full palette still comes from the
// primary season).
const FOLIAGE_ANCHOR_COLORS_BY_SEASON_KIND: Record<string, string> = {
  spring: "#89C97C",
  summer: "#4F9149",
  autumn: "#D98E2B",
  winter: "#DDE7EC"
};

const FOLIAGE_BLEND_STRENGTH = 0.5;

/** Foliage palette with the transitional-season tint already applied. */
export function blendedFoliageColors(season?: ForestSeasonConfig): Color[] {
  const paletteHexColors =
    season?.foliageColors && season.foliageColors.length > 0 ? season.foliageColors : FALLBACK_FOLIAGE_COLORS;
  const blendTowardKind = season?.blendTowardKind;
  const blendAmount = season?.blendAmount ?? 0;
  if (!blendTowardKind || blendAmount <= 0) {
    return paletteHexColors.map((hexColor) => new Color(hexColor));
  }
  const anchorColor = FOLIAGE_ANCHOR_COLORS_BY_SEASON_KIND[blendTowardKind] ?? FALLBACK_FOLIAGE_COLORS[0];
  return paletteHexColors.map((hexColor) => mixHexColors(hexColor, anchorColor, blendAmount * FOLIAGE_BLEND_STRENGTH));
}
