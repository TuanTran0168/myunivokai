import { randomFromSeed } from "@/lib/scene";

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

export type RareFeatureKey = "meteor-shower" | "binary-sun";

export type RareFeatureDefinition = {
  key: RareFeatureKey;
  /** Shown in the HUD badge; app UI language is English. */
  displayName: string;
  probability: number;
};

export const RARE_FEATURE_PROBABILITIES: RareFeatureDefinition[] = [
  { key: "meteor-shower", displayName: "Meteor Shower", probability: 0.05 },
  { key: "binary-sun", displayName: "Binary Suns", probability: 0.03 }
];

export type RareFeature = {
  key: RareFeatureKey;
  displayName: string;
};

export function resolveRareFeatures(seed: string): RareFeature[] {
  return RARE_FEATURE_PROBABILITIES.filter((definition) => {
    const random = randomFromSeed(`${seed}-rare-feature-${definition.key}`);
    return random() < definition.probability;
  }).map((definition) => ({ key: definition.key, displayName: definition.displayName }));
}

export function hasRareFeature(rareFeatures: RareFeature[], key: RareFeatureKey): boolean {
  return rareFeatures.some((feature) => feature.key === key);
}
