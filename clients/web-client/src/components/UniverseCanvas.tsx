"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef, useState } from "react";
import { AgXToneMapping } from "three";
import type { Vector3 } from "three";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";
import { backgroundColorFromScene, isForestScene, pointsOfInterestFromScene, CANONICAL_FALLBACK_SEED } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { resolveSceneRenderer, resolveSceneTypeRenderer } from "@/features/scene-renderers/registry";
import { FallbackUniverseRenderer } from "@/features/scene-renderers/fallback/FallbackUniverseRenderer";
import { CameraRig } from "@/features/scene-renderers/shared/CameraRig";
import { CanvasLoader } from "@/features/scene-renderers/shared/CanvasLoader";
import { PostEffects } from "@/features/scene-renderers/shared/PostEffects";
import { PlanetPositionTrackerContext } from "@/features/scene-renderers/shared/PlanetPositionTracker";

export { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";

const DEFAULT_CAMERA_DISTANCE = 9;
const DEFAULT_CAMERA_FIELD_OF_VIEW = 50;
const CAMERA_HEIGHT_RATIO = 0.42;

// Forest camera envelope: wide zoom-out to take in the whole treeline, and a
// polar clamp so the camera never dives under the ground plane (universe
// scenes have no ground and keep the default free orbit).
const FOREST_MINIMUM_CAMERA_DISTANCE = 3;
const FOREST_MAXIMUM_CAMERA_DISTANCE = 70;
const FOREST_MAXIMUM_POLAR_ANGLE_RADIANS = Math.PI * 0.47;
// Render at native device resolution (the old 1.8 cap under-sampled every
// HiDPI display — a uniform blur). Quality-first scope: weak devices are
// explicitly out of scope for now.
const CANVAS_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 3];

/**
 * Mounts inside the scene's Suspense boundary, so its first rendered frame
 * means "textures resolved and pixels are on screen" — the moment the canvas
 * may fade in over the loading veil.
 */
function SceneReadySignal({ onSceneReady }: { onSceneReady: () => void }) {
  const hasSignaledReference = useRef(false);
  useFrame(() => {
    if (!hasSignaledReference.current) {
      hasSignaledReference.current = true;
      onSceneReady();
    }
  });
  return null;
}

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
  // Readiness is DERIVED from the remount key instead of reset in an effect:
  // the same render that swaps the canvas already sees isSceneReady=false,
  // so the veil covers the swap without a single black frame leaking through.
  const [lastReadyCanvasKey, setLastReadyCanvasKey] = useState<string | null>(null);

  const seed = String(scene?.seed ?? CANONICAL_FALLBACK_SEED);
  const backgroundColor = backgroundColorFromScene(scene);
  const cameraDistance = scene?.camera?.distance ?? DEFAULT_CAMERA_DISTANCE;
  const cameraFieldOfView = scene?.camera?.fov ?? DEFAULT_CAMERA_FIELD_OF_VIEW;
  // Planets for universe scenes, landmarks for forest scenes — one adapter so
  // hover/select/camera-focus work identically across families.
  const pointsOfInterest = pointsOfInterestFromScene(scene);
  const hasConfiguredPointsOfInterest = pointsOfInterest.length > 0;

  // Family first (sceneType), then universe theme, then the abstract fallback
  // for configs with no renderable content at all.
  const sceneTypeRenderer = resolveSceneTypeRenderer(scene);
  const SceneRenderer =
    sceneTypeRenderer ?? (hasConfiguredPointsOfInterest ? resolveSceneRenderer(scene?.theme) : FallbackUniverseRenderer);
  const isForestFamilyScene = isForestScene(scene);

  const hoveredPlanetKey = hoveredPlanet
    ? planetIdentityKey(
        hoveredPlanet,
        pointsOfInterest.findIndex((pointOfInterest) => pointOfInterest === hoveredPlanet)
      )
    : null;

  const canvasRemountKey = `${seed}-${cameraDistance}-${cameraFieldOfView}`;
  const isSceneReady = lastReadyCanvasKey === canvasRemountKey;

  return (
    <div
      className={`relative h-full min-h-[320px] overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor, cursor: hoveredPlanet ? "pointer" : "grab" }}
    >
      <div
        className={`h-full w-full transition-opacity duration-700 ease-out ${
          isSceneReady ? "opacity-100" : "opacity-0"
        }`}
      >
        <Canvas
          key={canvasRemountKey}
          camera={{
            position: [0, cameraDistance * CAMERA_HEIGHT_RATIO, cameraDistance],
            fov: cameraFieldOfView
          }}
          // Only the forest family casts real shadows (sun through the tree
          // canopy); universe scenes are emissive-lit and skip the shadow pass.
          shadows={isForestFamilyScene ? "soft" : false}
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
              <SceneReadySignal onSceneReady={() => setLastReadyCanvasKey(canvasRemountKey)} />
            </Suspense>
            <CameraRig
              selectedPlanetKey={selectedPlanetKey ?? null}
              minimumDistance={isForestFamilyScene ? FOREST_MINIMUM_CAMERA_DISTANCE : undefined}
              maximumDistance={isForestFamilyScene ? FOREST_MAXIMUM_CAMERA_DISTANCE : undefined}
              maximumPolarAngleRadians={isForestFamilyScene ? FOREST_MAXIMUM_POLAR_ANGLE_RADIANS : undefined}
            />
          </PlanetPositionTrackerContext.Provider>
        </Canvas>
      </div>
      {/* Loading veil: option toggles change the preview seed, which remounts
          the whole canvas — the veil turns that swap into an intentional
          crossfade (armillary-style counter-spinning brass rings) instead of
          a black flash. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-10 grid place-items-center transition-opacity duration-500 ${
          isSceneReady ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <span className="relative h-12 w-12">
            <span className="absolute inset-0 animate-spin rounded-full border border-white/10 border-t-brass" />
            <span className="absolute inset-2 animate-spin rounded-full border border-white/10 border-b-brass [animation-direction:reverse] [animation-duration:1.6s]" />
          </span>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">
            {isForestFamilyScene ? "Rendering forest" : "Rendering universe"}
          </p>
        </div>
      </div>
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
