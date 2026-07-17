"use client";

import { useMemo } from "react";
import type { SceneRendererProps } from "@/features/scene-renderers/types";
import { pointsOfInterestFromScene } from "@/lib/scene";
import { createPathLateralDistanceSampler, createTerrainHeightSampler, treelineRadiusFromTerrain } from "./forestMath";
import { ForestAmbientParticles } from "./ForestAmbientParticles";
import { ForestGroundDecor } from "./ForestGroundDecor";
import { ForestLandmarks } from "./ForestLandmarks";
import { ForestSkyDome, sunDirectionFromLighting } from "./ForestSkyDome";
import { ForestTerrain } from "./ForestTerrain";
import { ForestTrees } from "./ForestTrees";
import { ForestWeatherEffects } from "./ForestWeatherEffects";
import { ForestWildlife } from "./ForestWildlife";

// The forest scene family renderer (sceneType "forest", nature-service).
// Everything visual reads from the ForestSceneConfig sections; every scatter
// decision comes from the placement seeds embedded in the config, so the
// same seed renders the same forest forever.

const SUN_LIGHT_DISTANCE = 60;
const SUN_LIGHT_BASE_INTENSITY = 1.35;
// Overcast/rain/snow flatten the light; sun rays crank it slightly.
const SUN_INTENSITY_MULTIPLIERS_BY_WEATHER_KIND: Record<string, number> = {
  clear: 1.0,
  sunRays: 1.1,
  overcast: 0.45,
  rain: 0.4,
  snow: 0.55
};
const HEMISPHERE_LIGHT_INTENSITY = 0.55;
const AMBIENT_LIGHT_INTENSITY = 0.25;
const HEMISPHERE_GROUND_COLOR = "#3D3327";

const SHADOW_MAP_SIZE = 2048;
const SHADOW_CAMERA_MARGIN = 8;
const SHADOW_BIAS = -0.0004;

// A whisper of height fog even when the config draws none — pure zero makes
// the treeline cut a hard edge against the sky dome. Renderer aesthetic, not
// contract: the config's density always wins when present.
const MINIMUM_RENDER_FOG_DENSITY = 0.004;

/**
 * Renders a ForestSceneConfig: seeded terrain with a clearing and dirt path,
 * wind-swayed instanced trees, seasonal weather and ambience, wandering
 * wildlife, and one clickable landmark per Nature DNA landmark.
 */
export function ForestRenderer({ scene, selectedPlanetKey, hoveredPlanetKey, onHoverPlanet, onSelectPlanet }: SceneRendererProps) {
  const season = scene.season;
  const lighting = scene.lighting;
  const terrain = scene.terrain;
  const trees = scene.trees;
  const weather = scene.weather;
  const wildlife = scene.wildlife;
  const ambientParticles = scene.ambientParticles;

  const terrainHeightSampler = useMemo(() => createTerrainHeightSampler(terrain), [terrain]);
  const pathLateralDistanceSampler = useMemo(() => createPathLateralDistanceSampler(terrain), [terrain]);
  const pointsOfInterest = useMemo(() => pointsOfInterestFromScene(scene), [scene]);

  const sunPosition = useMemo(
    () => sunDirectionFromLighting(lighting).multiplyScalar(SUN_LIGHT_DISTANCE),
    [lighting]
  );
  const weatherKind = weather?.kind ?? "clear";
  const sunIntensity =
    SUN_LIGHT_BASE_INTENSITY * (lighting?.exposure ?? 1) * (SUN_INTENSITY_MULTIPLIERS_BY_WEATHER_KIND[weatherKind] ?? 1);
  const fogDensity = Math.max(lighting?.fogDensity ?? 0, MINIMUM_RENDER_FOG_DENSITY);
  const fogColor = lighting?.fogColor ?? "#C4D2BE";
  const shadowCameraExtent = treelineRadiusFromTerrain(terrain) + SHADOW_CAMERA_MARGIN;
  const placementSeed = terrain?.placementSeed ?? String(scene.seed ?? "forest");

  return (
    <group>
      <fogExp2 attach="fog" args={[fogColor, fogDensity]} />

      <hemisphereLight
        args={[lighting?.ambientColor ?? "#9DB4C8", HEMISPHERE_GROUND_COLOR, HEMISPHERE_LIGHT_INTENSITY]}
      />
      <ambientLight color={lighting?.ambientColor ?? "#9DB4C8"} intensity={AMBIENT_LIGHT_INTENSITY} />
      <directionalLight
        position={sunPosition}
        color={lighting?.sunColor ?? "#FFF6E5"}
        intensity={sunIntensity}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-left={-shadowCameraExtent}
        shadow-camera-right={shadowCameraExtent}
        shadow-camera-top={shadowCameraExtent}
        shadow-camera-bottom={-shadowCameraExtent}
        shadow-camera-near={1}
        shadow-camera-far={SUN_LIGHT_DISTANCE * 2.5}
        shadow-bias={SHADOW_BIAS}
      />

      <ForestSkyDome lighting={lighting} weather={weather} />
      <ForestTerrain
        terrain={terrain}
        season={season}
        terrainHeightSampler={terrainHeightSampler}
        pathLateralDistanceSampler={pathLateralDistanceSampler}
      />
      <ForestTrees
        trees={trees}
        terrain={terrain}
        season={season}
        terrainHeightSampler={terrainHeightSampler}
        pathLateralDistanceSampler={pathLateralDistanceSampler}
      />
      <ForestGroundDecor
        terrain={terrain}
        season={season}
        terrainHeightSampler={terrainHeightSampler}
        pathLateralDistanceSampler={pathLateralDistanceSampler}
      />
      <ForestWeatherEffects weather={weather} lighting={lighting} terrain={terrain} placementSeed={placementSeed} />
      <ForestAmbientParticles
        ambientParticles={ambientParticles}
        season={season}
        terrain={terrain}
        placementSeed={placementSeed}
      />
      <ForestWildlife wildlife={wildlife} terrain={terrain} terrainHeightSampler={terrainHeightSampler} />
      <ForestLandmarks
        landmarks={scene.landmarks}
        pointsOfInterest={pointsOfInterest}
        terrainHeightSampler={terrainHeightSampler}
        selectedPlanetKey={selectedPlanetKey}
        hoveredPlanetKey={hoveredPlanetKey}
        onHoverPlanet={onHoverPlanet}
        onSelectPlanet={onSelectPlanet}
      />
    </group>
  );
}
