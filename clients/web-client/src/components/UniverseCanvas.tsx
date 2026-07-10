"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useRef, useState } from "react";
import { AgXToneMapping } from "three";
import type { Vector3 } from "three";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";
import { backgroundColorFromScene, planetsFromScene, CANONICAL_FALLBACK_SEED } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { resolveSceneRenderer } from "@/features/scene-renderers/registry";
import { FallbackUniverseRenderer } from "@/features/scene-renderers/fallback/FallbackUniverseRenderer";
import { CameraRig } from "@/features/scene-renderers/shared/CameraRig";
import { CanvasLoader } from "@/features/scene-renderers/shared/CanvasLoader";
import { PostEffects } from "@/features/scene-renderers/shared/PostEffects";
import { PlanetPositionTrackerContext } from "@/features/scene-renderers/shared/PlanetPositionTracker";

export { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";

const DEFAULT_CAMERA_DISTANCE = 9;
const DEFAULT_CAMERA_FIELD_OF_VIEW = 50;
const CAMERA_HEIGHT_RATIO = 0.42;
// Render at native device resolution (the old 1.8 cap under-sampled every
// HiDPI display — a uniform blur). Quality-first scope: weak devices are
// explicitly out of scope for now.
const CANVAS_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 3];

type UniverseCanvasProps = {
  scene?: SceneConfig;
  className?: string;
  selectedPlanetKey?: string | null;
  onSelectPlanet?: (planet: PlanetSceneConfig | null) => void;
  /**
   * Keep the GL backbuffer readable after each frame. Costs a driver fast-path
   * and extra memory, so it defaults to off; only the world page opts in
   * because its Export Image reads the canvas pixels.
   */
  preserveDrawingBuffer?: boolean;
  /** Device-pixel-ratio clamp; ambient backdrops pass a lower cap. */
  devicePixelRatioRange?: [number, number];
};

/**
 * Thin canvas shell shared by every scene renderer. Resolves the renderer from
 * the scene theme via the registry, hosts camera, post-processing and the
 * hover overlay. Scene-specific visuals live in features/scene-renderers/.
 */
export function UniverseCanvas({
  scene,
  className,
  selectedPlanetKey,
  onSelectPlanet,
  preserveDrawingBuffer = false,
  devicePixelRatioRange = CANVAS_DEVICE_PIXEL_RATIO_RANGE
}: UniverseCanvasProps) {
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetSceneConfig | null>(null);
  const planetPositionTrackerReference = useRef<Map<string, Vector3>>(new Map());

  const seed = String(scene?.seed ?? CANONICAL_FALLBACK_SEED);
  const backgroundColor = backgroundColorFromScene(scene);
  const cameraDistance = scene?.camera?.distance ?? DEFAULT_CAMERA_DISTANCE;
  const cameraFieldOfView = scene?.camera?.fov ?? DEFAULT_CAMERA_FIELD_OF_VIEW;
  const planets = planetsFromScene(scene);
  const hasConfiguredPlanets = planets.length > 0;

  const SceneRenderer = hasConfiguredPlanets ? resolveSceneRenderer(scene?.theme) : FallbackUniverseRenderer;

  const hoveredPlanetKey = hoveredPlanet
    ? planetIdentityKey(
        hoveredPlanet,
        planets.findIndex((planet) => planet === hoveredPlanet)
      )
    : null;

  return (
    <div
      className={`relative h-full min-h-[320px] overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor, cursor: hoveredPlanet ? "pointer" : "grab" }}
    >
      <Canvas
        key={`${seed}-${cameraDistance}-${cameraFieldOfView}`}
        camera={{
          position: [0, cameraDistance * CAMERA_HEIGHT_RATIO, cameraDistance],
          fov: cameraFieldOfView
        }}
        dpr={devicePixelRatioRange}
        // AgX rolls hot highlights off more gracefully than the default ACES
        // (no neon clipping on lit planets); sky layers opt out via
        // toneMapped={false} and are unaffected.
        gl={{ preserveDrawingBuffer, powerPreference: "high-performance", toneMapping: AgXToneMapping }}
        onPointerMissed={() => onSelectPlanet?.(null)}
      >
        <color attach="background" args={[backgroundColor]} />
        <PlanetPositionTrackerContext.Provider value={planetPositionTrackerReference.current}>
          <Suspense fallback={<CanvasLoader />}>
            <SceneRenderer
              scene={scene ?? {}}
              seed={seed}
              selectedPlanetKey={selectedPlanetKey ?? null}
              hoveredPlanetKey={hoveredPlanetKey}
              onHoverPlanet={setHoveredPlanet}
              onSelectPlanet={onSelectPlanet}
            />
            <PostEffects postFX={scene?.postFX} theme={scene?.theme} />
          </Suspense>
          <CameraRig selectedPlanetKey={selectedPlanetKey ?? null} />
        </PlanetPositionTrackerContext.Provider>
      </Canvas>
      {hoveredPlanet ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-xs rounded-lg border border-white/15 bg-surface-low/85 px-3 py-2 backdrop-blur">
          <p className="text-sm font-semibold text-on-surface">{hoveredPlanet.name ?? "Unknown planet"}</p>
          {typeof hoveredPlanet.energy === "number" ? (
            <p className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">
              Energy {hoveredPlanet.energy}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-lowest/65 to-transparent" />
    </div>
  );
}
