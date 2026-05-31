import type { SceneConfig, World, WorldVariant } from "./types";

const fallbackPalette = ["#40798c", "#d8614c", "#d6a23f", "#44624a", "#101418"];

export function selectedVariant(world: World): WorldVariant | undefined {
  return (
    world.variants.find((variant) => variant.id === world.selectedVariantId) ??
    world.variants.find((variant) => variant.selected) ??
    world.variants[0]
  );
}

export function sceneFromVariant(variant?: WorldVariant): SceneConfig {
  return {
    seed: variant?.seed ?? variant?.id ?? "myunivokai-local-seed",
    palette: fallbackPalette,
    ...(variant?.sceneConfig ?? {})
  };
}

export function paletteFromScene(scene?: SceneConfig): string[] {
  const palette = scene?.palette;
  if (Array.isArray(palette) && palette.every((item) => typeof item === "string")) {
    return palette.slice(0, 6);
  }
  if (palette && typeof palette === "object" && !Array.isArray(palette)) {
    const objectPalette = palette;
    const colors = [
      objectPalette.background,
      objectPalette.primary,
      objectPalette.secondary,
      objectPalette.accent,
      ...(Array.isArray(objectPalette.gradient) ? objectPalette.gradient : [])
    ].filter((item): item is string => typeof item === "string");
    if (colors.length > 0) {
      return colors.slice(0, 6);
    }
  }
  return fallbackPalette;
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
