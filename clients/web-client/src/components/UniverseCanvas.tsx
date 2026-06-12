"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useRef, useState } from "react";
import type { Vector3 } from "three";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";
import { backgroundColorFromScene, planetsFromScene } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { resolveSceneRenderer } from "@/features/scene-renderers/registry";
import { FallbackUniverseRenderer } from "@/features/scene-renderers/fallback/FallbackUniverseRenderer";
import { CameraRig } from "@/features/scene-renderers/shared/CameraRig";
import { PostEffects } from "@/features/scene-renderers/shared/PostEffects";
import { PlanetPositionTrackerContext } from "@/features/scene-renderers/shared/PlanetPositionTracker";

export { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";

const DEFAULT_CAMERA_DISTANCE = 9;
const DEFAULT_CAMERA_FIELD_OF_VIEW = 50;
const CAMERA_HEIGHT_RATIO = 0.42;
const CANVAS_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 1.8];
const FALLBACK_SEED = "myunivokai";

type UniverseCanvasProps = {
  scene?: SceneConfig;
  className?: string;
  selectedPlanetKey?: string | null;
  onSelectPlanet?: (planet: PlanetSceneConfig | null) => void;
};

/**
 * Thin canvas shell shared by every scene renderer. Resolves the renderer from
 * the scene theme via the registry, hosts camera, post-processing and the
 * hover overlay. Scene-specific visuals live in features/scene-renderers/.
 */
export function UniverseCanvas({ scene, className, selectedPlanetKey, onSelectPlanet }: UniverseCanvasProps) {
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetSceneConfig | null>(null);
  const planetPositionTrackerReference = useRef<Map<string, Vector3>>(new Map());

  const seed = String(scene?.seed ?? FALLBACK_SEED);
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
        dpr={CANVAS_DEVICE_PIXEL_RATIO_RANGE}
        gl={{ preserveDrawingBuffer: true }}
        onPointerMissed={() => onSelectPlanet?.(null)}
      >
        <color attach="background" args={[backgroundColor]} />
        <PlanetPositionTrackerContext.Provider value={planetPositionTrackerReference.current}>
          <Suspense fallback={null}>
            <SceneRenderer
              scene={scene ?? {}}
              seed={seed}
              selectedPlanetKey={selectedPlanetKey ?? null}
              hoveredPlanetKey={hoveredPlanetKey}
              onHoverPlanet={setHoveredPlanet}
              onSelectPlanet={onSelectPlanet}
            />
            <PostEffects postFX={scene?.postFX} />
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
