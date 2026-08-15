"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from "three";
import type { OceanDrifterConfig, OceanFaunaConfig, OceanFishSchoolConfig, OceanWaterConfig } from "@/lib/types";
import { rarityFeature } from "@/lib/rarity";
import { randomFromSeed } from "@/lib/scene";
import {
  createSchoolMemberOffsets,
  createSchoolPath,
  giantPassStateAt,
  mixHexColors,
  type SeafloorHeightSampler
} from "./oceanMath";
import {
  ABYSS_VISITOR_BASE_COLORS,
  FISH_BASE_COLORS,
  FISH_EMISSIVE_STRENGTH,
  GIANT_BASE_COLORS,
  abyssVisitorGeometryForKey,
  drifterGeometryForKey,
  fishGeometryForKey,
  giantGeometryForKey
} from "./oceanModels";

// Everything that moves under its own power: schools, drifters, the giant that
// passes at fog distance, and the abyssal visitor the rare-feature lottery may
// send.

const TAIL_BEAT_SPEED = 7.5;
const TAIL_BEAT_YAW_RADIANS = 0.22;
const DRIFTER_RISE_SPEED = 0.12;
const DRIFTER_PULSE_SCALE = 0.16;
const GIANT_TILT_RADIANS = 0.06;

type OceanFaunaProps = {
  fauna?: OceanFaunaConfig;
  water?: OceanWaterConfig;
  basinRadius: number;
  heightSampler: SeafloorHeightSampler;
  /** The variant seed. The ocean lotteries hang off it directly. */
  worldSeed: string;
};

export function OceanFauna({ fauna, water, basinRadius, heightSampler, worldSeed }: OceanFaunaProps) {
  const fogColor = water?.fogColor ?? "#0A3B4E";
  const tintStrength = water?.tintStrength ?? 0.4;

  return (
    <group>
      {(fauna?.schools ?? []).map((school, index) => (
        <FishSchool
          key={school.pathSeed ?? `school-${index}`}
          school={school}
          basinRadius={basinRadius}
          heightSampler={heightSampler}
          fogColor={fogColor}
          tintStrength={tintStrength}
        />
      ))}
      {(fauna?.drifters ?? []).map((drifter, index) => (
        <Drifters
          key={drifter.pathSeed ?? `drifter-${index}`}
          drifter={drifter}
          basinRadius={basinRadius}
          heightSampler={heightSampler}
        />
      ))}
      {(fauna?.giants ?? []).map((giant, index) => (
        <PassingGiant
          key={giant.passSeed ?? `giant-${index}`}
          modelKey={giant.modelKey ?? "giant-humpback"}
          passSeed={giant.passSeed ?? `${worldSeed}-ocean-giant-0`}
          approachDistance={giant.approachDistance ?? 24}
          passDurationSeconds={giant.passDurationSeconds ?? 26}
          heightSampler={heightSampler}
          fogColor={fogColor}
          tintStrength={tintStrength}
        />
      ))}
      <AbyssalVisitor worldSeed={worldSeed} basinRadius={basinRadius} heightSampler={heightSampler} />
    </group>
  );
}

type FishSchoolProps = {
  school: OceanFishSchoolConfig;
  basinRadius: number;
  heightSampler: SeafloorHeightSampler;
  fogColor: string;
  tintStrength: number;
};

function FishSchool({ school, basinRadius, heightSampler, fogColor, tintStrength }: FishSchoolProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const modelKey = school.modelKey ?? "fish-reef-school";
  const count = school.count ?? 12;
  const pathSeed = school.pathSeed ?? "ocean-school";

  const path = useMemo(
    () =>
      createSchoolPath(
        pathSeed,
        basinRadius,
        school.depthBandMin ?? 2,
        school.depthBandMax ?? 6,
        school.swimSpeed ?? 0.5
      ),
    [basinRadius, pathSeed, school.depthBandMax, school.depthBandMin, school.swimSpeed]
  );
  const members = useMemo(
    () => createSchoolMemberOffsets(pathSeed, count, school.cohesion ?? 0.6, school.separation ?? 0.4),
    [count, pathSeed, school.cohesion, school.separation]
  );
  const geometry = useMemo(() => fishGeometryForKey(modelKey), [modelKey]);
  const emissiveStrength = FISH_EMISSIVE_STRENGTH[modelKey] ?? 0;

  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(),
      forward: new Vector3(),
      up: new Vector3(0, 1, 0),
      yawAxis: new Vector3(0, 1, 0),
      beat: new Quaternion()
    }),
    []
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const elapsed = clock.getElapsedTime();
    const baseAngle = path.phase + elapsed * path.angularSpeed;

    members.forEach((member, index) => {
      const angle = baseAngle + member.alongTrackRadians;
      const radiusX = path.radiusX + member.lateralOffset;
      const radiusZ = path.radiusZ + member.lateralOffset;
      const x = path.centerX + Math.cos(angle) * radiusX;
      const z = path.centerZ + Math.sin(angle) * radiusZ;
      const bob = Math.sin(elapsed * path.bobSpeed + member.beatPhase) * path.bobAmplitude;
      // The band is measured above the SEAFLOOR, not above zero, so a school
      // keeps its height over the floor as the floor rises and falls.
      const y = heightSampler(x, z) + path.heightAboveFloor + member.verticalOffset + bob;

      // Face along the tangent of the loop, which is the direction it is
      // actually travelling — the alternative (facing the centre) is what makes
      // a school read as a carousel.
      const tangentX = -Math.sin(angle) * radiusX * Math.sign(path.angularSpeed || 1);
      const tangentZ = Math.cos(angle) * radiusZ * Math.sign(path.angularSpeed || 1);
      scratch.forward.set(tangentX, 0, tangentZ).normalize();
      const heading = Math.atan2(scratch.forward.z, scratch.forward.x);
      const beatYaw = Math.sin(elapsed * TAIL_BEAT_SPEED + member.beatPhase) * TAIL_BEAT_YAW_RADIANS;
      scratch.quaternion.setFromAxisAngle(scratch.yawAxis, -heading + beatYaw);

      scratch.position.set(x, y, z);
      scratch.scale.setScalar(member.scale);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(index, scratch.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  const bodyColor = mixHexColors(FISH_BASE_COLORS[modelKey] ?? "#9FB6C4", fogColor, tintStrength);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, members.length]} castShadow frustumCulled={false}>
      <meshStandardMaterial
        color={bodyColor}
        roughness={0.45}
        metalness={0.25}
        // Photophores. Deep-sea fish carry their own light; reef fish get zero,
        // so nothing has to ask which zone it is in.
        emissive={FISH_BASE_COLORS[modelKey] ?? "#9FB6C4"}
        emissiveIntensity={emissiveStrength}
      />
    </instancedMesh>
  );
}

type DriftersProps = {
  drifter: OceanDrifterConfig;
  basinRadius: number;
  heightSampler: SeafloorHeightSampler;
};

function Drifters({ drifter, basinRadius, heightSampler }: DriftersProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const modelKey = drifter.modelKey ?? "drifter-moon-jelly";
  const count = drifter.count ?? 6;
  const pathSeed = drifter.pathSeed ?? "ocean-drifter";
  const pulseRate = drifter.pulseRate ?? 0.4;
  const emissiveColor = drifter.emissiveColor ?? "#5EEAD4";
  const geometry = useMemo(() => drifterGeometryForKey(modelKey), [modelKey]);

  const placements = useMemo(() => {
    const nextRandomValue = randomFromSeed(pathSeed);
    return Array.from({ length: count }, () => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radial = Math.sqrt(nextRandomValue()) * basinRadius * 0.85;
      const baseHeight = 2 + nextRandomValue() * 9;
      const phase = nextRandomValue() * Math.PI * 2;
      const scale = 0.7 + nextRandomValue() * 0.8;
      const driftRadius = 0.6 + nextRandomValue() * 1.8;
      return {
        x: Math.cos(angle) * radial,
        z: Math.sin(angle) * radial,
        baseHeight,
        phase,
        scale,
        driftRadius
      };
    });
  }, [basinRadius, count, pathSeed]);

  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(),
      axis: new Vector3(0, 1, 0)
    }),
    []
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const elapsed = clock.getElapsedTime();
    placements.forEach((placement, index) => {
      // A jellyfish does not swim, it pulses: it rises on the contraction and
      // sinks between them, which is what the sawtooth here is for.
      const pulse = Math.sin(elapsed * pulseRate * Math.PI * 2 + placement.phase);
      const rise = (elapsed * DRIFTER_RISE_SPEED + placement.phase) % 12;
      const x = placement.x + Math.cos(elapsed * 0.08 + placement.phase) * placement.driftRadius;
      const z = placement.z + Math.sin(elapsed * 0.08 + placement.phase) * placement.driftRadius;
      const y = heightSampler(x, z) + placement.baseHeight + rise * 0.35 + pulse * 0.3;
      scratch.position.set(x, y, z);
      scratch.quaternion.setFromAxisAngle(scratch.axis, placement.phase + elapsed * 0.05);
      const bellScale = placement.scale * (1 + pulse * DRIFTER_PULSE_SCALE);
      scratch.scale.set(bellScale, placement.scale * (1 - pulse * DRIFTER_PULSE_SCALE * 0.6), bellScale);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(index, scratch.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, placements.length]} frustumCulled={false}>
      {/* The drifters are the only creatures that carry their own light at
          every depth, and in the abyss they are most of what there is to see.
          The emissive is strong enough to read with the Bloom pass switched
          off — that is an acceptance criterion, not a preference. */}
      <meshStandardMaterial
        color={emissiveColor}
        emissive={emissiveColor}
        emissiveIntensity={1.5}
        transparent
        opacity={0.62}
        depthWrite={false}
        roughness={0.25}
      />
    </instancedMesh>
  );
}

type PassingGiantProps = {
  modelKey: string;
  passSeed: string;
  approachDistance: number;
  passDurationSeconds: number;
  heightSampler: SeafloorHeightSampler;
  fogColor: string;
  tintStrength: number;
};

function PassingGiant({
  modelKey,
  passSeed,
  approachDistance,
  passDurationSeconds,
  heightSampler,
  fogColor,
  tintStrength
}: PassingGiantProps) {
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);
  const geometry = useMemo(() => giantGeometryForKey(modelKey), [modelKey]);
  const color = mixHexColors(GIANT_BASE_COLORS[modelKey] ?? "#38434F", fogColor, tintStrength * 0.7);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh) {
      return;
    }
    const elapsed = clock.getElapsedTime();
    const pass = giantPassStateAt(passSeed, approachDistance, passDurationSeconds, elapsed);
    if (!pass) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const y = heightSampler(pass.x, pass.z) + 9 + Math.sin(elapsed * 0.22) * 1.4;
    group.position.set(pass.x, y, pass.z);
    group.rotation.set(Math.sin(elapsed * 0.3) * GIANT_TILT_RADIANS, -pass.headingRadians, 0);
    // Fades in and out of the fog rather than popping. A giant that appears
    // instantly at full opacity is a prop; one that resolves out of the water
    // is a moment.
    const material = mesh.material as { opacity: number; transparent: boolean };
    material.transparent = true;
    material.opacity = pass.presence;
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh ref={meshRef} geometry={geometry} castShadow>
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} transparent opacity={0} />
      </mesh>
    </group>
  );
}

type AbyssalVisitorProps = {
  worldSeed: string;
  basinRadius: number;
  heightSampler: SeafloorHeightSampler;
};

/**
 * The ocean-abyss-visitor lottery, drawn here.
 *
 * Its species list is frozen forever in contracts_rarity.go — selection is
 * floor(roll x len) — so this component and that catalogue must agree about
 * which index means which animal. It reads the catalogue rather than repeating
 * the list, which is the only way to keep that true.
 */
function AbyssalVisitor({ worldSeed, basinRadius, heightSampler }: AbyssalVisitorProps) {
  const groupRef = useRef<Group>(null);

  const visitor = useMemo(() => {
    const feature = rarityFeature("ocean-abyss-visitor");
    const nextRandomValue = randomFromSeed(worldSeed + feature.seedSuffix);
    const roll = nextRandomValue();
    if (roll >= feature.probability) {
      return null;
    }
    const speciesRoll = nextRandomValue();
    const species = feature.species ?? [];
    if (species.length === 0) {
      return null;
    }
    const speciesIndex = Math.min(species.length - 1, Math.floor(speciesRoll * species.length));
    return species[speciesIndex];
  }, [worldSeed]);

  const placement = useMemo(() => {
    if (!visitor) {
      return null;
    }
    const nextRandomValue = randomFromSeed(`${worldSeed}-ocean-abyss-visitor-path`);
    const angle = nextRandomValue() * Math.PI * 2;
    const radial = basinRadius * (0.45 + nextRandomValue() * 0.4);
    const height = 3 + nextRandomValue() * 6;
    const phase = nextRandomValue() * Math.PI * 2;
    return { x: Math.cos(angle) * radial, z: Math.sin(angle) * radial, height, phase };
  }, [basinRadius, visitor, worldSeed]);

  const geometry = useMemo(() => (visitor ? abyssVisitorGeometryForKey(visitor.key) : null), [visitor]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !placement) {
      return;
    }
    const elapsed = clock.getElapsedTime();
    // Barely moves. That is the point: a thing that hangs almost still in the
    // dark is far more unsettling than a thing that swims past.
    const x = placement.x + Math.cos(elapsed * 0.05 + placement.phase) * 1.6;
    const z = placement.z + Math.sin(elapsed * 0.05 + placement.phase) * 1.6;
    group.position.set(x, heightSampler(x, z) + placement.height + Math.sin(elapsed * 0.3) * 0.4, z);
    group.rotation.y = -Math.atan2(Math.cos(elapsed * 0.05 + placement.phase), Math.sin(elapsed * 0.05 + placement.phase));
  });

  if (!visitor || !geometry || !placement) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial
          color={ABYSS_VISITOR_BASE_COLORS[visitor.key] ?? "#1B2230"}
          roughness={0.6}
          metalness={0.15}
        />
      </mesh>
      {/* The lure. An anglerfish without one is a fish; with one it is the
          reason anybody knows what an anglerfish is. */}
      {visitor.key === "anglerfish" ? (
        <mesh position={[1.05, 1.15, 0]}>
          <sphereGeometry args={[0.11, 10, 8]} />
          <meshBasicMaterial color="#9AE6FF" toneMapped={false} blending={AdditiveBlending} />
        </mesh>
      ) : null}
      {visitor.key === "anglerfish" ? <pointLight position={[1.05, 1.15, 0]} color="#9AE6FF" intensity={5} distance={9} /> : null}
    </group>
  );
}
