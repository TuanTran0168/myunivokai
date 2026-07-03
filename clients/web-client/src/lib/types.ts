export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
    requestId?: string;
  };
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

export type ScenePostFXConfig = {
  bloomIntensity?: number;
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

export type SceneConfig = {
  seed?: string;
  schemaVersion?: string;
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
