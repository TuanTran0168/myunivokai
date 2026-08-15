"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { BackSide } from "three";
import type { SceneRendererProps } from "@/features/scene-renderers/types";
import { pointsOfInterestFromScene } from "@/lib/scene";
import { OceanFauna } from "./OceanFauna";
import { OceanFlora } from "./OceanFlora";
import { OceanLandmarks } from "./OceanLandmarks";
import { OceanLightShafts } from "./OceanLightShafts";
import { OceanParticles } from "./OceanParticles";
import { OceanSeafloor } from "./OceanSeafloor";
import { basinRadiusFromSeafloor, createSeafloorHeightSampler } from "./oceanMath";

// The ocean scene family renderer (sceneType "ocean", ocean-service).
//
// Everything visual reads from the OceanSceneConfig sections, and every scatter
// decision comes from the placement seeds embedded in the config, so the same
// seed renders the same sea forever.
//
// The thing worth knowing before reading further: NOTHING IN THIS RENDERER ASKS
// WHICH DEPTH ZONE IT IS IN. A reef and an abyssal trench are the same code
// path with different numbers, because the backend's depth curve already turned
// depth into fog, light, god rays and caustics — and drove the last two to
// exactly zero below the sunlight floor. That is the whole design.

const MOBILE_VIEWPORT_WIDTH_PIXELS = 820;

// The key light stands in for daylight refracting through the surface. Its
// COLOUR comes from the depth curve; only the intensity is a renderer choice.
const KEY_LIGHT_DISTANCE = 55;
const KEY_LIGHT_BASE_INTENSITY = 2.2;
const AMBIENT_LIGHT_INTENSITY = 0.75;
// Underwater, the brightest thing is above you and the darkest is the floor.
// A hemisphere light is the cheapest way to say that, and it is what stops the
// seabed reading as a lit studio floor.
const HEMISPHERE_LIGHT_INTENSITY = 0.55;
const HEMISPHERE_GROUND_COLOR = "#050B12";

const SHADOW_MAP_SIZE = 2048;
const SHADOW_CAMERA_MARGIN = 10;
const SHADOW_BIAS = -0.0005;
const SHADOW_NORMAL_BIAS = 0.02;

// The water body itself: an inward-facing sphere that closes the world off.
// There is no sky dome here and no HDRI — a thousand metres down there is
// nothing above but more water, and the fog reaches its limit long before this
// does. It exists so the scene has a colour where geometry runs out, rather
// than the canvas clear colour showing through as a hard edge.
const WATER_VOLUME_RADIUS_MULTIPLIER = 2.4;

/**
 * Renders an OceanSceneConfig: a seeded seafloor basin, instanced flora swayed
 * by the current, schools that move as bodies, drifting bioluminescent life, a
 * giant that passes at fog distance, and one clickable landmark per Ocean DNA
 * landmark.
 */
export function OceanRenderer({
  scene,
  seed,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: SceneRendererProps) {
  // scene.depth is deliberately not read here. Every visual consequence of it
  // is already baked into water and lighting by the backend's depth curve, and
  // reading the metres again in the renderer is how the two would drift apart.
  const water = scene.water;
  const lighting = scene.lighting;
  const seafloor = scene.seafloor;
  const current = scene.current;

  const viewportWidth = useThree((state) => state.size.width);
  const isMobile = viewportWidth > 0 && viewportWidth < MOBILE_VIEWPORT_WIDTH_PIXELS;

  const heightSampler = useMemo(() => createSeafloorHeightSampler(seafloor), [seafloor]);
  const basinRadius = basinRadiusFromSeafloor(seafloor);
  const pointsOfInterest = useMemo(() => pointsOfInterestFromScene(scene), [scene]);

  const fogColor = water?.fogColor ?? "#0A3B4E";
  const fogDensity = water?.fogDensity ?? 0.04;
  const surfaceLightColor = lighting?.surfaceLightColor ?? "#8FD8E8";
  const ambientColor = lighting?.ambientColor ?? "#0A404A";
  const exposure = lighting?.exposure ?? 1;
  const elevationRadians = lighting?.surfaceElevationRadians ?? 0.9;

  // The key light comes from the direction the surface light enters at. Above
  // the sunlight floor that is a real sun; below it, the depth curve has
  // already reduced its colour to the dim blue legibility floor, so the same
  // rig produces a lit reef and an all-but-unlit trench with no branch.
  const keyLightPosition = useMemo<[number, number, number]>(() => {
    const horizontal = Math.cos(elevationRadians) * KEY_LIGHT_DISTANCE;
    return [horizontal * 0.6, Math.sin(elevationRadians) * KEY_LIGHT_DISTANCE, horizontal * 0.8];
  }, [elevationRadians]);

  const shadowCameraExtent = basinRadius + SHADOW_CAMERA_MARGIN;
  const worldSeed = seed || String(scene.seed ?? "ocean");

  return (
    <group>
      <fogExp2 attach="fog" args={[fogColor, fogDensity]} />

      <hemisphereLight args={[surfaceLightColor, HEMISPHERE_GROUND_COLOR, HEMISPHERE_LIGHT_INTENSITY * exposure]} />
      {/* Ambient runs high for an outdoor scene on purpose: light underwater
          arrives from every direction at once after a few metres of scattering,
          which is exactly what an ambient term models. */}
      <ambientLight color={ambientColor} intensity={AMBIENT_LIGHT_INTENSITY * exposure} />
      <directionalLight
        position={keyLightPosition}
        color={surfaceLightColor}
        intensity={KEY_LIGHT_BASE_INTENSITY * exposure}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-left={-shadowCameraExtent}
        shadow-camera-right={shadowCameraExtent}
        shadow-camera-top={shadowCameraExtent}
        shadow-camera-bottom={-shadowCameraExtent}
        shadow-camera-near={1}
        shadow-camera-far={KEY_LIGHT_DISTANCE * 2.5}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
      />

      {/* The closing water volume. Rendered from the inside, unlit and
          fog-coloured, so the world ends in water rather than in an edge. */}
      <mesh>
        <sphereGeometry args={[basinRadius * WATER_VOLUME_RADIUS_MULTIPLIER, 24, 16]} />
        <meshBasicMaterial color={fogColor} side={BackSide} fog={false} />
      </mesh>

      <OceanSeafloor seafloor={seafloor} water={water} heightSampler={heightSampler} isMobile={isMobile} />
      <OceanFlora
        flora={scene.flora}
        current={current}
        water={water}
        basinRadius={basinRadius}
        heightSampler={heightSampler}
        isMobile={isMobile}
      />
      <OceanLightShafts
        lighting={lighting}
        water={water}
        seafloor={seafloor}
        heightSampler={heightSampler}
        seed={worldSeed}
      />
      <OceanParticles
        bioluminescence={scene.bioluminescence}
        current={current}
        water={water}
        basinRadius={basinRadius}
        isMobile={isMobile}
        worldSeed={worldSeed}
      />
      <OceanFauna
        fauna={scene.fauna}
        water={water}
        basinRadius={basinRadius}
        heightSampler={heightSampler}
        worldSeed={worldSeed}
      />
      <OceanLandmarks
        landmarks={scene.landmarks}
        pointsOfInterest={pointsOfInterest}
        water={water}
        heightSampler={heightSampler}
        selectedPlanetKey={selectedPlanetKey}
        hoveredPlanetKey={hoveredPlanetKey}
        onHoverPlanet={onHoverPlanet}
        onSelectPlanet={onSelectPlanet}
        worldSeed={worldSeed}
      />
    </group>
  );
}
