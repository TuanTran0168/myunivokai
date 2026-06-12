import type { SceneRendererComponent } from "./types";
import { SolarSystemRenderer } from "./solar-system/SolarSystemRenderer";

/**
 * Maps WorldSceneConfig.theme to a scene renderer.
 *
 * Today every universe theme renders as a solar system. The registry exists so
 * future scene families (sky, city, countryside, ...) can plug in without
 * touching existing renderers: add a folder under scene-renderers/, implement
 * SceneRendererProps, and register the theme here. The backend contract does
 * not change.
 */
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
