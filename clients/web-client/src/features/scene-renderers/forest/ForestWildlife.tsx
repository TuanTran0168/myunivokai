"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, Group, Vector3 } from "three";
import type { ForestBirdFlockConfig, ForestGroundAnimalConfig, ForestTerrainConfig, ForestWildlifeConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { clearingRadiusFromTerrain, treelineRadiusFromTerrain, type TerrainHeightSampler } from "./forestMath";

// Stylized primitive wildlife. Like the trees, every species is a low-poly
// primitive assembly until the CC0 asset round replaces them with GLBs keyed
// by the same modelKey vocabulary.

type AnimalSpeciesShape = {
  bodyColor: string;
  bellyColor: string;
  bodyLength: number;
  bodyRadius: number;
  legHeight: number;
  headRadius: number;
  hasAntlers: boolean;
  earLength: number;
  tailStyle: "stub" | "bushy";
  bodyBobFrequency: number;
};

const ANIMAL_SHAPES_BY_MODEL_KEY: Record<string, AnimalSpeciesShape> = {
  "animal-deer": {
    bodyColor: "#A07B52",
    bellyColor: "#C4A87E",
    bodyLength: 1.15,
    bodyRadius: 0.3,
    legHeight: 0.72,
    headRadius: 0.19,
    hasAntlers: true,
    earLength: 0.14,
    tailStyle: "stub",
    bodyBobFrequency: 6
  },
  "animal-fox": {
    bodyColor: "#C96F33",
    bellyColor: "#E8D8C8",
    bodyLength: 0.78,
    bodyRadius: 0.19,
    legHeight: 0.34,
    headRadius: 0.14,
    hasAntlers: false,
    earLength: 0.13,
    tailStyle: "bushy",
    bodyBobFrequency: 8
  },
  "animal-rabbit": {
    bodyColor: "#9C948A",
    bellyColor: "#CFC8BE",
    bodyLength: 0.42,
    bodyRadius: 0.15,
    legHeight: 0.14,
    headRadius: 0.11,
    hasAntlers: false,
    earLength: 0.22,
    tailStyle: "stub",
    bodyBobFrequency: 12
  },
  "animal-boar": {
    bodyColor: "#5C4A3A",
    bellyColor: "#776552",
    bodyLength: 0.95,
    bodyRadius: 0.3,
    legHeight: 0.34,
    headRadius: 0.2,
    hasAntlers: false,
    earLength: 0.09,
    tailStyle: "stub",
    bodyBobFrequency: 7
  },
  "animal-wolf": {
    bodyColor: "#8A8D93",
    bellyColor: "#B9BCC2",
    bodyLength: 1.0,
    bodyRadius: 0.24,
    legHeight: 0.55,
    headRadius: 0.17,
    hasAntlers: false,
    earLength: 0.12,
    tailStyle: "bushy",
    bodyBobFrequency: 7
  }
};
const DEFAULT_ANIMAL_SHAPE = ANIMAL_SHAPES_BY_MODEL_KEY["animal-deer"];

const ANIMAL_WALK_SPEED_UNITS_PER_SECOND = 2.4;
const ANIMAL_BODY_BOB_AMPLITUDE = 0.035;
const ANIMAL_TURN_PAUSE_FRACTION = 0.06;

const BIRD_BODY_COLOR = "#3A3F47";
const BIRD_WING_COLOR = "#565D68";
const BIRD_WING_FLAP_FREQUENCY = 9;
const BIRD_WING_FLAP_AMPLITUDE = 0.55;
const BIRD_CIRCLING_RADIUS_FRACTION = 0.5;
const BIRD_CIRCLING_SPEED_MULTIPLIER = 0.35;
const BIRD_CROSSING_SPEED_UNITS_PER_SECOND = 7;
const BIRD_ALTITUDE_WAVE_AMPLITUDE = 1.1;

type ForestWildlifeProps = {
  wildlife?: ForestWildlifeConfig;
  terrain?: ForestTerrainConfig;
  terrainHeightSampler: TerrainHeightSampler;
};

type GroundAnimalProps = {
  animalConfig: ForestGroundAnimalConfig;
  individualIndex: number;
  clearingRadius: number;
  treelineRadius: number;
  terrainHeightSampler: TerrainHeightSampler;
};

/** One animal walking back and forth between two seeded waypoints. */
function GroundAnimal({ animalConfig, individualIndex, clearingRadius, treelineRadius, terrainHeightSampler }: GroundAnimalProps) {
  const groupRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);

  const shape = ANIMAL_SHAPES_BY_MODEL_KEY[animalConfig.modelKey ?? ""] ?? DEFAULT_ANIMAL_SHAPE;
  const animalScale = animalConfig.scale ?? 1;
  const walkSpeed = animalConfig.walkSpeed ?? 0.5;

  const { waypointA, waypointB, phaseOffset } = useMemo(() => {
    const nextRandomValue = randomFromSeed(`${animalConfig.pathSeed ?? "forest-animal"}-individual-${individualIndex}`);
    const wanderInnerRadius = clearingRadius * 0.5;
    const wanderOuterRadius = Math.min(clearingRadius * 2.4, treelineRadius * 0.8);
    const pickWaypoint = () => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = wanderInnerRadius + nextRandomValue() * (wanderOuterRadius - wanderInnerRadius);
      return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    };
    return { waypointA: pickWaypoint(), waypointB: pickWaypoint(), phaseOffset: nextRandomValue() * 2 };
  }, [animalConfig.pathSeed, clearingRadius, individualIndex, treelineRadius]);

  useFrame((_, deltaTimeSeconds) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const pathLength = Math.max(waypointA.distanceTo(waypointB), 0.001);
    const cycleDurationSeconds = pathLength / (walkSpeed * ANIMAL_WALK_SPEED_UNITS_PER_SECOND);
    // Ping-pong parameter with a brief pause at each end (the "graze and
    // turn" beat that sells back-and-forth wandering).
    const cyclePosition = ((elapsedSeconds / cycleDurationSeconds + phaseOffset) % 2 + 2) % 2;
    const rawProgress = cyclePosition < 1 ? cyclePosition : 2 - cyclePosition;
    const pauseBand = ANIMAL_TURN_PAUSE_FRACTION;
    const walkProgress = Math.min(1, Math.max(0, (rawProgress - pauseBand) / (1 - 2 * pauseBand)));
    const headingSign = cyclePosition < 1 ? 1 : -1;

    const x = waypointA.x + (waypointB.x - waypointA.x) * walkProgress;
    const z = waypointA.z + (waypointB.z - waypointA.z) * walkProgress;
    const bodyBob = Math.sin(elapsedSeconds * shape.bodyBobFrequency) * ANIMAL_BODY_BOB_AMPLITUDE * animalScale;
    group.position.set(x, terrainHeightSampler(x, z) + bodyBob, z);
    group.rotation.y = Math.atan2(
      (waypointB.x - waypointA.x) * headingSign,
      (waypointB.z - waypointA.z) * headingSign
    );
  });

  const legOffsetX = shape.bodyRadius * 0.55;
  const legOffsetZ = shape.bodyLength * 0.32;
  const bodyCenterHeight = shape.legHeight + shape.bodyRadius * 0.9;
  const headForwardOffset = shape.bodyLength * 0.62;
  const headHeight = bodyCenterHeight + shape.bodyRadius * 0.65;

  return (
    <group ref={groupRef} scale={animalScale}>
      {/* Body — a squashed sphere reads as a torso at this poly count. */}
      <mesh position={[0, bodyCenterHeight, 0]} scale={[shape.bodyRadius, shape.bodyRadius * 0.85, shape.bodyLength * 0.5]} castShadow>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color={shape.bodyColor} flatShading roughness={0.9} />
      </mesh>
      {/* Head with a hint of neck. */}
      <mesh position={[0, headHeight, headForwardOffset]} castShadow>
        <sphereGeometry args={[shape.headRadius, 8, 6]} />
        <meshStandardMaterial color={shape.bodyColor} flatShading roughness={0.9} />
      </mesh>
      {/* Ears. */}
      <mesh position={[shape.headRadius * 0.5, headHeight + shape.headRadius, headForwardOffset]} rotation={[0.2, 0, -0.15]}>
        <coneGeometry args={[shape.earLength * 0.32, shape.earLength, 4]} />
        <meshStandardMaterial color={shape.bodyColor} flatShading roughness={0.9} />
      </mesh>
      <mesh position={[-shape.headRadius * 0.5, headHeight + shape.headRadius, headForwardOffset]} rotation={[0.2, 0, 0.15]}>
        <coneGeometry args={[shape.earLength * 0.32, shape.earLength, 4]} />
        <meshStandardMaterial color={shape.bodyColor} flatShading roughness={0.9} />
      </mesh>
      {/* Antlers, deer only. */}
      {shape.hasAntlers ? (
        <>
          <mesh position={[shape.headRadius * 0.55, headHeight + shape.headRadius * 1.6, headForwardOffset]} rotation={[0, 0, -0.4]}>
            <coneGeometry args={[0.03, 0.3, 4]} />
            <meshStandardMaterial color="#D9C7A8" flatShading roughness={0.85} />
          </mesh>
          <mesh position={[-shape.headRadius * 0.55, headHeight + shape.headRadius * 1.6, headForwardOffset]} rotation={[0, 0, 0.4]}>
            <coneGeometry args={[0.03, 0.3, 4]} />
            <meshStandardMaterial color="#D9C7A8" flatShading roughness={0.85} />
          </mesh>
        </>
      ) : null}
      {/* Four legs. */}
      {[
        [legOffsetX, legOffsetZ],
        [-legOffsetX, legOffsetZ],
        [legOffsetX, -legOffsetZ],
        [-legOffsetX, -legOffsetZ]
      ].map(([offsetX, offsetZ], legIndex) => (
        <mesh key={legIndex} position={[offsetX, shape.legHeight / 2, offsetZ]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, shape.legHeight, 5]} />
          <meshStandardMaterial color={shape.bodyColor} flatShading roughness={0.9} />
        </mesh>
      ))}
      {/* Tail. */}
      {shape.tailStyle === "bushy" ? (
        <mesh position={[0, bodyCenterHeight + 0.05, -shape.bodyLength * 0.6]} rotation={[Math.PI / 2.6, 0, 0]}>
          <coneGeometry args={[shape.bodyRadius * 0.45, shape.bodyLength * 0.6, 6]} />
          <meshStandardMaterial color={shape.bellyColor} flatShading roughness={0.9} />
        </mesh>
      ) : (
        <mesh position={[0, bodyCenterHeight + shape.bodyRadius * 0.4, -shape.bodyLength * 0.5]}>
          <sphereGeometry args={[shape.bodyRadius * 0.28, 6, 5]} />
          <meshStandardMaterial color={shape.bellyColor} flatShading roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

type BirdProps = {
  flockConfig: ForestBirdFlockConfig;
  birdIndex: number;
  treelineRadius: number;
};

/** One bird: cone body + two flapping wing planes on a seeded flight path. */
function Bird({ flockConfig, birdIndex, treelineRadius }: BirdProps) {
  const groupRef = useRef<Group>(null);
  const leftWingRef = useRef<Group>(null);
  const rightWingRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);
  const previousPosition = useRef(new Vector3());

  const flightSpeed = flockConfig.flightSpeed ?? 0.6;
  const pattern = flockConfig.pattern ?? "circling";

  const birdPathParameters = useMemo(() => {
    const nextRandomValue = randomFromSeed(`${flockConfig.pathSeed ?? "forest-birds"}-bird-${birdIndex}`);
    const altitudeMin = flockConfig.altitudeMin ?? 14;
    const altitudeMax = flockConfig.altitudeMax ?? 20;
    return {
      phaseOffset: nextRandomValue() * Math.PI * 2,
      altitude: altitudeMin + nextRandomValue() * Math.max(altitudeMax - altitudeMin, 0),
      radiusJitter: (nextRandomValue() - 0.5) * treelineRadius * 0.15,
      lateralLaneOffset: (nextRandomValue() - 0.5) * treelineRadius * 0.5,
      crossingDirectionRadians: nextRandomValue() * Math.PI * 2,
      wavePhase: nextRandomValue() * Math.PI * 2
    };
  }, [birdIndex, flockConfig.altitudeMax, flockConfig.altitudeMin, flockConfig.pathSeed, treelineRadius]);

  useFrame((_, deltaTimeSeconds) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const altitudeWave =
      Math.sin(elapsedSeconds * 0.8 + birdPathParameters.wavePhase) * BIRD_ALTITUDE_WAVE_AMPLITUDE;

    if (pattern === "circling") {
      const circlingRadius = treelineRadius * BIRD_CIRCLING_RADIUS_FRACTION + birdPathParameters.radiusJitter;
      const angle = elapsedSeconds * flightSpeed * BIRD_CIRCLING_SPEED_MULTIPLIER + birdPathParameters.phaseOffset;
      group.position.set(
        Math.cos(angle) * circlingRadius,
        birdPathParameters.altitude + altitudeWave,
        Math.sin(angle) * circlingRadius
      );
    } else {
      // Crossing: fly a straight lane through the scene, wrapping at the far
      // side (a new bird "arrives" as one leaves).
      const lapLength = treelineRadius * 2.8;
      const travel =
        ((elapsedSeconds * flightSpeed * BIRD_CROSSING_SPEED_UNITS_PER_SECOND + birdPathParameters.phaseOffset * lapLength) %
          lapLength) -
        lapLength / 2;
      const directionX = Math.cos(birdPathParameters.crossingDirectionRadians);
      const directionZ = Math.sin(birdPathParameters.crossingDirectionRadians);
      group.position.set(
        directionX * travel - directionZ * birdPathParameters.lateralLaneOffset,
        birdPathParameters.altitude + altitudeWave,
        directionZ * travel + directionX * birdPathParameters.lateralLaneOffset
      );
    }

    // Face the direction of travel.
    const movement = group.position.clone().sub(previousPosition.current);
    if (movement.lengthSq() > 0.000001) {
      group.rotation.y = Math.atan2(movement.x, movement.z);
    }
    previousPosition.current.copy(group.position);

    // Wing flap.
    const flapAngle = Math.sin(elapsedSeconds * BIRD_WING_FLAP_FREQUENCY + birdPathParameters.wavePhase) * BIRD_WING_FLAP_AMPLITUDE;
    if (leftWingRef.current) {
      leftWingRef.current.rotation.z = flapAngle;
    }
    if (rightWingRef.current) {
      rightWingRef.current.rotation.z = -flapAngle;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.09, 0.42, 5]} />
        <meshStandardMaterial color={BIRD_BODY_COLOR} flatShading roughness={0.85} />
      </mesh>
      <group ref={leftWingRef} position={[0.05, 0, 0]}>
        <mesh position={[0.24, 0, 0]}>
          <planeGeometry args={[0.48, 0.2]} />
          <meshStandardMaterial color={BIRD_WING_COLOR} side={DoubleSide} flatShading roughness={0.85} />
        </mesh>
      </group>
      <group ref={rightWingRef} position={[-0.05, 0, 0]}>
        <mesh position={[-0.24, 0, 0]}>
          <planeGeometry args={[0.48, 0.2]} />
          <meshStandardMaterial color={BIRD_WING_COLOR} side={DoubleSide} flatShading roughness={0.85} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The living layer: ground animals wandering between seeded waypoints and
 * bird flocks circling or crossing overhead. Path seeds come from the config
 * (one stream per slot), so the same forest always moves the same way.
 */
export function ForestWildlife({ wildlife, terrain, terrainHeightSampler }: ForestWildlifeProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);

  return (
    <group>
      {(wildlife?.groundAnimals ?? []).map((animalConfig, slotIndex) =>
        Array.from({ length: animalConfig.count ?? 1 }, (_, individualIndex) => (
          <GroundAnimal
            key={`${animalConfig.modelKey ?? "animal"}-${slotIndex}-${individualIndex}`}
            animalConfig={animalConfig}
            individualIndex={individualIndex}
            clearingRadius={clearingRadius}
            treelineRadius={treelineRadius}
            terrainHeightSampler={terrainHeightSampler}
          />
        ))
      )}
      {(wildlife?.birdFlocks ?? []).map((flockConfig, flockIndex) =>
        Array.from({ length: flockConfig.birdCount ?? 3 }, (_, birdIndex) => (
          <Bird
            key={`flock-${flockIndex}-bird-${birdIndex}`}
            flockConfig={flockConfig}
            birdIndex={birdIndex}
            treelineRadius={treelineRadius}
          />
        ))
      )}
    </group>
  );
}
