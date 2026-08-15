"use client";

import { useMemo } from "react";
import { BufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from "three";
import type { OceanSeafloorConfig, OceanWaterConfig } from "@/lib/types";
import { basinRadiusFromSeafloor, mixHexColors, scatterOnDisc, type SeafloorHeightSampler } from "./oceanMath";
import { seafloorRockGeometry } from "./oceanModels";

// The floor the whole world stands on: one displaced plane, a scatter of basalt
// rocks and a haze of sediment tufts. Everything reads the same height sampler
// the flora and the fish do, so nothing floats and nothing sinks.

const FLOOR_SEGMENTS = 96;
const FLOOR_OVERSHOOT = 1.9;
const SEDIMENT_TUFT_HEIGHT = 0.18;
const SEDIMENT_TUFT_WIDTH = 0.5;
const ROCK_SCALE_BASE = 0.5;
const ROCK_SCALE_RANGE = 1.5;

const FLOOR_BASE_COLOR = "#6E6350";
const ROCK_BASE_COLOR = "#4A4C52";
const SEDIMENT_BASE_COLOR = "#8A8069";

type OceanSeafloorProps = {
  seafloor?: OceanSeafloorConfig;
  water?: OceanWaterConfig;
  heightSampler: SeafloorHeightSampler;
  isMobile: boolean;
};

export function OceanSeafloor({ seafloor, water, heightSampler, isMobile }: OceanSeafloorProps) {
  const basinRadius = basinRadiusFromSeafloor(seafloor);
  const fogColor = water?.fogColor ?? "#0A3B4E";
  const tintStrength = water?.tintStrength ?? 0.4;

  // Everything on the floor is tinted toward the water by the depth curve's own
  // tintStrength. This is the line that makes a tan seabed read grey-blue at
  // depth without a second colour table.
  const floorColor = mixHexColors(FLOOR_BASE_COLOR, fogColor, tintStrength);
  const rockColor = mixHexColors(ROCK_BASE_COLOR, fogColor, tintStrength);
  const sedimentColor = mixHexColors(SEDIMENT_BASE_COLOR, fogColor, tintStrength * 0.85);

  const floorGeometry = useMemo(() => {
    // Overshoots the basin so the floor runs past the fog limit rather than
    // ending at a visible edge.
    const extent = basinRadius * FLOOR_OVERSHOOT * 2;
    const geometry = new PlaneGeometry(extent, extent, FLOOR_SEGMENTS, FLOOR_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position") as BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      positions.setY(index, heightSampler(x, z));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [basinRadius, heightSampler]);

  const rockInstances = useMemo(() => {
    const seed = seafloor?.placementSeed ?? "ocean-seafloor";
    const count = seafloor?.rockCount ?? 12;
    return scatterOnDisc(`${seed}-rocks`, count, basinRadius * 1.15, basinRadius * 0.1);
  }, [basinRadius, seafloor?.placementSeed, seafloor?.rockCount]);

  const sedimentInstances = useMemo(() => {
    const seed = seafloor?.placementSeed ?? "ocean-seafloor";
    const count = isMobile
      ? seafloor?.sedimentTuftCountMobile ?? 150
      : seafloor?.sedimentTuftCountDesktop ?? 500;
    return scatterOnDisc(`${seed}-sediment`, count, basinRadius * 1.05);
  }, [basinRadius, isMobile, seafloor?.placementSeed, seafloor?.sedimentTuftCountDesktop, seafloor?.sedimentTuftCountMobile]);

  const rockMeshRef = useInstancedPlacement(rockInstances, heightSampler, ROCK_SCALE_BASE, ROCK_SCALE_RANGE);
  const sedimentMeshRef = useInstancedPlacement(sedimentInstances, heightSampler, 0.6, 0.8);

  return (
    <group>
      <mesh geometry={floorGeometry} receiveShadow>
        <meshStandardMaterial color={floorColor} roughness={0.96} metalness={0.02} />
      </mesh>

      <instancedMesh ref={rockMeshRef} args={[seafloorRockGeometry(), undefined, rockInstances.length]} castShadow receiveShadow>
        <meshStandardMaterial color={rockColor} roughness={0.9} metalness={0.05} />
      </instancedMesh>

      {/* Sediment tufts: flat cards, not geometry. They exist to break the
          floor's silhouette at grazing angles, and at these counts anything
          with volume would cost more than it is worth. */}
      <instancedMesh ref={sedimentMeshRef} args={[undefined, undefined, sedimentInstances.length]}>
        <planeGeometry args={[SEDIMENT_TUFT_WIDTH, SEDIMENT_TUFT_HEIGHT]} />
        <meshStandardMaterial color={sedimentColor} roughness={1} transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

/**
 * Writes one instance matrix per scatter point, dropped onto the floor.
 *
 * A callback ref rather than useEffect: the instanced mesh has to be populated
 * before its first frame, and an effect runs after it.
 */
function useInstancedPlacement(
  instances: { x: number; z: number; variation: number; yawRadians: number }[],
  heightSampler: SeafloorHeightSampler,
  scaleBase: number,
  scaleRange: number
) {
  return useMemo(() => {
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const axis = new Vector3(0, 1, 0);
    return (mesh: InstancedMesh | null) => {
      if (!mesh) {
        return;
      }
      instances.forEach((instance, index) => {
        const uniformScale = scaleBase + instance.variation * scaleRange;
        position.set(instance.x, heightSampler(instance.x, instance.z), instance.z);
        quaternion.setFromAxisAngle(axis, instance.yawRadians);
        scale.setScalar(uniformScale);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
  }, [heightSampler, instances, scaleBase, scaleRange]);
}
