"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3
} from "three";
import type { ForestSeasonConfig, ForestTerrainConfig, ForestTreesConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import {
  blendedFoliageColors,
  clampValue,
  clearingRadiusFromTerrain,
  treelineRadiusFromTerrain,
  type PathLateralDistanceSampler,
  type TerrainHeightSampler
} from "./forestMath";

// Procedural low-poly tree kit. Until the CC0 asset round (N5) ships real GLB
// models, every species is built from primitives; the modelKey vocabulary in
// the config already names the final assets, so swapping in GLBs later only
// touches this file.

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

// Placement draws per tree, in fixed order: angle, radius, species, scale,
// yaw, sway phase, foliage color pick. Always drawn for the full desktop
// count so the mobile forest is a strict prefix subset of the desktop one.
const TREE_RING_INNER_MARGIN = 0.8;
const PATH_TREE_EXCLUSION_HALF_WIDTH = 1.6;

const TRUNK_RADIUS_TOP = 0.09;
const TRUNK_RADIUS_BOTTOM = 0.17;
const TRUNK_BASE_HEIGHT = 2.0;
const TRUNK_RADIAL_SEGMENTS = 6;

const CANOPY_BASE_RADIUS = 1.15;
const PINE_LAYER_BASE_RADIUS = 1.0;
const PINE_LAYER_BASE_HEIGHT = 1.5;
const PINE_LAYER_COUNT = 3;
// Each pine layer up the trunk shrinks and rises by these steps.
const PINE_LAYER_RADIUS_STEP = 0.26;
const PINE_LAYER_HEIGHT_OFFSETS = [1.4, 2.3, 3.15];

const DEAD_BRANCH_LENGTH = 1.1;
const DEAD_BRANCH_RADIUS = 0.05;

const WIND_SWAY_BASE_AMPLITUDE = 0.16;
const WIND_SECONDARY_WOBBLE_RATIO = 0.35;
const WIND_GUST_FREQUENCY_TO_RADIANS = Math.PI * 2;

const TRUNK_COLORS_BY_SPECIES: Record<string, string> = {
  "tree-birch": "#E4E0D2",
  "tree-oak": "#6E5138",
  "tree-pine": "#5E452F",
  "tree-pine-snow": "#4F3E2E",
  "tree-dead": "#6B5744",
  "tree-blossom": "#7A5A44"
};

// Species-level foliage anchors, blended with the season palette by
// foliageTintStrength (0.5-0.85): high tint = the season owns the color.
const FOLIAGE_ANCHOR_COLORS_BY_SPECIES: Record<string, string> = {
  "tree-birch": "#9CC468",
  "tree-oak": "#4F8A3D",
  "tree-pine": "#33633B",
  "tree-pine-snow": "#33633B",
  "tree-blossom": "#EFA8C8"
};

const PINE_SNOW_COVER_COLOR = "#EAF2F6";
const PINE_SNOW_COVER_BLEND = 0.72;

// Canopy proportions per round-canopy species: [width, height, depth].
const CANOPY_SCALES_BY_SPECIES: Record<string, [number, number, number]> = {
  "tree-birch": [0.85, 1.25, 0.85],
  "tree-oak": [1.35, 1.05, 1.35],
  "tree-blossom": [1.1, 0.95, 1.1]
};

const CANOPY_HEIGHT_RATIOS_BY_SPECIES: Record<string, number> = {
  "tree-birch": 1.35,
  "tree-oak": 1.15,
  "tree-blossom": 1.1
};

type TreeInstance = {
  position: Vector3;
  treeScale: number;
  yawRadians: number;
  swayPhase: number;
  foliageColor: Color;
  speciesKey: string;
};

type SpeciesBuckets = {
  roundCanopyTrees: TreeInstance[];
  pineTrees: TreeInstance[];
  deadTrees: TreeInstance[];
  allTrees: TreeInstance[];
};

type ForestTreesProps = {
  trees?: ForestTreesConfig;
  terrain?: ForestTerrainConfig;
  season?: ForestSeasonConfig;
  terrainHeightSampler: TerrainHeightSampler;
  pathLateralDistanceSampler: PathLateralDistanceSampler;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

function speciesKeyForRoll(roll: number, trees?: ForestTreesConfig): string {
  const speciesMix = trees?.speciesMix ?? [];
  const totalWeight = speciesMix.reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
  if (totalWeight <= 0 || speciesMix.length === 0) {
    return "tree-oak";
  }
  let cumulative = 0;
  for (const entry of speciesMix) {
    cumulative += (entry.weight ?? 0) / totalWeight;
    if (roll < cumulative) {
      return entry.modelKey ?? "tree-oak";
    }
  }
  return speciesMix[speciesMix.length - 1].modelKey ?? "tree-oak";
}

/**
 * The tree layer: seeded scatter between the clearing and the treeline,
 * species-weighted, instanced per part (trunks, round canopies, pine layers,
 * dead branches — a handful of draw calls regardless of tree count), with the
 * canopies swaying in the config's wind every frame.
 */
export function ForestTrees({ trees, terrain, season, terrainHeightSampler, pathLateralDistanceSampler }: ForestTreesProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);

  const windStrength = trees?.windStrength ?? 0.35;
  const windDirectionRadians = trees?.windDirectionRadians ?? 0;
  const windGustFrequency = trees?.windGustFrequency ?? 0.3;

  const speciesBuckets = useMemo<SpeciesBuckets>(() => {
    const desktopCount = trees?.countDesktop ?? 180;
    const renderCount = isMobileViewport() ? trees?.countMobile ?? Math.floor(desktopCount * 0.4) : desktopCount;
    const scaleMin = trees?.scaleMin ?? 0.8;
    const scaleMax = trees?.scaleMax ?? 1.45;
    const foliageTintStrength = trees?.foliageTintStrength ?? 0.65;
    const foliageColors = blendedFoliageColors(season);

    const nextRandomValue = randomFromSeed(trees?.placementSeed ?? "forest-trees");
    const buckets: SpeciesBuckets = { roundCanopyTrees: [], pineTrees: [], deadTrees: [], allTrees: [] };
    // Draw the full desktop population so a phone and a desktop agree on
    // where every tree stands; the mobile budget just renders fewer of them.
    for (let treeIndex = 0; treeIndex < desktopCount; treeIndex += 1) {
      const angleRoll = nextRandomValue();
      const radiusRoll = nextRandomValue();
      const speciesRoll = nextRandomValue();
      const scaleRoll = nextRandomValue();
      const yawRoll = nextRandomValue();
      const swayPhaseRoll = nextRandomValue();
      const foliageColorRoll = nextRandomValue();
      if (treeIndex >= renderCount) {
        continue;
      }

      const angle = angleRoll * Math.PI * 2;
      const innerRadius = clearingRadius + TREE_RING_INNER_MARGIN;
      // sqrt keeps area density uniform across the ring.
      const radius = Math.sqrt(radiusRoll) * (treelineRadius - innerRadius) + innerRadius;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (pathLateralDistanceSampler(x, z) < PATH_TREE_EXCLUSION_HALF_WIDTH) {
        continue;
      }

      const speciesKey = speciesKeyForRoll(speciesRoll, trees);
      const seasonFoliageColor = foliageColors[Math.floor(foliageColorRoll * foliageColors.length)] ?? foliageColors[0];
      const speciesAnchorHex = FOLIAGE_ANCHOR_COLORS_BY_SPECIES[speciesKey];
      let foliageColor = speciesAnchorHex
        ? new Color(speciesAnchorHex).lerp(seasonFoliageColor, clampValue(foliageTintStrength, 0, 1))
        : seasonFoliageColor.clone();
      if (speciesKey === "tree-pine-snow") {
        foliageColor = foliageColor.clone().lerp(new Color(PINE_SNOW_COVER_COLOR), PINE_SNOW_COVER_BLEND);
      }

      const instance: TreeInstance = {
        position: new Vector3(x, terrainHeightSampler(x, z), z),
        treeScale: scaleMin + scaleRoll * (scaleMax - scaleMin),
        yawRadians: yawRoll * Math.PI * 2,
        swayPhase: swayPhaseRoll * Math.PI * 2,
        foliageColor,
        speciesKey
      };
      buckets.allTrees.push(instance);
      if (speciesKey === "tree-pine" || speciesKey === "tree-pine-snow") {
        buckets.pineTrees.push(instance);
      } else if (speciesKey === "tree-dead") {
        buckets.deadTrees.push(instance);
      } else {
        buckets.roundCanopyTrees.push(instance);
      }
    }
    return buckets;
  }, [clearingRadius, pathLateralDistanceSampler, season, terrainHeightSampler, treelineRadius, trees]);

  const trunkInstancedMesh = useMemo(() => {
    const treeInstances = speciesBuckets.allTrees;
    if (treeInstances.length === 0) {
      return null;
    }
    const geometry = new CylinderGeometry(TRUNK_RADIUS_TOP, TRUNK_RADIUS_BOTTOM, TRUNK_BASE_HEIGHT, TRUNK_RADIAL_SEGMENTS);
    geometry.translate(0, TRUNK_BASE_HEIGHT / 2, 0);
    const material = new MeshStandardMaterial({ flatShading: true, roughness: 0.95 });
    const mesh = new InstancedMesh(geometry, material, treeInstances.length);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);
    const scale = new Vector3();
    treeInstances.forEach((tree, index) => {
      rotation.setFromAxisAngle(yAxis, tree.yawRadians);
      scale.set(tree.treeScale, tree.treeScale, tree.treeScale);
      matrix.compose(tree.position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new Color(TRUNK_COLORS_BY_SPECIES[tree.speciesKey] ?? TRUNK_COLORS_BY_SPECIES["tree-oak"]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = true;
    return mesh;
  }, [speciesBuckets]);

  const roundCanopyInstancedMesh = useMemo(() => {
    const treeInstances = speciesBuckets.roundCanopyTrees;
    if (treeInstances.length === 0) {
      return null;
    }
    const geometry = new IcosahedronGeometry(CANOPY_BASE_RADIUS, 1);
    const material = new MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
    const mesh = new InstancedMesh(geometry, material, treeInstances.length);
    treeInstances.forEach((tree, index) => {
      mesh.setColorAt(index, tree.foliageColor);
    });
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = true;
    return mesh;
  }, [speciesBuckets]);

  const pineLayerInstancedMeshes = useMemo(() => {
    const treeInstances = speciesBuckets.pineTrees;
    if (treeInstances.length === 0) {
      return [];
    }
    return Array.from({ length: PINE_LAYER_COUNT }, (_, layerIndex) => {
      const layerRadius = PINE_LAYER_BASE_RADIUS - layerIndex * PINE_LAYER_RADIUS_STEP;
      const geometry = new ConeGeometry(layerRadius, PINE_LAYER_BASE_HEIGHT, 7);
      const material = new MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
      const mesh = new InstancedMesh(geometry, material, treeInstances.length);
      treeInstances.forEach((tree, index) => {
        mesh.setColorAt(index, tree.foliageColor);
      });
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.castShadow = true;
      return mesh;
    });
  }, [speciesBuckets]);

  const deadBranchInstancedMesh = useMemo(() => {
    const treeInstances = speciesBuckets.deadTrees;
    if (treeInstances.length === 0) {
      return null;
    }
    // Two bare branches per dead tree, as one instanced mesh (2 instances per
    // tree) — dead trees have no canopy, just reaching limbs.
    const geometry = new CylinderGeometry(DEAD_BRANCH_RADIUS * 0.5, DEAD_BRANCH_RADIUS, DEAD_BRANCH_LENGTH, 5);
    geometry.translate(0, DEAD_BRANCH_LENGTH / 2, 0);
    const material = new MeshStandardMaterial({
      color: new Color(TRUNK_COLORS_BY_SPECIES["tree-dead"]),
      flatShading: true,
      roughness: 1
    });
    const mesh = new InstancedMesh(geometry, material, treeInstances.length * 2);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const tiltAxis = new Vector3();
    const scale = new Vector3();
    const branchBase = new Vector3();
    treeInstances.forEach((tree, treeIndex) => {
      for (let branchIndex = 0; branchIndex < 2; branchIndex += 1) {
        const branchYaw = tree.yawRadians + branchIndex * Math.PI * 0.7;
        const branchHeight = TRUNK_BASE_HEIGHT * tree.treeScale * (0.62 + branchIndex * 0.22);
        branchBase.set(tree.position.x, tree.position.y + branchHeight, tree.position.z);
        tiltAxis.set(Math.cos(branchYaw), 0, Math.sin(branchYaw)).normalize();
        rotation.setFromAxisAngle(tiltAxis, Math.PI / 2.6);
        scale.setScalar(tree.treeScale);
        matrix.compose(branchBase, rotation, scale);
        mesh.setMatrixAt(treeIndex * 2 + branchIndex, matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    return mesh;
  }, [speciesBuckets]);

  // Wind: every frame the canopies (round + pine layers) lean along the wind
  // direction by a per-tree phased gust wave. Trunks stay planted — the
  // motion reads as canopy sway, not whole trees skating.
  const elapsedSecondsRef = useRef(0);
  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const gustAngularFrequency = windGustFrequency * WIND_GUST_FREQUENCY_TO_RADIANS;
    const windDirectionX = Math.cos(windDirectionRadians);
    const windDirectionZ = Math.sin(windDirectionRadians);

    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);
    const scale = new Vector3();
    const swayedPosition = new Vector3();

    const swayOffsetForTree = (tree: TreeInstance) => {
      const primaryWave = Math.sin(elapsedSeconds * gustAngularFrequency + tree.swayPhase);
      const secondaryWobble =
        Math.sin(elapsedSeconds * gustAngularFrequency * 2.7 + tree.swayPhase * 1.7) * WIND_SECONDARY_WOBBLE_RATIO;
      return (primaryWave + secondaryWobble) * windStrength * WIND_SWAY_BASE_AMPLITUDE * tree.treeScale;
    };

    if (roundCanopyInstancedMesh) {
      speciesBuckets.roundCanopyTrees.forEach((tree, index) => {
        const swayOffset = swayOffsetForTree(tree);
        const canopyHeight = TRUNK_BASE_HEIGHT * tree.treeScale * (CANOPY_HEIGHT_RATIOS_BY_SPECIES[tree.speciesKey] ?? 1.2);
        swayedPosition.set(
          tree.position.x + windDirectionX * swayOffset,
          tree.position.y + canopyHeight,
          tree.position.z + windDirectionZ * swayOffset
        );
        rotation.setFromAxisAngle(yAxis, tree.yawRadians);
        const canopyScale = CANOPY_SCALES_BY_SPECIES[tree.speciesKey] ?? CANOPY_SCALES_BY_SPECIES["tree-oak"];
        scale.set(canopyScale[0] * tree.treeScale, canopyScale[1] * tree.treeScale, canopyScale[2] * tree.treeScale);
        matrix.compose(swayedPosition, rotation, scale);
        roundCanopyInstancedMesh.setMatrixAt(index, matrix);
      });
      roundCanopyInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    pineLayerInstancedMeshes.forEach((layerMesh, layerIndex) => {
      speciesBuckets.pineTrees.forEach((tree, index) => {
        // Upper pine layers sway more than lower ones — the tip whips, the
        // skirt barely moves.
        const layerSwayMultiplier = 0.5 + (layerIndex / (PINE_LAYER_COUNT - 1)) * 0.9;
        const swayOffset = swayOffsetForTree(tree) * layerSwayMultiplier;
        swayedPosition.set(
          tree.position.x + windDirectionX * swayOffset,
          tree.position.y + PINE_LAYER_HEIGHT_OFFSETS[layerIndex] * tree.treeScale,
          tree.position.z + windDirectionZ * swayOffset
        );
        rotation.setFromAxisAngle(yAxis, tree.yawRadians);
        scale.setScalar(tree.treeScale);
        matrix.compose(swayedPosition, rotation, scale);
        layerMesh.setMatrixAt(index, matrix);
      });
      layerMesh.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <group>
      {trunkInstancedMesh ? <primitive object={trunkInstancedMesh} /> : null}
      {roundCanopyInstancedMesh ? <primitive object={roundCanopyInstancedMesh} /> : null}
      {pineLayerInstancedMeshes.map((layerMesh, layerIndex) => (
        <primitive key={layerIndex} object={layerMesh} />
      ))}
      {deadBranchInstancedMesh ? <primitive object={deadBranchInstancedMesh} /> : null}
    </group>
  );
}
