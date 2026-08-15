"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { OceanCurrentConfig, OceanFloraConfig, OceanWaterConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { mixHexColors, type SeafloorHeightSampler } from "./oceanMath";
import { FLORA_BASE_COLORS, FLORA_SWAYS, FLORA_TARGET_HEIGHTS, floraGeometryForKey } from "./oceanModels";

// The plant layer: one instanced draw per species in the config's mix, swayed
// by the current. Only species with a flexible body sway — a brain coral
// bending in the surge is the single tell that would make the whole reef read
// as cloth, so FLORA_SWAYS gates it.

const SWAY_RADIANS_PER_INTENSITY = 0.34;
const SWAY_BASE_SPEED = 0.5;
const GUST_DEPTH = 0.45;

type OceanFloraProps = {
  flora?: OceanFloraConfig;
  current?: OceanCurrentConfig;
  water?: OceanWaterConfig;
  basinRadius: number;
  heightSampler: SeafloorHeightSampler;
  isMobile: boolean;
};

type FloraSpeciesGroup = {
  modelKey: string;
  placements: { x: number; z: number; y: number; yaw: number; scale: number; phase: number }[];
};

export function OceanFlora({ flora, current, water, basinRadius, heightSampler, isMobile }: OceanFloraProps) {
  const fogColor = water?.fogColor ?? "#0A3B4E";
  const depthTint = flora?.depthTintStrength ?? 0.5;

  const speciesGroups = useMemo<FloraSpeciesGroup[]>(() => {
    const mix = (flora?.speciesMix ?? []).filter((entry) => entry.modelKey);
    if (mix.length === 0) {
      return [];
    }
    const totalCount = isMobile ? flora?.countMobile ?? 40 : flora?.countDesktop ?? 100;
    const scaleMin = flora?.scaleMin ?? 0.8;
    const scaleMax = flora?.scaleMax ?? 1.4;
    const nextRandomValue = randomFromSeed(flora?.placementSeed ?? "ocean-flora");
    const totalWeight = mix.reduce((sum, entry) => sum + (entry.weight ?? 0), 0) || 1;

    const groups = new Map<string, FloraSpeciesGroup>();
    for (const entry of mix) {
      groups.set(entry.modelKey as string, { modelKey: entry.modelKey as string, placements: [] });
    }
    for (let index = 0; index < totalCount; index += 1) {
      // Draw order is fixed per plant: species, angle, radial, yaw, scale,
      // phase. Drawing the species first keeps the placement of every later
      // plant stable if a weight is re-tuned.
      const speciesRoll = nextRandomValue() * totalWeight;
      let cumulative = 0;
      let chosen = mix[mix.length - 1];
      for (const entry of mix) {
        cumulative += entry.weight ?? 0;
        if (speciesRoll < cumulative) {
          chosen = entry;
          break;
        }
      }
      const angle = nextRandomValue() * Math.PI * 2;
      const radial = Math.sqrt(nextRandomValue()) * basinRadius;
      const yaw = nextRandomValue() * Math.PI * 2;
      const scale = scaleMin + nextRandomValue() * Math.max(0, scaleMax - scaleMin);
      const phase = nextRandomValue() * Math.PI * 2;
      const x = Math.cos(angle) * radial;
      const z = Math.sin(angle) * radial;
      groups
        .get(chosen.modelKey as string)
        ?.placements.push({ x, z, y: heightSampler(x, z), yaw, scale, phase });
    }
    return [...groups.values()].filter((group) => group.placements.length > 0);
  }, [
    basinRadius,
    flora?.countDesktop,
    flora?.countMobile,
    flora?.placementSeed,
    flora?.scaleMax,
    flora?.scaleMin,
    flora?.speciesMix,
    heightSampler,
    isMobile
  ]);

  return (
    <group>
      {speciesGroups.map((group) => (
        <FloraSpecies
          key={group.modelKey}
          group={group}
          swayStrength={flora?.swayStrength ?? 0.3}
          currentIntensity={current?.intensity ?? 0.3}
          currentDirectionRadians={current?.directionRadians ?? 0}
          gustFrequency={current?.gustFrequency ?? 0.25}
          color={mixHexColors(FLORA_BASE_COLORS[group.modelKey] ?? "#5A8A66", fogColor, depthTint)}
        />
      ))}
    </group>
  );
}

type FloraSpeciesProps = {
  group: FloraSpeciesGroup;
  swayStrength: number;
  currentIntensity: number;
  currentDirectionRadians: number;
  gustFrequency: number;
  color: string;
};

function FloraSpecies({
  group,
  swayStrength,
  currentIntensity,
  currentDirectionRadians,
  gustFrequency,
  color
}: FloraSpeciesProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => floraGeometryForKey(group.modelKey), [group.modelKey]);
  const sways = FLORA_SWAYS[group.modelKey] ?? true;
  // Tall species bend further at the same sway strength, which is what stops a
  // 5 m kelp strand and a 0.7 m anemone from moving as if they were the same
  // plant.
  const heightBendMultiplier = (FLORA_TARGET_HEIGHTS[group.modelKey] ?? 1) / 1.5;

  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(),
      tilt: new Quaternion(),
      yawAxis: new Vector3(0, 1, 0),
      leanAxis: new Vector3()
    }),
    []
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const elapsed = clock.getElapsedTime();
    // The bend follows the current's own direction and gust rhythm, so kelp in
    // a still abyss stands upright without anything checking the depth zone.
    const amplitude = sways
      ? swayStrength * currentIntensity * SWAY_RADIANS_PER_INTENSITY * heightBendMultiplier
      : 0;
    scratch.leanAxis.set(-Math.sin(currentDirectionRadians), 0, Math.cos(currentDirectionRadians));

    group.placements.forEach((placement, index) => {
      const gust = 1 + Math.sin(elapsed * gustFrequency * Math.PI + placement.phase) * GUST_DEPTH;
      const bend = amplitude * gust * Math.sin(elapsed * SWAY_BASE_SPEED + placement.phase);
      scratch.quaternion.setFromAxisAngle(scratch.yawAxis, placement.yaw);
      scratch.tilt.setFromAxisAngle(scratch.leanAxis, bend);
      scratch.quaternion.multiply(scratch.tilt);
      scratch.position.set(placement.x, placement.y, placement.z);
      scratch.scale.setScalar(placement.scale);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(index, scratch.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, group.placements.length]}
      castShadow
      receiveShadow
      // The bounding sphere is set once from the tallest possible plant: the
      // sway moves vertices every frame, and recomputing it per frame across
      // every species would cost more than the culling saves.
      frustumCulled={false}
    >
      <meshStandardMaterial color={color} roughness={0.82} metalness={0.03} />
    </instancedMesh>
  );
}
