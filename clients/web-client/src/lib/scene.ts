import type { PlanetSceneConfig, SceneConfig, ScenePalette, World, WorldVariant } from "./types";

const FALLBACK_PALETTE = ["#8B5CF6", "#06B6D4", "#FACC15", "#44624a", "#101418"];
const FALLBACK_BACKGROUND_COLOR = "#050816";
const FALLBACK_SEED = "myunivokai-local-seed";
const MAXIMUM_PALETTE_COLORS = 6;

export function selectedVariant(world: World): WorldVariant | undefined {
  return (
    world.variants.find((variant) => variant.id === world.selectedVariantId) ??
    world.variants.find((variant) => variant.selected) ??
    world.variants[0]
  );
}

export function sceneFromVariant(variant?: WorldVariant): SceneConfig {
  return {
    seed: variant?.seed ?? variant?.id ?? FALLBACK_SEED,
    ...(variant?.sceneConfig ?? {})
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
