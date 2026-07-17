"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color, Float32BufferAttribute, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3 } from "three";
import type { ForestSeasonConfig, ForestTerrainConfig, ForestTreesConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import {
  blendedFoliageColors,
  blendedGroundColor,
  clearingRadiusFromTerrain,
  smoothstepValue,
  treelineRadiusFromTerrain,
  type PathLateralDistanceSampler,
  type TerrainHeightSampler
} from "./forestMath";
import {
  buildStaticInstancedMeshes,
  extractInstancedModelVariants,
  GRASS_MODEL_DEFINITIONS,
  natureModelUrl,
  ROCK_MODEL_DEFINITIONS,
  type StaticInstanceTransform
} from "./forestModels";

const GROUND_SEGMENTS_PER_SIDE = 128;
// The ground extends past the treeline so the horizon never shows a raw mesh
// edge; fog and the sky dome hide the rim.
const GROUND_RADIUS_BEYOND_TREELINE_MULTIPLIER = 1.6;

const GROUND_COLOR_NOISE_SEED_SUFFIX = "-ground-noise";
const ROCK_SCATTER_SEED_SUFFIX = "-rocks";
const GRASS_SCATTER_SEED_SUFFIX = "-grass";

const GROUND_COLOR_VARIATION_STRENGTH = 0.1;
const CLEARING_LIGHTEN_STRENGTH = 0.12;
const DIRT_PATH_COLOR = "#71543A";
const PATH_HALF_WIDTH = 1.4;
const PATH_EDGE_FEATHER = 0.9;

const MINIMUM_ROCK_SCALE = 0.5;
const ROCK_SCALE_RANGE = 1.3;
const ROCK_SINK_DEPTH = 0.08;

const MINIMUM_GRASS_SCALE = 0.6;
const GRASS_SCALE_RANGE = 0.8;
// Snow buries most tufts; a few dry stalks keep the ground from reading flat.
const SNOW_GRASS_TUFT_FRACTION = 0.15;
const SNOW_GRASS_COLOR = "#B9A87C";

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

type ForestTerrainProps = {
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  /** Wind (under trees in the config) also ripples the grass layer. */
  trees?: ForestTreesConfig;
  terrainHeightSampler: TerrainHeightSampler;
  pathLateralDistanceSampler: PathLateralDistanceSampler;
};

// Grass wind ripple.
const GRASS_SWAY_BASE_RADIANS = 0.14;
const GRASS_SWAY_GUST_FREQUENCY_TO_RADIANS = Math.PI * 2;

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

/**
 * The forest floor: a displaced, vertex-colored ground disc (rolling hills,
 * flattened clearing, seeded dirt path), plus instanced rocks and grass
 * tufts scattered from the terrain placement seed.
 */
export function ForestTerrain({ terrain, season, trees, terrainHeightSampler, pathLateralDistanceSampler }: ForestTerrainProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const placementSeed = terrain?.placementSeed ?? "forest-terrain";
  const groundKind = season?.groundKind ?? "grass";

  const groundMesh = useMemo(() => {
    const groundRadius = treelineRadius * GROUND_RADIUS_BEYOND_TREELINE_MULTIPLIER;
    const geometry = new PlaneGeometry(groundRadius * 2, groundRadius * 2, GROUND_SEGMENTS_PER_SIDE, GROUND_SEGMENTS_PER_SIDE);
    geometry.rotateX(-Math.PI / 2);

    const nextRandomValue = randomFromSeed(placementSeed + GROUND_COLOR_NOISE_SEED_SUFFIX);
    const baseGroundColor = blendedGroundColor(season);
    const pathColor = new Color(DIRT_PATH_COLOR);

    const positionAttribute = geometry.getAttribute("position");
    const vertexColors = new Float32Array(positionAttribute.count * 3);
    const workingColor = new Color();
    for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
      const x = positionAttribute.getX(vertexIndex);
      const z = positionAttribute.getZ(vertexIndex);
      positionAttribute.setY(vertexIndex, terrainHeightSampler(x, z));

      workingColor.copy(baseGroundColor);
      // Per-vertex brightness noise breaks up the flat ground plane. The draw
      // count per vertex is fixed (one), so the pattern is stable per seed.
      const brightnessJitter = 1 + (nextRandomValue() - 0.5) * 2 * GROUND_COLOR_VARIATION_STRENGTH;
      workingColor.multiplyScalar(brightnessJitter);
      // The clearing reads slightly sun-bleached so the hero area pops.
      const radiusFromCenter = Math.hypot(x, z);
      const clearingLightenFactor = 1 - smoothstepValue(clearingRadius * 0.7, clearingRadius * 1.2, radiusFromCenter);
      workingColor.lerp(new Color("#FFFFFF"), clearingLightenFactor * CLEARING_LIGHTEN_STRENGTH);
      // Dirt path band with a feathered edge.
      const pathLateralDistance = pathLateralDistanceSampler(x, z);
      const pathBlend = 1 - smoothstepValue(PATH_HALF_WIDTH, PATH_HALF_WIDTH + PATH_EDGE_FEATHER, pathLateralDistance);
      workingColor.lerp(pathColor, pathBlend);

      vertexColors[vertexIndex * 3] = workingColor.r;
      vertexColors[vertexIndex * 3 + 1] = workingColor.g;
      vertexColors[vertexIndex * 3 + 2] = workingColor.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: groundKind === "snow" ? 0.75 : 1,
      metalness: 0
    });
    return { geometry, material };
  }, [clearingRadius, groundKind, pathLateralDistanceSampler, placementSeed, season, terrainHeightSampler, treelineRadius]);

  // Real mossy rocks (Quaternius MegaKit), instanced across the seeded
  // scatter. Draw order per rock: angle, radius, scale, yaw, variant pick.
  const rockModelUrls = useMemo(() => ROCK_MODEL_DEFINITIONS.map((definition) => natureModelUrl(definition)), []);
  const loadedRockModels = useGLTF(rockModelUrls);
  const rockInstancedMeshes = useMemo(() => {
    const rockVariants = loadedRockModels.flatMap((gltf, definitionIndex) =>
      gltf?.scene ? extractInstancedModelVariants(gltf.scene, ROCK_MODEL_DEFINITIONS[definitionIndex].targetHeight) : []
    );
    if (rockVariants.length === 0) {
      return [];
    }
    const rockCount = terrain?.rockCount ?? 12;
    const nextRandomValue = randomFromSeed(placementSeed + ROCK_SCATTER_SEED_SUFFIX);
    const transformsPerVariant: StaticInstanceTransform[][] = rockVariants.map(() => []);
    for (let rockIndex = 0; rockIndex < rockCount; rockIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = clearingRadius * 1.05 + nextRandomValue() * (treelineRadius - clearingRadius * 1.05);
      const rockScale = MINIMUM_ROCK_SCALE + nextRandomValue() * ROCK_SCALE_RANGE;
      const yawRadians = nextRandomValue() * Math.PI * 2;
      const variantIndex = Math.floor(nextRandomValue() * rockVariants.length);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      transformsPerVariant[variantIndex].push({
        position: new Vector3(x, terrainHeightSampler(x, z) - rockScale * ROCK_SINK_DEPTH, z),
        yawRadians,
        scale: rockScale
      });
    }
    return rockVariants.flatMap((variant, variantIndex) =>
      transformsPerVariant[variantIndex].length > 0
        ? buildStaticInstancedMeshes(variant, transformsPerVariant[variantIndex], { receiveShadow: true })
        : []
    );
  }, [clearingRadius, loadedRockModels, placementSeed, terrain?.rockCount, terrainHeightSampler, treelineRadius]);

  // Real grass tufts, seasonal color per instance. Draw order per tuft:
  // angle, radius, scale, yaw, variant pick.
  const grassModelUrls = useMemo(() => GRASS_MODEL_DEFINITIONS.map((definition) => natureModelUrl(definition)), []);
  const loadedGrassModels = useGLTF(grassModelUrls);
  const grassInstancedMeshes = useMemo(() => {
    const grassVariants = loadedGrassModels.flatMap((gltf, definitionIndex) =>
      gltf?.scene ? extractInstancedModelVariants(gltf.scene, GRASS_MODEL_DEFINITIONS[definitionIndex].targetHeight) : []
    );
    if (grassVariants.length === 0) {
      return [];
    }
    const configuredCount = isMobileViewport()
      ? terrain?.grassTuftCountMobile ?? 300
      : terrain?.grassTuftCountDesktop ?? 800;
    const grassCount = groundKind === "snow" ? Math.floor(configuredCount * SNOW_GRASS_TUFT_FRACTION) : configuredCount;
    if (grassCount <= 0) {
      return [];
    }
    const foliageColors = blendedFoliageColors(season);
    const grassColor =
      groundKind === "snow"
        ? new Color(SNOW_GRASS_COLOR)
        : blendedGroundColor(season).lerp(foliageColors[1] ?? foliageColors[0], 0.5);
    const nextRandomValue = randomFromSeed(placementSeed + GRASS_SCATTER_SEED_SUFFIX);
    const transformsPerVariant: StaticInstanceTransform[][] = grassVariants.map(() => []);
    for (let grassIndex = 0; grassIndex < grassCount; grassIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      // sqrt keeps the area density uniform instead of clustering the center.
      const radius = Math.sqrt(nextRandomValue()) * treelineRadius;
      const tuftScale = MINIMUM_GRASS_SCALE + nextRandomValue() * GRASS_SCALE_RANGE;
      const yawRadians = nextRandomValue() * Math.PI * 2;
      const variantIndex = Math.floor(nextRandomValue() * grassVariants.length);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Bare dirt on the path itself; the tuft slot stays drawn (fixed draw
      // order) but renders at zero scale.
      const isOnPath = pathLateralDistanceSampler(x, z) < PATH_HALF_WIDTH;
      transformsPerVariant[variantIndex].push({
        position: new Vector3(x, terrainHeightSampler(x, z), z),
        yawRadians,
        scale: isOnPath ? 0.0001 : tuftScale,
        foliageColor: grassColor
      });
    }
    return grassVariants
      .map((variant, variantIndex) => ({
        instancedMeshes:
          transformsPerVariant[variantIndex].length > 0
            ? buildStaticInstancedMeshes(variant, transformsPerVariant[variantIndex], { castShadow: false })
            : [],
        transforms: transformsPerVariant[variantIndex]
      }))
      .filter((bucket) => bucket.instancedMeshes.length > 0);
  }, [
    groundKind,
    loadedGrassModels,
    pathLateralDistanceSampler,
    placementSeed,
    season,
    terrain?.grassTuftCountDesktop,
    terrain?.grassTuftCountMobile,
    terrainHeightSampler,
    treelineRadius
  ]);

  // Wind ripple over the grass: each tuft pivots at its base with a phase
  // derived from its position, so gusts read as waves rolling across the
  // meadow instead of synchronized wobble.
  const windStrength = trees?.windStrength ?? 0.35;
  const windDirectionRadians = trees?.windDirectionRadians ?? 0;
  const windGustFrequency = trees?.windGustFrequency ?? 0.3;
  const elapsedSecondsRef = useRef(0);
  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const gustAngularFrequency = windGustFrequency * GRASS_SWAY_GUST_FREQUENCY_TO_RADIANS;
    const tiltAxis = new Vector3(-Math.sin(windDirectionRadians), 0, Math.cos(windDirectionRadians));
    const windDirectionX = Math.cos(windDirectionRadians);
    const windDirectionZ = Math.sin(windDirectionRadians);
    const matrix = new Matrix4();
    const yawQuaternion = new Quaternion();
    const tiltQuaternion = new Quaternion();
    const combinedQuaternion = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);
    const scaleVector = new Vector3();
    for (const bucket of grassInstancedMeshes) {
      bucket.transforms.forEach((transform, instanceIndex) => {
        // Position-based phase: the gust wave travels along the wind.
        const travelPhase = (transform.position.x * windDirectionX + transform.position.z * windDirectionZ) * 0.35;
        const tiltRadians =
          Math.sin(elapsedSeconds * gustAngularFrequency - travelPhase) * windStrength * GRASS_SWAY_BASE_RADIANS;
        yawQuaternion.setFromAxisAngle(yAxis, transform.yawRadians);
        tiltQuaternion.setFromAxisAngle(tiltAxis, tiltRadians);
        combinedQuaternion.copy(tiltQuaternion).multiply(yawQuaternion);
        scaleVector.setScalar(transform.scale);
        matrix.compose(transform.position, combinedQuaternion, scaleVector);
        for (const instancedMesh of bucket.instancedMeshes) {
          instancedMesh.setMatrixAt(instanceIndex, matrix);
        }
      });
      for (const instancedMesh of bucket.instancedMeshes) {
        instancedMesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      <mesh geometry={groundMesh.geometry} material={groundMesh.material} receiveShadow />
      {rockInstancedMeshes.map((mesh, meshIndex) => (
        <primitive key={`rock-${meshIndex}`} object={mesh} />
      ))}
      {grassInstancedMeshes.flatMap((bucket, bucketIndex) =>
        bucket.instancedMeshes.map((mesh, meshIndex) => (
          <primitive key={`grass-${bucketIndex}-${meshIndex}`} object={mesh} />
        ))
      )}
    </group>
  );
}
