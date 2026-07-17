import type { SceneConfig } from "@/lib/types";
import type { SceneRendererComponent } from "./types";
import { SolarSystemRenderer } from "./solar-system/SolarSystemRenderer";
import { ForestRenderer } from "./forest/ForestRenderer";

/**
 * Two-level renderer resolution:
 *
 * 1. `sceneType` picks the scene family — it is the contract key each backend
 *    service stamps into its configs ("forest" from nature-service; universe
 *    configs predate the field and simply omit it). A family match wins
 *    outright, so a forest world can never fall into a solar-system renderer
 *    no matter what its theme says.
 * 2. Within the universe family, `theme` picks the renderer exactly as before.
 *
 * Adding a scene family = new folder under scene-renderers/ implementing
 * SceneRendererProps + one entry in SCENE_TYPE_RENDERER_REGISTRY. The backend
 * contract does not change.
 */
const SCENE_TYPE_RENDERER_REGISTRY: Record<string, SceneRendererComponent> = {
  forest: ForestRenderer
};

const SCENE_RENDERER_REGISTRY: Record<string, SceneRendererComponent> = {
  "cosmic-galaxy": SolarSystemRenderer,
  nebula: SolarSystemRenderer,
  crystal: SolarSystemRenderer,
  aurora: SolarSystemRenderer,
  "cyber-orbit": SolarSystemRenderer
};

export const DEFAULT_SCENE_RENDERER: SceneRendererComponent = SolarSystemRenderer;

export function resolveSceneRenderer(theme?: string): SceneRendererComponent {
  if (theme && SCENE_RENDERER_REGISTRY[theme]) {
    return SCENE_RENDERER_REGISTRY[theme];
  }
  return DEFAULT_SCENE_RENDERER;
}

/**
 * Family-first resolution. Returns the family renderer when the scene carries
 * a registered sceneType, otherwise null so the caller can apply its
 * universe-era fallback rules (theme lookup / abstract fallback renderer).
 */
export function resolveSceneTypeRenderer(scene?: SceneConfig): SceneRendererComponent | null {
  if (scene?.sceneType && SCENE_TYPE_RENDERER_REGISTRY[scene.sceneType]) {
    return SCENE_TYPE_RENDERER_REGISTRY[scene.sceneType];
  }
  return null;
}
