"use client";

import { useMemo } from "react";
import {
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3
} from "three";
import type { ForestSeasonConfig, ForestTerrainConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import {
  blendedFoliageColors,
  blendedGroundColor,
  clearingRadiusFromTerrain,
  mixHexColors,
  smoothstepValue,
  treelineRadiusFromTerrain,
  type PathLateralDistanceSampler,
  type TerrainHeightSampler
} from "./forestMath";

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

const MINIMUM_ROCK_SCALE = 0.28;
const ROCK_SCALE_RANGE = 0.75;
const ROCK_COLOR = "#7D8577";
const ROCK_MOSS_TINT = "#5B7A4A";
const ROCK_SINK_DEPTH = 0.12;

const GRASS_TUFT_HEIGHT = 0.42;
const GRASS_TUFT_RADIUS = 0.055;
const MINIMUM_GRASS_SCALE = 0.6;
const GRASS_SCALE_RANGE = 0.8;
// Snow buries most tufts; a few dry stalks keep the ground from reading flat.
const SNOW_GRASS_TUFT_FRACTION = 0.15;
const SNOW_GRASS_COLOR = "#B9A87C";

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

type ForestTerrainProps = {
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  terrainHeightSampler: TerrainHeightSampler;
  pathLateralDistanceSampler: PathLateralDistanceSampler;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

/**
 * The forest floor: a displaced, vertex-colored ground disc (rolling hills,
 * flattened clearing, seeded dirt path), plus instanced rocks and grass
 * tufts scattered from the terrain placement seed.
 */
export function ForestTerrain({ terrain, season, terrainHeightSampler, pathLateralDistanceSampler }: ForestTerrainProps) {
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

  const rockInstancedMesh = useMemo(() => {
    const rockCount = terrain?.rockCount ?? 12;
    const geometry = new DodecahedronGeometry(1, 0);
    const material = new MeshStandardMaterial({
      color: mixHexColors(ROCK_COLOR, ROCK_MOSS_TINT, groundKind === "grass" ? 0.35 : 0.1),
      flatShading: true,
      roughness: 0.95
    });
    const mesh = new InstancedMesh(geometry, material, rockCount);
    const nextRandomValue = randomFromSeed(placementSeed + ROCK_SCATTER_SEED_SUFFIX);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const position = new Vector3();
    for (let rockIndex = 0; rockIndex < rockCount; rockIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = clearingRadius * 1.05 + nextRandomValue() * (treelineRadius - clearingRadius * 1.05);
      const rockScale = MINIMUM_ROCK_SCALE + nextRandomValue() * ROCK_SCALE_RANGE;
      const yaw = nextRandomValue() * Math.PI * 2;
      position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      position.y = terrainHeightSampler(position.x, position.z) + rockScale * (0.5 - ROCK_SINK_DEPTH);
      rotation.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      scale.set(rockScale, rockScale * 0.8, rockScale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(rockIndex, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }, [clearingRadius, groundKind, placementSeed, terrain?.rockCount, terrainHeightSampler, treelineRadius]);

  const grassInstancedMesh = useMemo(() => {
    const configuredCount = isMobileViewport()
      ? terrain?.grassTuftCountMobile ?? 300
      : terrain?.grassTuftCountDesktop ?? 800;
    const grassCount = groundKind === "snow" ? Math.floor(configuredCount * SNOW_GRASS_TUFT_FRACTION) : configuredCount;
    if (grassCount <= 0) {
      return null;
    }
    const geometry = new ConeGeometry(GRASS_TUFT_RADIUS, GRASS_TUFT_HEIGHT, 5);
    // Cones pivot at their center; shift up so instances sit on the ground.
    geometry.translate(0, GRASS_TUFT_HEIGHT / 2, 0);
    const foliageColors = blendedFoliageColors(season);
    const grassColor =
      groundKind === "snow"
        ? new Color(SNOW_GRASS_COLOR)
        : blendedGroundColor(season).lerp(foliageColors[1] ?? foliageColors[0], 0.5);
    const material = new MeshStandardMaterial({ color: grassColor, flatShading: true, roughness: 1 });
    const mesh = new InstancedMesh(geometry, material, grassCount);
    const nextRandomValue = randomFromSeed(placementSeed + GRASS_SCATTER_SEED_SUFFIX);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const position = new Vector3();
    const yAxis = new Vector3(0, 1, 0);
    for (let grassIndex = 0; grassIndex < grassCount; grassIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      // sqrt keeps the area density uniform instead of clustering the center.
      const radius = Math.sqrt(nextRandomValue()) * treelineRadius;
      const tuftScale = MINIMUM_GRASS_SCALE + nextRandomValue() * GRASS_SCALE_RANGE;
      const yaw = nextRandomValue() * Math.PI * 2;
      position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      const pathLateralDistance = pathLateralDistanceSampler(position.x, position.z);
      if (pathLateralDistance < PATH_HALF_WIDTH) {
        // Bare dirt on the path itself; the tuft slot is simply left empty
        // (a zero-scale instance) so the draw order stays fixed.
        scale.setScalar(0.0001);
      } else {
        scale.set(tuftScale, tuftScale, tuftScale);
      }
      position.y = terrainHeightSampler(position.x, position.z);
      rotation.setFromAxisAngle(yAxis, yaw);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(grassIndex, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [
    groundKind,
    pathLateralDistanceSampler,
    placementSeed,
    season,
    terrain?.grassTuftCountDesktop,
    terrain?.grassTuftCountMobile,
    terrainHeightSampler,
    treelineRadius
  ]);

  return (
    <group>
      <mesh geometry={groundMesh.geometry} material={groundMesh.material} receiveShadow />
      <primitive object={rockInstancedMesh} />
      {grassInstancedMesh ? <primitive object={grassInstancedMesh} /> : null}
    </group>
  );
}
