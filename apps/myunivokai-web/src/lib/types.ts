export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
    requestId?: string;
  };
};

/**
 * Which backend a world belongs to. Every world service exposes the same
 * route shapes and error taxonomy; only the base URL and the scene family
 * differ. "universe" is universe-service (solar systems), "nature" is
 * nature-service (forest portraits).
 */
export type WorldFamily = "universe" | "nature";

export type GenerationJobStatus = "queued" | "processing" | "completed" | "failed";

export type GenerationJob = {
  jobId: string;
  family: WorldFamily;
  status: GenerationJobStatus;
  worldId?: string;
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
  };
  createdAt: string;
  updatedAt: string;
};

// Mirrors services/universe-service/internal/models/scene.go (contracts/schemas/world-scene-config.schema.json)
export type ScenePalette = {
  background?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  gradient?: string[];
};

export type SceneCoreConfig = {
  shape?: string;
  color?: string;
  emissive?: string;
  scale?: number;
  spinSpeed?: number;
};

export type PlanetSceneConfig = {
  key?: string;
  name?: string;
  meaning?: string;
  color?: string;
  size?: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  phase?: number;
  energy?: number;
};

export type SceneParticleConfig = {
  desktopCount?: number;
  mobileCount?: number;
  color?: string;
  spread?: number;
};

export type SceneCameraConfig = {
  distance?: number;
  fov?: number;
};

// Added in schemaVersion 1.2 (promoted from the per-theme grade table).
// Absent on worlds generated before it — PostEffects falls back to the table.
export type ScenePostFXGradeConfig = {
  hueRadians?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
};

export type ScenePostFXConfig = {
  bloomIntensity?: number;
  grade?: ScenePostFXGradeConfig;
};

export type SceneHUDConfig = {
  showTraitBars?: boolean;
  showLabels?: boolean;
};

export type WeightedSkyColor = {
  color?: string;
  weight?: number;
};

export type SceneMilkyWayConfig = {
  seed?: string;
  allSkyStarCount?: number;
  bandStarCount?: number;
  coreStarCount?: number;
  heroStarCount?: number;
  nebulaCloudCount?: number;
  coreCloudCount?: number;
  dustCloudCount?: number;
  starColors?: WeightedSkyColor[];
  coreStarColors?: WeightedSkyColor[];
  nebulaCloudColors?: WeightedSkyColor[];
  coreCloudColors?: WeightedSkyColor[];
  dustCloudColors?: WeightedSkyColor[];
  nebulaCloudOpacity?: number;
  coreCloudOpacity?: number;
  dustCloudOpacity?: number;
  bandTiltXRadians?: number;
  bandTiltZRadians?: number;
  rotationRadiansPerSecond?: number;
};

export type SceneConstellationConfig = {
  seed?: string;
  displayCount?: number;
  starColor?: string;
  lineColor?: string;
  glowMultiplier?: number;
  rotationRadiansPerSecond?: number;
};

// Added in schemaVersion 1.1. Absent on worlds generated before it — renderers
// fall back to their built-in sky defaults.
export type SceneSkyConfig = {
  milkyWay?: SceneMilkyWayConfig;
  constellations?: SceneConstellationConfig;
};

// Added in schemaVersion 1.2. Absent on worlds generated before it — the
// AsteroidBelt renderer falls back to its built-in defaults.
export type SceneBeltConfig = {
  enabled?: boolean;
  instanceCount?: number;
  gapBeyondLastOrbit?: number;
  rockColor?: string;
  tiltXRadians?: number;
  tiltZRadians?: number;
};

// Added in schemaVersion 1.2. Absent on worlds generated before it — the
// renderer falls back to a single comet with a neutral tail.
export type SceneCometsConfig = {
  count?: number;
  tailLengthMultiplier?: number;
};

// Added in schemaVersion 1.2. Absent on worlds generated before it — the Sun
// renderer falls back to the built-in warm-yellow star.
export type SceneSunConfig = {
  surfaceTintColor?: string;
  glowColor?: string;
  lightColor?: string;
  surfaceHdrMultiplier?: number;
};

// --- Forest scene family (nature-service) -----------------------------------
// Mirrors services/nature-service/internal/models/scene.go
// (contracts/scenes/forest-scene-config.schema.json). Renderers are keyed by
// (sceneType, schemaVersion); every field is optional on the frontend so a
// partially-migrated config degrades instead of crashing.

export type ForestSeasonConfig = {
  kind?: string;
  blendTowardKind?: string;
  blendAmount?: number;
  foliageColors?: string[];
  groundKind?: string;
};

export type ForestLightingConfig = {
  timeOfDay?: string;
  sunElevationRadians?: number;
  sunAzimuthRadians?: number;
  sunColor?: string;
  ambientColor?: string;
  hdriKey?: string;
  exposure?: number;
  fogColor?: string;
  fogDensity?: number;
};

export type ForestTerrainConfig = {
  placementSeed?: string;
  clearingRadius?: number;
  treelineRadius?: number;
  hillAmplitude?: number;
  hillFrequency?: number;
  pathEnabled?: boolean;
  rockCount?: number;
  grassTuftCountDesktop?: number;
  grassTuftCountMobile?: number;
};

export type ForestTreeSpeciesMixEntry = {
  modelKey?: string;
  weight?: number;
};

export type ForestTreesConfig = {
  placementSeed?: string;
  countDesktop?: number;
  countMobile?: number;
  speciesMix?: ForestTreeSpeciesMixEntry[];
  scaleMin?: number;
  scaleMax?: number;
  foliageTintStrength?: number;
  windStrength?: number;
  windDirectionRadians?: number;
  windGustFrequency?: number;
};

export type ForestWeatherConfig = {
  kind?: string;
  intensity?: number;
  cloudCoverage?: number;
  rainDropCountDesktop?: number;
  rainDropCountMobile?: number;
  snowflakeCountDesktop?: number;
  snowflakeCountMobile?: number;
};

export type ForestGroundAnimalConfig = {
  modelKey?: string;
  count?: number;
  pathSeed?: string;
  walkSpeed?: number;
  scale?: number;
};

export type ForestBirdFlockConfig = {
  modelKey?: string;
  birdCount?: number;
  pathSeed?: string;
  altitudeMin?: number;
  altitudeMax?: number;
  flightSpeed?: number;
  pattern?: string;
};

export type ForestWildlifeConfig = {
  groundAnimals?: ForestGroundAnimalConfig[];
  birdFlocks?: ForestBirdFlockConfig[];
};

export type ForestAmbientParticlesConfig = {
  fallingLeafCount?: number;
  blossomPetalCount?: number;
  fireflyCount?: number;
  snowDustCount?: number;
};

export type ForestLandmarkConfig = {
  key?: string;
  name?: string;
  meaning?: string;
  kind?: string;
  angleRadians?: number;
  radiusFromCenter?: number;
  accentColor?: string;
  energy?: number;
};

export type ForestAssetsConfig = {
  catalogVersion?: string;
  modelKeys?: string[];
  hdriKey?: string;
};

export type SceneConfig = {
  seed?: string;
  schemaVersion?: string;
  // Absent on universe configs; "forest" on nature-service configs. The
  // renderer registry checks this BEFORE the theme, so a forest world can
  // never fall into a solar-system renderer.
  sceneType?: string;
  sceneName?: string;
  archetype?: string;
  quote?: string;
  theme?: string;
  palette?: string[] | ScenePalette;
  core?: SceneCoreConfig;
  planets?: PlanetSceneConfig[];
  particles?: SceneParticleConfig;
  camera?: SceneCameraConfig;
  postFX?: ScenePostFXConfig;
  hud?: SceneHUDConfig;
  sky?: SceneSkyConfig;
  belt?: SceneBeltConfig;
  comets?: SceneCometsConfig;
  sun?: SceneSunConfig;
  // Forest family sections (sceneType "forest").
  season?: ForestSeasonConfig;
  lighting?: ForestLightingConfig;
  terrain?: ForestTerrainConfig;
  trees?: ForestTreesConfig;
  weather?: ForestWeatherConfig;
  wildlife?: ForestWildlifeConfig;
  ambientParticles?: ForestAmbientParticlesConfig;
  landmarks?: ForestLandmarkConfig[];
  assets?: ForestAssetsConfig;
  [key: string]: unknown;
};

export type WorldVariant = {
  id: string;
  worldId?: string;
  name?: string;
  title?: string;
  seed?: string;
  sceneConfig?: SceneConfig;
  selected?: boolean;
  createdAt?: string;
};

export type World = {
  id: string;
  nickname?: string;
  title?: string;
  summary?: string;
  status?: string;
  shareSlug?: string;
  selectedVariantId?: string;
  variants: WorldVariant[];
  createdAt?: string;
  publishedAt?: string;
};

export type ShareWorld = {
  id: string;
  nickname?: string;
  title?: string;
  summary?: string;
  quote?: string;
  archetype?: string;
  shareSlug?: string;
  variant?: WorldVariant;
  publishedAt?: string;
};

export type PublishResult = {
  shareSlug: string;
  shareUrl: string;
};

export type CreateWorldInput = {
  nickname: string;
  role?: string;
  interests: string[];
  traits: string[];
  goal: string;
  challenge?: string;
  mood: string;
  favoriteColors: string[];
  preferredWorldStyle: string;
};
