import { Sparkles } from "lucide-react";
import type { SceneConfig } from "@/lib/types";
import { CANONICAL_FALLBACK_SEED, planetsFromScene } from "@/lib/scene";
import { resolveRareFeatures } from "@/features/scene-renderers/solar-system/rareFeatures";

/**
 * Names the rare celestial event(s) this world rolled (meteor shower, binary
 * suns, ...). Rare features are a pure seed lottery — without a label nobody
 * would know they hit one — so the world page and the share page both show
 * this badge. The seed derivation mirrors UniverseCanvas exactly, so the
 * badge always matches what the renderer actually draws. Renders nothing for
 * worlds without planets (fallback renderer) or without a winning roll.
 */

type RareFeatureBadgeProps = {
  scene?: SceneConfig;
};

export function RareFeatureBadge({ scene }: RareFeatureBadgeProps) {
  if (!scene || planetsFromScene(scene).length === 0) {
    return null;
  }
  const worldSeed = String(scene.seed ?? CANONICAL_FALLBACK_SEED);
  const rareFeatures = resolveRareFeatures(worldSeed);
  if (rareFeatures.length === 0) {
    return null;
  }
  return (
    <p className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-brass">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Rare event: {rareFeatures.map((feature) => feature.displayName).join(" · ")}</span>
    </p>
  );
}
