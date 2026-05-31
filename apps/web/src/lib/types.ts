export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
    requestId?: string;
  };
};

export type SceneConfig = {
  seed?: string;
  palette?: string[] | Record<string, unknown>;
  mood?: string;
  terrain?: string;
  sky?: string;
  objects?: Array<{
    type?: string;
    color?: string;
    position?: [number, number, number];
    scale?: number;
  }>;
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
