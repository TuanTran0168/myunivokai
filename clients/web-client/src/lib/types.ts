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
  title?: string;
  summary?: string;
  quote?: string;
  archetype?: string;
  shareSlug?: string;
  variant?: WorldVariant;
  sceneConfig?: SceneConfig;
  publishedAt?: string;
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
