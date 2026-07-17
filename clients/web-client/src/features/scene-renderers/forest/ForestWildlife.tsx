"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import type {
  ForestBirdFlockConfig,
  ForestGroundAnimalConfig,
  ForestTerrainConfig,
  ForestWildlifeConfig,
  PlanetSceneConfig
} from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { usePlanetPositionTracker } from "@/features/scene-renderers/shared/PlanetPositionTracker";
import { clearingRadiusFromTerrain, treelineRadiusFromTerrain, type TerrainHeightSampler } from "./forestMath";
import {
  ANIMAL_DISPLAY_NAMES,
  ANIMAL_MODEL_CATALOG,
  BIRD_MODEL_DEFINITIONS,
  BIRD_PLUMAGE_TINTS,
  natureModelUrl,
  normalizationForObject,
  SPECIAL_BIRD_DEFINITIONS,
  SPECIAL_BIRD_PROBABILITY,
  type SpecialBirdDefinition
} from "./forestModels";

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
  // The world seed drives the rare special-bird sighting (seed encodes DNA).
  worldSeed: string;
  // Animals join the interactive POI layer: hover shows the species tooltip,
  // click makes the camera follow the wandering animal.
  selectedPlanetKey: string | null;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

// A per-world seeded roll: ~SPECIAL_BIRD_PROBABILITY of forests get one rare
// crosser, and a second roll picks which species. Returns null otherwise.
function resolveSpecialBird(worldSeed: string): SpecialBirdDefinition | null {
  const nextRandomValue = randomFromSeed(worldSeed + "-forest-special-bird");
  if (nextRandomValue() >= SPECIAL_BIRD_PROBABILITY) {
    return null;
  }
  const speciesIndex = Math.floor(nextRandomValue() * SPECIAL_BIRD_DEFINITIONS.length);
  return SPECIAL_BIRD_DEFINITIONS[speciesIndex] ?? SPECIAL_BIRD_DEFINITIONS[0];
}

const ANIMAL_HIT_SPHERE_RADIUS_MULTIPLIER = 1.4;
const ANIMAL_CAMERA_FOCUS_HEIGHT = 0.9;

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
  pointOfInterest: PlanetSceneConfig;
  isSelected: boolean;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

/** One animal wandering back and forth between two seeded waypoints. */
function GroundAnimal({
  animalConfig,
  individualIndex,
  clearingRadius,
  treelineRadius,
  terrainHeightSampler,
  pointOfInterest,
  isSelected,
  onHoverPlanet,
  onSelectPlanet
}: GroundAnimalProps) {
  const groupRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);
  const isPausedRef = useRef(false);
  const planetPositionTracker = usePlanetPositionTracker();
  const trackedPositionRef = useRef(new Vector3());
  const identityKey = planetIdentityKey(pointOfInterest, individualIndex);

  // Register the LIVE position vector once; the camera rig reads this map
  // every frame, so a selected animal is followed as it wanders.
  useEffect(() => {
    planetPositionTracker.set(identityKey, trackedPositionRef.current);
    const trackerReference = planetPositionTracker;
    return () => {
      trackerReference.delete(identityKey);
    };
  }, [identityKey, planetPositionTracker]);

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
    trackedPositionRef.current.set(
      group.position.x,
      group.position.y + ANIMAL_CAMERA_FOCUS_HEIGHT * animalScale,
      group.position.z
    );
  });

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onHoverPlanet(pointOfInterest);
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onHoverPlanet(null);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    onSelectPlanet?.(isSelected ? null : pointOfInterest);
  }

  const hitSphereRadius = definition.targetHeight * ANIMAL_HIT_SPHERE_RADIUS_MULTIPLIER;

  return (
    <group ref={groupRef} scale={animalScale}>
      <AnimalModel modelKey={modelKey} walkSpeed={walkSpeed} isPausedRef={isPausedRef} />
      {/* Invisible, forgiving hit target around the body. */}
      <mesh
        visible={false}
        position={[0, definition.targetHeight * 0.5, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[hitSphereRadius, 8, 6]} />
      </mesh>
    </group>
  );
}

// Recolors every mesh material of a cloned bird by multiplying a plumage tint
// (and optional emissive glow for the special birds) into it.
function tintBirdScene(scene: Group, plumageColor: string, emissiveIntensity: number): Group {
  const tint = new Color(plumageColor);
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.castShadow = true;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) {
      return;
    }
    const tintedMaterial = (material as MeshStandardMaterial).clone();
    if (tintedMaterial.color) {
      tintedMaterial.color = tintedMaterial.color.clone().multiply(tint);
    }
    if (emissiveIntensity > 0 && tintedMaterial.emissive) {
      tintedMaterial.emissive = tint.clone();
      tintedMaterial.emissiveIntensity = emissiveIntensity;
    }
    mesh.material = tintedMaterial;
  });
  return scene;
}

type BirdProps = {
  flockConfig: ForestBirdFlockConfig;
  flockIndex: number;
  birdIndex: number;
  treelineRadius: number;
};

/**
 * One bird on a seeded flight path. The wings flap via the model's own
 * skeletal animation clip (useAnimations) — the previous whole-body roll
 * "flap" on a static mesh was the thing that looked wrong. The body only
 * banks into turns.
 */
function Bird({ flockConfig, flockIndex, birdIndex, treelineRadius }: BirdProps) {
  const groupRef = useRef<Group>(null);
  const modelRootRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);
  const previousPosition = useRef(new Vector3());

  // Alternate the bird model per flock and the plumage tint per bird — two
  // animated silhouettes × three tints reads as several species overhead.
  const birdDefinition = BIRD_MODEL_DEFINITIONS[flockIndex % BIRD_MODEL_DEFINITIONS.length];
  const plumageTint = BIRD_PLUMAGE_TINTS[birdIndex % BIRD_PLUMAGE_TINTS.length];
  const gltf = useGLTF(natureModelUrl(birdDefinition));
  const clonedScene = useMemo(
    () => tintBirdScene(SkeletonUtils.clone(gltf.scene) as Group, plumageTint, 0),
    [gltf.scene, plumageTint]
  );
  const { scale, centerOffset } = useMemo(
    () => normalizationForObject(gltf.scene, birdDefinition.targetHeight, "longestAxis"),
    [birdDefinition.targetHeight, gltf.scene]
  );

  // Play the flap clip, staggered per bird so a flock doesn't beat in unison.
  // useAnimations drives the mixer on its own internal useFrame — do NOT also
  // update it here or the wingbeat runs at double speed.
  const { actions } = useAnimations(gltf.animations, modelRootRef);
  useEffect(() => {
    const flapAction =
      actions[birdDefinition.flapClipName] ??
      Object.entries(actions).find(([name]) => /fly|flap/i.test(name))?.[1] ??
      actions[Object.keys(actions)[0] ?? ""];
    if (!flapAction) {
      return;
    }
    flapAction.reset().play();
    // Vary the wingbeat rate a touch per bird and desync the phase.
    flapAction.timeScale = 0.85 + ((birdIndex * 0.37) % 1) * 0.5;
    flapAction.time = (birdIndex * 0.53) % Math.max(flapAction.getClip().duration, 0.001);
    return () => {
      flapAction.stop();
    };
  }, [actions, birdDefinition.flapClipName, birdIndex]);

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

    // Face the direction of travel and bank into it (no fake body-roll flap).
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
      {/* mixer root (unscaled) → scaled+centered model. Keeping scale off the
          mixer root avoids double-scaling the centerOffset. */}
      <group ref={modelRootRef}>
        <group scale={scale} position={[-centerOffset[0], -centerOffset[1], -centerOffset[2]]}>
          <primitive object={clonedScene} />
        </group>
      </group>
    </group>
  );
}

type SpecialBirdProps = {
  definition: SpecialBirdDefinition;
  worldSeed: string;
  treelineRadius: number;
};

/**
 * A rare, distinctive bird that arcs high across the whole scene on a long
 * loop with a wide off-screen gap between passes ("thi thoảng có 1 con bay
 * qua"). Same animated flapping model as the flock, scaled up with a vivid
 * emissive plumage.
 */
function SpecialBird({ definition, worldSeed, treelineRadius }: SpecialBirdProps) {
  const groupRef = useRef<Group>(null);
  const modelRootRef = useRef<Group>(null);
  const elapsedSecondsRef = useRef(0);
  const previousPosition = useRef(new Vector3());

  // Always the hawk (realistic flap) for the special crosser.
  const birdDefinition = BIRD_MODEL_DEFINITIONS[0];
  const gltf = useGLTF(natureModelUrl(birdDefinition));
  const clonedScene = useMemo(
    () => tintBirdScene(SkeletonUtils.clone(gltf.scene) as Group, definition.plumageColor, definition.emissiveIntensity),
    [definition.emissiveIntensity, definition.plumageColor, gltf.scene]
  );
  const { scale, centerOffset } = useMemo(
    () => normalizationForObject(gltf.scene, birdDefinition.targetHeight * definition.scale, "longestAxis"),
    [birdDefinition.targetHeight, definition.scale, gltf.scene]
  );

  const { actions } = useAnimations(gltf.animations, modelRootRef);
  useEffect(() => {
    const flapAction = actions[birdDefinition.flapClipName] ?? actions[Object.keys(actions)[0] ?? ""];
    if (!flapAction) {
      return;
    }
    flapAction.reset().play();
    flapAction.timeScale = 0.7; // slower, majestic wingbeat
    return () => {
      flapAction.stop();
    };
  }, [actions, birdDefinition.flapClipName]);

  const pathParameters = useMemo(() => {
    const nextRandomValue = randomFromSeed(worldSeed + "-forest-special-bird-path");
    return {
      altitude: 24 + nextRandomValue() * 8,
      directionRadians: nextRandomValue() * Math.PI * 2,
      lateralOffset: (nextRandomValue() - 0.5) * treelineRadius * 0.6,
      // Long loop: one pass, then a long empty sky before the next.
      loopSeconds: 26 + nextRandomValue() * 14,
      startPhase: nextRandomValue()
    };
  }, [treelineRadius, worldSeed]);

  useFrame((_, deltaTimeSeconds) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    // travelFraction runs 0..1 across the crossing, then the bird waits
    // off-screen (clamped past 1) until the loop restarts.
    const rawPhase = (elapsedSeconds / pathParameters.loopSeconds + pathParameters.startPhase) % 1;
    const crossFraction = Math.min(1, rawPhase / 0.45); // crossing takes 45% of the loop
    const spanRadius = treelineRadius * 1.8;
    const travel = (crossFraction * 2 - 1) * spanRadius;
    const directionX = Math.cos(pathParameters.directionRadians);
    const directionZ = Math.sin(pathParameters.directionRadians);
    const altitudeArc = Math.sin(crossFraction * Math.PI) * 4; // gentle rise-and-fall arc
    group.position.set(
      directionX * travel - directionZ * pathParameters.lateralOffset,
      pathParameters.altitude + altitudeArc,
      directionZ * travel + directionX * pathParameters.lateralOffset
    );
    // Hide it while it is "waiting" off-screen between passes.
    group.visible = rawPhase < 0.45;

    const movement = group.position.clone().sub(previousPosition.current);
    if (movement.lengthSq() > 0.000001) {
      group.rotation.y = Math.atan2(movement.x, movement.z);
      group.rotation.z = BIRD_BANK_ROLL_RADIANS * 0.5;
    }
    previousPosition.current.copy(group.position);
  });

  return (
    <group ref={groupRef}>
      <group ref={modelRootRef}>
        <group scale={scale} position={[-centerOffset[0], -centerOffset[1], -centerOffset[2]]}>
          <primitive object={clonedScene} />
        </group>
      </group>
    </group>
  );
}

/**
 * The living layer: ground animals wandering between seeded waypoints and
 * bird flocks circling or crossing overhead. Path seeds come from the config
 * (one stream per slot), so the same forest always moves the same way.
 */
export function ForestWildlife({
  wildlife,
  terrain,
  terrainHeightSampler,
  worldSeed,
  selectedPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: ForestWildlifeProps) {
  const clearingRadius = clearingRadiusFromTerrain(terrain);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const specialBird = useMemo(() => resolveSpecialBird(worldSeed), [worldSeed]);

  return (
    <group>
      {(wildlife?.groundAnimals ?? []).map((animalConfig, slotIndex) =>
        Array.from({ length: animalConfig.count ?? 1 }, (_, individualIndex) => {
          const displayName = ANIMAL_DISPLAY_NAMES[animalConfig.modelKey ?? ""] ?? "Animal";
          // Same PlanetSceneConfig adapter shape landmarks use, so the hover
          // tooltip and camera focus work without any new plumbing.
          const pointOfInterest: PlanetSceneConfig = {
            key: `${animalConfig.pathSeed ?? "forest-animal"}-poi-${individualIndex}`,
            name: displayName,
            meaning: `A ${displayName.toLowerCase()} wandering this forest.`
          };
          const identityKey = planetIdentityKey(pointOfInterest, individualIndex);
          return (
            <GroundAnimal
              key={`${animalConfig.modelKey ?? "animal"}-${slotIndex}-${individualIndex}`}
              animalConfig={animalConfig}
              individualIndex={individualIndex}
              clearingRadius={clearingRadius}
              treelineRadius={treelineRadius}
              terrainHeightSampler={terrainHeightSampler}
              pointOfInterest={pointOfInterest}
              isSelected={identityKey === selectedPlanetKey}
              onHoverPlanet={onHoverPlanet}
              onSelectPlanet={onSelectPlanet}
            />
          );
        })
      )}
      {(wildlife?.birdFlocks ?? []).map((flockConfig, flockIndex) =>
        Array.from({ length: flockConfig.birdCount ?? 3 }, (_, birdIndex) => (
          <Bird
            key={`flock-${flockIndex}-bird-${birdIndex}`}
            flockConfig={flockConfig}
            flockIndex={flockIndex}
            birdIndex={birdIndex}
            treelineRadius={treelineRadius}
          />
        ))
      )}
      {specialBird ? (
        <SpecialBird definition={specialBird} worldSeed={worldSeed} treelineRadius={treelineRadius} />
      ) : null}
    </group>
  );
}
