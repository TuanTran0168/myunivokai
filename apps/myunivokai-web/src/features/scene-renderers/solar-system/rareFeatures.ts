import { CANONICAL_FALLBACK_SEED, planetsFromScene, randomFromSeed } from "@/lib/scene";
import type { SceneConfig } from "@/lib/types";

/**
 * Seeded rare celestial events — the world lottery. Each feature rolls on its
 * OWN PRNG stream (`<seed>-rare-feature-<key>`), so adding, removing or
 * re-tuning one feature can never shift another feature's roll, and none of
 * the existing scene streams move.
 *
 * The HUD label is part of the contract: a rare roll nobody notices is a
 * wasted lottery. Both the world page and the share page surface displayName
 * via RareFeatureBadge whenever a feature is present.
 */

export type RareFeatureKey = "meteor-shower" | "binary-sun" | "black-hole";

export type RareFeatureDefinition = {
  key: RareFeatureKey;
  /** Shown in the HUD badge; app UI language is English. */
  displayName: string;
  probability: number;
};

export const RARE_FEATURE_PROBABILITIES: RareFeatureDefinition[] = [
  { key: "meteor-shower", displayName: "Meteor Shower", probability: 0.05 },
  { key: "binary-sun", displayName: "Binary Suns", probability: 0.03 },
  // Deliberately the loudest of the three: it is the most spectacular feature
  // and the owner wants it findable while tuning the scene, not a true rarity.
  { key: "black-hole", displayName: "Black Hole", probability: 0.4 }
];

export function resolveRareFeatures(seed: string): RareFeatureDefinition[] {
  return RARE_FEATURE_PROBABILITIES.filter((definition) => {
    const random = randomFromSeed(`${seed}-rare-feature-${definition.key}`);
    return random() < definition.probability;
  });
}

/**
 * Scene-level resolution for HUD consumers (RareFeatureBadge): derives the
 * seed EXACTLY the way UniverseCanvas does, and returns nothing for worlds
 * without planets (those render the fallback renderer, which draws no rare
 * features). Today every planet-bearing theme resolves to
 * SolarSystemRenderer; when a second scene family joins the registry, this
 * helper is the single place to gate rare features by renderer.
 */
export function resolveRareFeaturesForScene(scene?: SceneConfig): RareFeatureDefinition[] {
  if (!scene || planetsFromScene(scene).length === 0) {
    return [];
  }
  return resolveRareFeatures(String(scene.seed ?? CANONICAL_FALLBACK_SEED));
}

export function hasRareFeature(rareFeatures: RareFeatureDefinition[], key: RareFeatureKey): boolean {
  return rareFeatures.some((feature) => feature.key === key);
}
