import { describe, expect, it } from "vitest";
import {
  OCEAN_ZONE_ABYSS,
  OCEAN_ZONE_SUNLIT_SHALLOWS,
  OCEAN_ZONE_TWILIGHT_REACH,
  buildPreviewOceanSceneConfig,
  oceanZoneForDepth
} from "./oceanScene";
import { depthAt } from "./oceanDepthCurve";
import type { PreviewSceneInput } from "./scene";

/**
 * The create form's live preview is a SECOND implementation of the ocean
 * builder — the first is ocean-service, in Go. The seeded halves of the two are
 * deliberately only plausible, not identical (the PRNGs differ, exactly as they
 * do for the forest preview). What must not differ is anything the depth curve
 * decides, and oceanDepthCurve.test.ts pins that against the Go builder's own
 * golden fixtures.
 *
 * What this file checks is the other half: that the preview obeys the same
 * RULES the backend does, so a visitor is not shown a sea that could never be
 * generated.
 */

function previewInput(overrides: Partial<PreviewSceneInput> = {}): PreviewSceneInput {
  return {
    nickname: "Mai",
    interests: ["Diving", "Music", "Science"],
    traits: ["curious", "calm", "explorer"],
    mood: "reflective",
    preferredWorldStyle: "aurora",
    favoriteColors: ["#8B5CF6", "#06B6D4"],
    ...overrides
  };
}

const MOODS = ["focused", "dreamy", "energetic", "reflective"];

// Species that need sunlight to live. None may appear in the abyss.
const PHOTOSYNTHETIC_FLORA = new Set([
  "flora-kelp-giant",
  "flora-seagrass",
  "flora-coral-brain",
  "flora-coral-staghorn"
]);

function previewsAcrossMoodsAndNicknames(count: number) {
  const scenes = [];
  for (let index = 0; index < count; index += 1) {
    for (const mood of MOODS) {
      scenes.push(buildPreviewOceanSceneConfig(previewInput({ mood, nickname: `Mai-${index}` })));
    }
  }
  return scenes;
}

describe("the ocean preview builder", () => {
  it("returns an identical config for identical inputs", () => {
    expect(buildPreviewOceanSceneConfig(previewInput())).toEqual(buildPreviewOceanSceneConfig(previewInput()));
  });

  it("stamps the contract keys the renderer registry resolves on", () => {
    const scene = buildPreviewOceanSceneConfig(previewInput());
    expect(scene.sceneType).toBe("ocean");
    expect(scene.schemaVersion).toBe("1.0");
    expect(scene.assets?.catalogVersion).toBe("ocean-1");
    // This family has no sky, so it must never claim an environment map.
    expect(scene.assets?.hdriKey).toBeUndefined();
  });

  it("never labels a depth with a zone that depth is not in", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(30)) {
      const metres = scene.depth?.metres ?? -1;
      expect(scene.depth?.zone).toBe(oceanZoneForDepth(metres));
      expect(metres).toBeGreaterThan(0);
    }
  });

  it("derives the water from the depth curve and nothing else", () => {
    for (const scene of previewsAcrossMoodsAndNicknames(20)) {
      const expected = depthAt(scene.depth?.metres ?? 0);
      expect(scene.water).toEqual({
        fogColor: expected.fogColor,
        fogDensity: expected.fogDensity,
        visibilityMetres: expected.visibilityMetres,
        tintStrength: expected.tintStrength
      });
      expect(scene.lighting?.godRayStrength).toBe(expected.godRayStrength);
      expect(scene.lighting?.causticStrength).toBe(expected.causticStrength);
    }
  });

  it("grows nothing photosynthetic where no sunlight arrives", () => {
    let sawAbyss = false;
    for (const scene of previewsAcrossMoodsAndNicknames(40)) {
      if (scene.depth?.zone !== OCEAN_ZONE_ABYSS) {
        continue;
      }
      sawAbyss = true;
      for (const entry of scene.flora?.speciesMix ?? []) {
        expect(PHOTOSYNTHETIC_FLORA.has(entry.modelKey ?? "")).toBe(false);
      }
      // ...and no surface light effects, without the builder ever asking which
      // zone it is in.
      expect(scene.lighting?.godRayStrength).toBe(0);
      expect(scene.lighting?.causticStrength).toBe(0);
    }
    expect(sawAbyss).toBe(true);
  });

  it("puts the hero landmark first and never repeats a kind while others are unused", () => {
    const scene = buildPreviewOceanSceneConfig(previewInput());
    const landmarks = scene.landmarks ?? [];
    expect(landmarks.length).toBeGreaterThanOrEqual(3);
    expect(landmarks[0].kind).toBe("kelpCathedral");
    const kinds = landmarks.map((landmark) => landmark.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const landmark of landmarks) {
      expect(landmark.radiusFromCenter ?? 0).toBeGreaterThan(0);
      expect(landmark.radiusFromCenter ?? 0).toBeLessThanOrEqual(scene.seafloor?.basinRadius ?? 0);
    }
  });

  it("reaches every zone across the four moods rather than pinning one sea", () => {
    const zones = new Set(previewsAcrossMoodsAndNicknames(40).map((scene) => scene.depth?.zone));
    expect(zones.has(OCEAN_ZONE_SUNLIT_SHALLOWS)).toBe(true);
    expect(zones.has(OCEAN_ZONE_TWILIGHT_REACH)).toBe(true);
    expect(zones.has(OCEAN_ZONE_ABYSS)).toBe(true);
  });

  // The family is "ocean" at every machine-readable layer. "Abyss" is a zone
  // and a landmark kind, never an identifier — a reef config living under an
  // "abyss" name would be a mismatch nobody can rename once a link is public.
  it("names no seed stream after the abyss", () => {
    const scene = buildPreviewOceanSceneConfig(previewInput({ mood: "reflective" }));
    for (const streamSeed of [
      scene.seafloor?.placementSeed,
      scene.flora?.placementSeed,
      scene.bioluminescence?.flickerSeed
    ]) {
      expect(streamSeed).toContain("-ocean-");
      expect(streamSeed).not.toContain("abyss");
    }
  });

  it("gives a giant a distance anchored to the water rather than a fixed number", () => {
    let sawGiant = false;
    for (const scene of previewsAcrossMoodsAndNicknames(40)) {
      for (const giant of scene.fauna?.giants ?? []) {
        sawGiant = true;
        expect(giant.approachDistance ?? 0).toBeGreaterThanOrEqual((scene.water?.visibilityMetres ?? 0) * 0.8 - 0.01);
      }
    }
    expect(sawGiant).toBe(true);
  });
});
