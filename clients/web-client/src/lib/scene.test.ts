import { describe, it, expect } from "vitest";
import {
  CANONICAL_FALLBACK_SEED,
  buildPreviewSceneConfig,
  planetsFromScene,
  randomFromSeed,
  resolveVariantSeed,
  sceneFromVariant,
  type PreviewSceneInput
} from "./scene";
import type { WorldVariant } from "./types";

const THREE_PLANET_SCENE_CONFIG = {
  theme: "cosmic-galaxy",
  planets: [{ key: "a" }, { key: "b" }, { key: "c" }]
};

describe("resolveVariantSeed / sceneFromVariant", () => {
  it("uses the variant seed when present", () => {
    const variant: WorldVariant = { id: "variant-1", seed: "seed-1", sceneConfig: THREE_PLANET_SCENE_CONFIG };
    expect(resolveVariantSeed(variant)).toBe("seed-1");
    expect(sceneFromVariant(variant).seed).toBe("seed-1");
  });

  it("falls back to the seed embedded in the scene config", () => {
    const variant: WorldVariant = {
      id: "variant-1",
      sceneConfig: { ...THREE_PLANET_SCENE_CONFIG, seed: "config-seed" }
    };
    expect(resolveVariantSeed(variant)).toBe("config-seed");
  });

  it("falls back to the variant id, then the canonical seed", () => {
    expect(resolveVariantSeed({ id: "variant-1" })).toBe("variant-1");
    expect(resolveVariantSeed(undefined)).toBe(CANONICAL_FALLBACK_SEED);
    expect(sceneFromVariant(undefined).seed).toBe(CANONICAL_FALLBACK_SEED);
  });

  it("never lets a stale seed inside sceneConfig override the resolved seed", () => {
    const variant: WorldVariant = {
      id: "variant-1",
      seed: "authoritative-seed",
      sceneConfig: { ...THREE_PLANET_SCENE_CONFIG, seed: "stale-seed" }
    };
    expect(sceneFromVariant(variant).seed).toBe("authoritative-seed");
  });

  it("preserves the planets from the scene config (the variants-bug regression)", () => {
    const variant: WorldVariant = { id: "variant-1", seed: "seed-1", sceneConfig: THREE_PLANET_SCENE_CONFIG };
    expect(planetsFromScene(sceneFromVariant(variant))).toHaveLength(3);
  });
});

describe("scene rendering consistency across pages", () => {
  it("resolves the same seed whether it lives at the variant or inside the config", () => {
    const seedValue = "shared-seed";
    const variantFromWorldEndpoint: WorldVariant = {
      id: "variant-1",
      seed: seedValue,
      sceneConfig: THREE_PLANET_SCENE_CONFIG
    };
    const variantFromShareEndpoint: WorldVariant = {
      id: "variant-1",
      sceneConfig: { ...THREE_PLANET_SCENE_CONFIG, seed: seedValue }
    };
    expect(sceneFromVariant(variantFromWorldEndpoint).seed).toBe(
      sceneFromVariant(variantFromShareEndpoint).seed
    );
  });

  it("produces an identical scene for the same variant (one builder, every page)", () => {
    const variant: WorldVariant = { id: "variant-1", seed: "seed-1", sceneConfig: THREE_PLANET_SCENE_CONFIG };
    expect(sceneFromVariant(variant)).toEqual(sceneFromVariant(variant));
  });
});

describe("buildPreviewSceneConfig", () => {
  const baseInput: PreviewSceneInput = {
    nickname: "Neo",
    interests: ["Technology", "Design", "AI"],
    traits: ["curious", "builder", "focused"],
    mood: "focused",
    preferredWorldStyle: "cosmic-galaxy",
    favoriteColors: ["#8B5CF6", "#06B6D4"]
  };

  it("is deterministic for identical inputs", () => {
    expect(buildPreviewSceneConfig(baseInput)).toEqual(buildPreviewSceneConfig(baseInput));
  });

  it("renders a real solar system (non-empty planets), not the abstract fallback", () => {
    const scene = buildPreviewSceneConfig(baseInput);
    expect(planetsFromScene(scene).length).toBeGreaterThan(0);
    expect(scene.theme).toBe("cosmic-galaxy");
  });

  it("clamps planet count between 3 and 7", () => {
    const fewInterests = buildPreviewSceneConfig({ ...baseInput, interests: ["Solo"] });
    const manyInterests = buildPreviewSceneConfig({
      ...baseInput,
      interests: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
    });
    expect(planetsFromScene(fewInterests)).toHaveLength(3);
    expect(planetsFromScene(manyInterests)).toHaveLength(7);
  });

  it("derives the palette from the chosen colors with a fixed background", () => {
    const scene = buildPreviewSceneConfig({ ...baseInput, favoriteColors: ["#111111", "#222222"] });
    expect(scene.palette).toEqual({
      background: "#050816",
      primary: "#111111",
      secondary: "#222222",
      accent: "#FACC15",
      gradient: ["#111111", "#222222", "#FACC15"]
    });
  });

  it("names planets from the chosen interests", () => {
    const scene = buildPreviewSceneConfig(baseInput);
    const planetNames = planetsFromScene(scene).map((planet) => planet.name);
    expect(planetNames.slice(0, 3)).toEqual(["Technology", "Design", "AI"]);
  });

  it("reacts to a changed input (mood is part of the seed)", () => {
    const focused = buildPreviewSceneConfig({ ...baseInput, mood: "focused" });
    const dreamy = buildPreviewSceneConfig({ ...baseInput, mood: "dreamy" });
    expect(focused.seed).not.toBe(dreamy.seed);
  });
});

describe("randomFromSeed", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    const firstSequence = [0, 1, 2].map(randomFromSeed("seed-a"));
    const sameSequence = [0, 1, 2].map(randomFromSeed("seed-a"));
    const otherSequence = [0, 1, 2].map(randomFromSeed("seed-b"));
    expect(firstSequence).toEqual(sameSequence);
    expect(firstSequence).not.toEqual(otherSequence);
  });
});
