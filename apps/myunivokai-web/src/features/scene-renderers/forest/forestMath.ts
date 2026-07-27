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

// Distant terrain: beyond the treeline the ground swells into forested hills
// that rise toward the horizon, so a zoomed-out view meets a ridgeline
// silhouette instead of the flat edge of a finite slab. Multiples of the
// treeline radius.
const DISTANT_RISE_INNER_FRACTION = 0.85;
const DISTANT_RISE_OUTER_FRACTION = 2.6;
const DISTANT_HILL_BASE_RISE = 7.0;
const DISTANT_HILL_UNDULATION = 9.0;
const DISTANT_HILL_FREQUENCY = 0.05;

// Path ribbon shape: a gently S-curving dirt line from the clearing to the
// treeline.
const PATH_CURVE_PHASE_RANGE_RADIANS = FULL_CIRCLE_RADIANS;
const MINIMUM_PATH_CURVE_AMPLITUDE_RADIANS = 0.12;
const PATH_CURVE_AMPLITUDE_RANGE_RADIANS = 0.18;
const PATH_CURVE_RADIAL_FREQUENCY = 0.16;

// --- Water bodies ------------------------------------------------------------
// The lake is the hero of the clearing, not an ornament in it — the owner's
// reference photos are a wide sheet of water filling the valley floor. At this
// size it no longer fits inside the terrain's naturally flat zone, so
// createTerrainHeightSampler CARVES a basin for it (see LAKE_BED_DEPTH). That
// carve is what lets the surface stay planar, and planarity is what keeps
// MeshReflectorMaterial valid.
const LAKE_RADIUS_FRACTION_OF_CLEARING = 0.85;
// How far past the water's edge the ground climbs back to its natural height.
const LAKE_SHORE_BLEND_WIDTH = 2.2;
// How far the bed sits below the water plane. Only has to beat the local hill
// amplitude so no terrain pokes through the surface.
const LAKE_BED_DEPTH = 1.8;
// How far inside the shoreline the bed reaches full depth — the shallow shelf
// that makes the edge read as a beach rather than a step.
const LAKE_BED_SHELF_WIDTH = 3.0;

const RIVER_SHAPE_SEED_SUFFIX = "-river";
/** Half width of the river channel away from the lake, in world units. */
export const RIVER_HALF_WIDTH = 1.55;
const RIVER_MEANDER_AMPLITUDE = 5.5;
const RIVER_MEANDER_WAVELENGTH = 30;
// Stops short of DISTANT_RISE_INNER_FRACTION so the channel never has to climb
// the far ridgeline it would otherwise run straight up.
const RIVER_SPAN_FRACTION_OF_TREELINE = 0.82;

export function lakeShapeSeedFromTerrain(terrain?: ForestTerrainConfig): string {
  return `${terrain?.placementSeed ?? "forest-terrain"}-lake`;
}

/** MEAN radius. The organic outline swings around it — see maximumLakeRadius. */
export function lakeRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return clearingRadiusFromTerrain(terrain) * LAKE_RADIUS_FRACTION_OF_CLEARING;
}

/**
 * The furthest the shoreline ever reaches. THIS is the number anything placed
 * near the lake must clear — using the mean radius instead puts objects in the
 * water wherever the outline bulges.
 */
export function maximumLakeRadiusFromTerrain(terrain?: ForestTerrainConfig): number {
  return lakeRadiusFromTerrain(terrain) * maximumOutlineRadiusFactor();
}

/**
 * SIGNED distance to the shoreline: negative inside the water, positive on dry
 * land, zero exactly at the edge. The terrain carve needs the sign — a clamped
 * distance makes the bed flat right up to the shoreline, which leaves the water
 * plane perched on a vertical wall the depth of the lake.
 */
export function createLakeSignedEdgeDistanceSampler(
  terrain?: ForestTerrainConfig
): (x: number, z: number) => number {
  const outline = createWaterOutline(lakeShapeSeedFromTerrain(terrain));
  const meanRadius = lakeRadiusFromTerrain(terrain);
  return (x: number, z: number) =>
    Math.hypot(x, z) - meanRadius * outline.radiusFactorAt(waterOutlineAngleAt(x, z));
}

/** Distance from a point to the lake's water edge; 0 anywhere inside it. */
export function createLakeEdgeDistanceSampler(terrain?: ForestTerrainConfig): PathLateralDistanceSampler {
  const signedEdgeDistanceSampler = createLakeSignedEdgeDistanceSampler(terrain);
  return (x: number, z: number) => Math.max(0, signedEdgeDistanceSampler(x, z));
}

/**
 * World XZ -> the angle the outline was authored in. The water mesh is built in
 * local XY and laid flat with a -PI/2 X rotation, which maps local (x, y) to
 * world (x, -y); so world angle atan2(z, x) is the NEGATED authoring angle.
 * Getting this backwards silently mirrors the shoreline, and then every
 * exclusion test is wrong exactly where the outline bulges.
 */
export function waterOutlineAngleAt(x: number, z: number): number {
  return -Math.atan2(z, x);
}

export type RiverShape = {
  headingRadians: number;
  meanderPhase: number;
  /** Half length of the channel: it runs -spanRadius..+spanRadius through the lake. */
  spanRadius: number;
};

export function createRiverShape(terrain?: ForestTerrainConfig): RiverShape {
  const nextRandomValue = randomFromSeed((terrain?.placementSeed ?? "forest-terrain") + RIVER_SHAPE_SEED_SUFFIX);
  return {
    headingRadians: nextRandomValue() * FULL_CIRCLE_RADIANS,
    meanderPhase: nextRandomValue() * FULL_CIRCLE_RADIANS,
    spanRadius: treelineRadiusFromTerrain(terrain) * RIVER_SPAN_FRACTION_OF_TREELINE
  };
}

/** Signed lateral meander offset of the centreline at `along` metres from the lake. */
export function riverMeanderOffsetAt(shape: RiverShape, along: number): number {
  return (
    Math.sin((along / RIVER_MEANDER_WAVELENGTH) * FULL_CIRCLE_RADIANS + shape.meanderPhase) * RIVER_MEANDER_AMPLITUDE
  );
}

/** World-space centreline point at `along` metres from the lake. */
export function riverCenterlineAt(shape: RiverShape, along: number): { x: number; z: number } {
  const lateral = riverMeanderOffsetAt(shape, along);
  const directionX = Math.cos(shape.headingRadians);
  const directionZ = Math.sin(shape.headingRadians);
  return {
    x: directionX * along - directionZ * lateral,
    z: directionZ * along + directionX * lateral
  };
}

/**
 * Half width at `along`. The channel widens slightly as it nears the lake, the
 * way a real outflow does, but it no longer flares to lake width: the river is
 * now drawn only OUTSIDE the shoreline, so a flare would just be a wedge lying
 * on top of the water.
 */
export function riverHalfWidthAt(along: number, lakeExitDistance: number): number {
  const distanceBeyondShore = Math.max(0, Math.abs(along) - lakeExitDistance);
  const mouthWidening = Math.exp(-((distanceBeyondShore / 6) ** 2)) * RIVER_HALF_WIDTH * 0.6;
  return RIVER_HALF_WIDTH + mouthWidening;
}

/**
 * Where the channel leaves the lake, per side. Measured from the outline at the
 * river's own heading rather than from the mean radius, so the mouth lands on
 * the shore even where the lake bulges out.
 */
export function riverLakeExitDistance(shape: RiverShape, terrain?: ForestTerrainConfig): number {
  const outline = createWaterOutline(lakeShapeSeedFromTerrain(terrain));
  const meanRadius = lakeRadiusFromTerrain(terrain);
  const directionX = Math.cos(shape.headingRadians);
  const directionZ = Math.sin(shape.headingRadians);
  // Sample both ends of the channel and take the wider one, so neither mouth can
  // start inside the water.
  const forwardFactor = outline.radiusFactorAt(waterOutlineAngleAt(directionX, directionZ));
  const backwardFactor = outline.radiusFactorAt(waterOutlineAngleAt(-directionX, -directionZ));
  return meanRadius * Math.max(forwardFactor, backwardFactor);
}

/**
 * Distance from a point to the WATER EDGE of the river (0 inside the channel),
 * so scatter code can reuse the same "is this too close?" threshold it already
 * applies to the dirt path. Composed with the path sampler in ForestRenderer:
 * anything the water covers must not also grow a tree.
 */
export function createRiverEdgeDistanceSampler(terrain?: ForestTerrainConfig): PathLateralDistanceSampler {
  const shape = createRiverShape(terrain);
  const lakeExitDistance = riverLakeExitDistance(shape, terrain);
  const directionX = Math.cos(shape.headingRadians);
  const directionZ = Math.sin(shape.headingRadians);

  return (x: number, z: number) => {
    // Project onto the channel's axis. The meander is shallow enough that the
    // axis-aligned projection is an accurate stand-in for a true curve
    // distance, and it stays analytic (no polyline walk per query).
    const along = x * directionX + z * directionZ;
    if (Math.abs(along) > shape.spanRadius) {
      return Number.POSITIVE_INFINITY;
    }
    const perpendicular = -x * directionZ + z * directionX;
    const lateralDistance = Math.abs(perpendicular - riverMeanderOffsetAt(shape, along));
    return Math.max(0, lateralDistance - riverHalfWidthAt(along, lakeExitDistance));
  };
}

// A perfect circle never reads as a lake — a real shoreline is lobed and
// uneven. These build the outline as a seeded sum of sine harmonics at INTEGER
// frequencies, which is what makes the loop close exactly at theta = 2*PI (a
// non-integer harmonic leaves a visible notch at the seam). Everything stays at
// a single Y, so the surface is still planar and MeshReflectorMaterial remains
// valid — that planarity is the whole reason the lake sits on flat ground.
const WATER_OUTLINE_HARMONIC_FREQUENCIES = [2, 3, 5];
const WATER_OUTLINE_HARMONIC_AMPLITUDES = [0.16, 0.09, 0.05];
const WATER_OUTLINE_SEGMENTS = 96;

export type WaterOutline = {
  /** Radius multiplier at an angle; averages ~1 so `radius` stays the mean. */
  radiusFactorAt: (angleRadians: number) => number;
  segments: number;
};

export function createWaterOutline(seedText: string): WaterOutline {
  const nextRandomValue = randomFromSeed(seedText + "-water-outline");
  const harmonics = WATER_OUTLINE_HARMONIC_FREQUENCIES.map((frequency, harmonicIndex) => ({
    frequency,
    phase: nextRandomValue() * FULL_CIRCLE_RADIANS,
    amplitude: WATER_OUTLINE_HARMONIC_AMPLITUDES[harmonicIndex]
  }));
  return {
    segments: WATER_OUTLINE_SEGMENTS,
    radiusFactorAt: (angleRadians: number) => {
      let factor = 1;
      for (const harmonic of harmonics) {
        factor += Math.sin(harmonic.frequency * angleRadians + harmonic.phase) * harmonic.amplitude;
      }
      // Sines average to zero, so the mean factor is 1; the floor only guards
      // against a pathological seed pinching the shore through the centre.
      return Math.max(0.45, factor);
    }
  };
}

/** Largest radius the outline reaches — what neighbours must stay clear of. */
export function maximumOutlineRadiusFactor(): number {
  return 1 + WATER_OUTLINE_HARMONIC_AMPLITUDES.reduce((sum, amplitude) => sum + amplitude, 0);
}

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
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const angularFrequency = hillFrequency * FULL_CIRCLE_RADIANS;
  const signedLakeEdgeDistanceSampler = createLakeSignedEdgeDistanceSampler(terrain);

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
    const rollingHills = hillAmplitude * (crossedBands + diagonalSwell) * clearingFlattenFactor;

    // Carve the lake basin. Without this the ground keeps rolling under a planar
    // water surface and hilltops poke through the middle of the lake — which is
    // the whole reason the lake could not simply be made bigger.
    //
    // The carve is built around the SIGNED shore distance so the surface passes
    // through exactly zero at the waterline: it shelves down to LAKE_BED_DEPTH
    // going inward, and climbs back to the natural hills going outward. Driving
    // it from a clamped distance instead leaves the bed flat all the way to the
    // edge, and then the water plane sits on top of a wall as deep as the lake.
    const signedShoreDistance = signedLakeEdgeDistanceSampler(x, z);
    const nearHills =
      signedShoreDistance >= 0
        ? rollingHills * smoothstepValue(0, LAKE_SHORE_BLEND_WIDTH, signedShoreDistance)
        : -LAKE_BED_DEPTH * smoothstepValue(0, LAKE_BED_SHELF_WIDTH, -signedShoreDistance);

    // Distant forested hills: ramp up past the treeline so the far horizon is
    // a rolling ridgeline, not the cut edge of a flat slab.
    const distantRise = smoothstepValue(
      treelineRadius * DISTANT_RISE_INNER_FRACTION,
      treelineRadius * DISTANT_RISE_OUTER_FRACTION,
      radiusFromCenter
    );
    if (distantRise <= 0) {
      return nearHills;
    }
    const distantAngularFrequency = DISTANT_HILL_FREQUENCY;
    const distantUndulation =
      (Math.sin(x * distantAngularFrequency + phaseB * 1.7) * Math.cos(z * distantAngularFrequency * 1.3 + phaseC) * 0.5 +
        0.5) *
      DISTANT_HILL_UNDULATION;
    const distantHills = (DISTANT_HILL_BASE_RISE + distantUndulation) * Math.pow(distantRise, 1.4);
    return nearHills + distantHills;
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
