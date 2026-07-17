"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Group, Vector3 } from "three";
import type { ForestBirdFlockConfig, ForestGroundAnimalConfig, ForestTerrainConfig, ForestWildlifeConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { clearingRadiusFromTerrain, treelineRadiusFromTerrain, type TerrainHeightSampler } from "./forestMath";
import { ANIMAL_MODEL_CATALOG, BIRD_MODEL_DEFINITION, natureModelUrl, normalizationForObject } from "./forestModels";

// Real animals: Quaternius' animated GLB pack (deer/fox/wolf play their Walk
// clip) plus static CC models for boar/rabbit/bird, which fall back to a
// gentle body bob. Movement is the same seeded ping-pong wander as before.

const ANIMAL_WALK_SPEED_UNITS_PER_SECOND = 2.4;
const ANIMAL_BODY_BOB_AMPLITUDE = 0.035;
const ANIMAL_BODY_BOB_FREQUENCY = 8;
const ANIMAL_TURN_PAUSE_FRACTION = 0.06;
// Multiplies the config walkSpeed into the walk clip's playback rate so the
// hooves match the ground speed instead of moonwalking.
const WALK_CLIP_TIMESCALE_PER_WALK_SPEED = 2.2;

const BIRD_BANK_ROLL_RADIANS = 0.3;
const BIRD_CIRCLING_RADIUS_FRACTION = 0.5;
const BIRD_CIRCLING_SPEED_MULTIPLIER = 0.35;
const BIRD_CROSSING_SPEED_UNITS_PER_SECOND = 7;
const BIRD_ALTITUDE_WAVE_AMPLITUDE = 1.1;

type ForestWildlifeProps = {
  wildlife?: ForestWildlifeConfig;
  terrain?: ForestTerrainConfig;
  terrainHeightSampler: TerrainHeightSampler;
};

type AnimalModelProps = {
  modelKey: string;
  walkSpeed: number;
  /** True while the wander loop is in its end-of-path pause. */
  isPausedRef: React.MutableRefObject<boolean>;
};

/**
 * One loaded, normalized, animation-playing animal body. Skinned scenes are
 * cloned per individual (instancing does not apply to skeletons); counts are
 * tiny (≤6 animals per forest), so clones are cheap.
 */
function AnimalModel({ modelKey, walkSpeed, isPausedRef }: AnimalModelProps) {
  const definition = ANIMAL_MODEL_CATALOG[modelKey] ?? ANIMAL_MODEL_CATALOG["animal-deer"];
  const gltf = useGLTF(natureModelUrl(definition));
  const modelRootRef = useRef<Group>(null);

  const clonedScene = useMemo(() => {
    const cloned = SkeletonUtils.clone(gltf.scene);
    cloned.traverse((object) => {
      object.castShadow = true;
    });
    return cloned;
  }, [gltf.scene]);

  const { scale, footOffsetY } = useMemo(
    () => normalizationForObject(gltf.scene, definition.targetHeight),
    [definition.targetHeight, gltf.scene]
  );

  const { actions } = useAnimations(gltf.animations, modelRootRef);
  useEffect(() => {
    const walkAction = actions[definition.walkClipName] ?? actions[Object.keys(actions)[0] ?? ""];
    if (!walkAction) {
      return;
    }
    walkAction.reset().play();
    walkAction.timeScale = walkSpeed * WALK_CLIP_TIMESCALE_PER_WALK_SPEED;
    return () => {
      walkAction.stop();
    };
  }, [actions, definition.walkClipName, walkSpeed]);

  // Freeze the walk cycle during the end-of-path pause so the animal stands
  // instead of walking on the spot.
  useFrame(() => {
    const walkAction = actions[definition.walkClipName] ?? actions[Object.keys(actions)[0] ?? ""];
    if (walkAction) {
      walkAction.timeScale = isPausedRef.current ? 0 : walkSpeed * WALK_CLIP_TIMESCALE_PER_WALK_SPEED;
    }
  });

  return (
    <group ref={modelRootRef} position={[0, footOffsetY, 0]} scale={scale}>
      <primitive object={clonedScene} />
    </group>
  );
}

type GroundAnimalProps = {
  animalConfig: ForestGroundAnimalConfig;
  individualIndex: number;
  clearingRadius: number;
  treelineRadius: number;
  terrainHeightSampler: TerrainHeightSampler;
};

/** One animal wandering back and forth between two seeded waypoints. */
function GroundAnimal({ animalConfig, individualIndex, clearingRadius, treelineRadius, terrainHeightSampler }: GroundAnimalProps) {
  const groupRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);
  const isPausedRef = useRef(false);

  const modelKey = animalConfig.modelKey ?? "animal-deer";
  const definition = ANIMAL_MODEL_CATALOG[modelKey] ?? ANIMAL_MODEL_CATALOG["animal-deer"];
  const hasWalkClip = definition.walkClipName.length > 0;
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
    const cyclePosition = (((elapsedSeconds / cycleDurationSeconds + phaseOffset) % 2) + 2) % 2;
    const rawProgress = cyclePosition < 1 ? cyclePosition : 2 - cyclePosition;
    const pauseBand = ANIMAL_TURN_PAUSE_FRACTION;
    isPausedRef.current = rawProgress < pauseBand || rawProgress > 1 - pauseBand;
    const walkProgress = Math.min(1, Math.max(0, (rawProgress - pauseBand) / (1 - 2 * pauseBand)));
    const headingSign = cyclePosition < 1 ? 1 : -1;

    const x = waypointA.x + (waypointB.x - waypointA.x) * walkProgress;
    const z = waypointA.z + (waypointB.z - waypointA.z) * walkProgress;
    // Static models bob a little to read as alive; animated ones let the
    // walk clip carry the motion.
    const bodyBob =
      hasWalkClip || isPausedRef.current
        ? 0
        : Math.sin(elapsedSeconds * ANIMAL_BODY_BOB_FREQUENCY) * ANIMAL_BODY_BOB_AMPLITUDE * animalScale;
    group.position.set(x, terrainHeightSampler(x, z) + bodyBob, z);
    group.rotation.y = Math.atan2(
      (waypointB.x - waypointA.x) * headingSign,
      (waypointB.z - waypointA.z) * headingSign
    );
  });

  return (
    <group ref={groupRef} scale={animalScale}>
      <AnimalModel modelKey={modelKey} walkSpeed={walkSpeed} isPausedRef={isPausedRef} />
    </group>
  );
}

type BirdProps = {
  flockConfig: ForestBirdFlockConfig;
  birdIndex: number;
  treelineRadius: number;
};

/** One bird gliding a seeded flight path (banking into the turns). */
function Bird({ flockConfig, birdIndex, treelineRadius }: BirdProps) {
  const groupRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);
  const previousPosition = useRef(new Vector3());

  const gltf = useGLTF(natureModelUrl(BIRD_MODEL_DEFINITION));
  const clonedScene = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  const { scale, footOffsetY } = useMemo(
    () => normalizationForObject(gltf.scene, BIRD_MODEL_DEFINITION.targetHeight),
    [gltf.scene]
  );

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
    const altitudeWave = Math.sin(elapsedSeconds * 0.8 + birdPathParameters.wavePhase) * BIRD_ALTITUDE_WAVE_AMPLITUDE;

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

    // Face the direction of travel and bank into it.
    const movement = group.position.clone().sub(previousPosition.current);
    if (movement.lengthSq() > 0.000001) {
      group.rotation.y = Math.atan2(movement.x, movement.z);
      group.rotation.z =
        pattern === "circling"
          ? BIRD_BANK_ROLL_RADIANS
          : Math.sin(elapsedSeconds * 0.8 + birdPathParameters.wavePhase) * BIRD_BANK_ROLL_RADIANS * 0.4;
    }
    previousPosition.current.copy(group.position);
  });

  return (
    <group ref={groupRef}>
      <group position={[0, footOffsetY - BIRD_MODEL_DEFINITION.targetHeight / 2, 0]} scale={scale}>
        <primitive object={clonedScene} />
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
