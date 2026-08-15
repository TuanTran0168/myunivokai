"use client";

import { useEffect, useMemo } from "react";
import { AdditiveBlending, Color, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { OceanLandmarkConfig, OceanWaterConfig, PlanetSceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { rarityFeature } from "@/lib/rarity";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { usePlanetPositionTracker } from "@/features/scene-renderers/shared/PlanetPositionTracker";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { mixHexColors, type SeafloorHeightSampler } from "./oceanMath";
import { LANDMARK_BASE_COLORS, landmarkGeometryForKind } from "./oceanModels";

// The clickable POI layer — one hero object per Ocean DNA landmark, the ocean's
// counterpart of planets and forest landmarks. Hover feeds the canvas tooltip;
// click flies the camera, because positions are registered in the same shared
// tracker CameraRig already reads. That is the whole reason this family needed
// no change to CameraRig or PlanetPositionTracker.

const LANDMARK_HIT_SPHERE_RADIUS = 2.6;
const SELECTION_RING_RADIUS = 2.0;
const SELECTION_RING_TUBE_RADIUS = 0.055;
const SELECTION_RING_HOVER_OPACITY = 0.35;
const SELECTION_RING_SELECTED_OPACITY = 0.95;
const LANDMARK_GLOW_SCALE = 5.5;
const LANDMARK_GLOW_OPACITY = 0.3;
const CAMERA_FOCUS_LIFT = 2.0;

// The vent's plume and the relic's glow are what make those two landmarks read
// at a distance in water that swallows detail.
const VENT_PLUME_HEIGHT = 6.5;

type OceanLandmarksProps = {
  landmarks?: OceanLandmarkConfig[];
  pointsOfInterest: PlanetSceneConfig[];
  water?: OceanWaterConfig;
  heightSampler: SeafloorHeightSampler;
  selectedPlanetKey: string | null;
  hoveredPlanetKey: string | null;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
  /** The variant seed — the sunken-relic lottery hangs off it. */
  worldSeed: string;
};

export function OceanLandmarks({
  landmarks,
  pointsOfInterest,
  water,
  heightSampler,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet,
  worldSeed
}: OceanLandmarksProps) {
  // The sunken-relic lottery: when it hits, one landmark that would otherwise
  // be an ordinary kind becomes a relic. Re-derived from the seed rather than
  // stored, like every rare feature in this platform.
  const relicIndex = useMemo(() => {
    const feature = rarityFeature("ocean-sunken-relic");
    const nextRandomValue = randomFromSeed(worldSeed + feature.seedSuffix);
    if (nextRandomValue() >= feature.probability) {
      return -1;
    }
    const count = landmarks?.length ?? 0;
    if (count < 2) {
      return -1;
    }
    // Never the hero: the first landmark is always the kelp cathedral.
    return 1 + Math.floor(nextRandomValue() * (count - 1));
  }, [landmarks?.length, worldSeed]);

  return (
    <group>
      {(landmarks ?? []).map((landmark, landmarkIndex) => {
        const pointOfInterest = pointsOfInterest[landmarkIndex];
        if (!pointOfInterest) {
          return null;
        }
        const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
        return (
          <OceanLandmark
            key={identityKey}
            landmark={landmark}
            pointOfInterest={pointOfInterest}
            landmarkIndex={landmarkIndex}
            water={water}
            heightSampler={heightSampler}
            forceRelic={landmarkIndex === relicIndex}
            isSelected={identityKey === selectedPlanetKey}
            isHovered={identityKey === hoveredPlanetKey}
            onHoverPlanet={onHoverPlanet}
            onSelectPlanet={onSelectPlanet}
          />
        );
      })}
    </group>
  );
}

type OceanLandmarkProps = {
  landmark: OceanLandmarkConfig;
  pointOfInterest: PlanetSceneConfig;
  landmarkIndex: number;
  water?: OceanWaterConfig;
  heightSampler: SeafloorHeightSampler;
  forceRelic: boolean;
  isSelected: boolean;
  isHovered: boolean;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

function OceanLandmark({
  landmark,
  pointOfInterest,
  landmarkIndex,
  water,
  heightSampler,
  forceRelic,
  isSelected,
  isHovered,
  onHoverPlanet,
  onSelectPlanet
}: OceanLandmarkProps) {
  const planetPositionTracker = usePlanetPositionTracker();
  const accentColor = landmark.accentColor ?? "#06B6D4";
  const kind = forceRelic ? "sunkenRelic" : landmark.kind ?? "kelpCathedral";
  const fogColor = water?.fogColor ?? "#0A3B4E";
  const tintStrength = water?.tintStrength ?? 0.4;

  const landmarkPosition = useMemo(() => {
    const angle = landmark.angleRadians ?? 0;
    const radius = landmark.radiusFromCenter ?? 10;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // heightAboveFloor is the one field the forest has no use for: an ocean is
    // a volume, so a landmark can sit on the floor or hang in the water column.
    return new Vector3(x, heightSampler(x, z) + (landmark.heightAboveFloor ?? 0), z);
  }, [landmark.angleRadians, landmark.heightAboveFloor, landmark.radiusFromCenter, heightSampler]);

  const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
  useEffect(() => {
    planetPositionTracker.set(identityKey, landmarkPosition.clone().add(new Vector3(0, CAMERA_FOCUS_LIFT, 0)));
    return () => {
      planetPositionTracker.delete(identityKey);
    };
  }, [identityKey, landmarkPosition, planetPositionTracker]);

  const geometry = useMemo(() => landmarkGeometryForKind(kind), [kind]);
  const bodyColor = useMemo(
    () => mixHexColors(LANDMARK_BASE_COLORS[kind] ?? "#5A7F86", fogColor, tintStrength),
    [fogColor, kind, tintStrength]
  );
  const softCircleTexture = getSoftCircleTexture();
  const glowColor = useMemo(() => new Color(accentColor), [accentColor]);

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

  return (
    <group position={landmarkPosition}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.78}
          metalness={0.08}
          // The landmark carries the visitor's own accent colour as a faint
          // emissive, which is what keeps it findable in water that swallows
          // everything else — and what makes it theirs.
          emissive={accentColor}
          emissiveIntensity={isSelected || isHovered ? 0.45 : 0.16}
        />
      </mesh>

      {/* A hydrothermal vent without its plume is a rock. */}
      {kind === "hydrothermalVent" ? (
        <mesh position={[0, VENT_PLUME_HEIGHT / 2 + 3, 0]}>
          <coneGeometry args={[1.3, VENT_PLUME_HEIGHT, 10, 1, true]} />
          <meshBasicMaterial color="#1A1714" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ) : null}

      {/* A whale fall runs an ecosystem for decades: the bacterial mat is the
          reason it is a landmark rather than a bone pile. */}
      {kind === "whaleFall" ? (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[4.2, 24]} />
          <meshBasicMaterial color="#E8F0C8" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      ) : null}

      {softCircleTexture ? (
        <sprite position={[0, 1.6, 0]} scale={[LANDMARK_GLOW_SCALE, LANDMARK_GLOW_SCALE, 1]}>
          <spriteMaterial
            map={softCircleTexture}
            color={glowColor}
            transparent
            opacity={isHovered || isSelected ? LANDMARK_GLOW_OPACITY * 1.8 : LANDMARK_GLOW_OPACITY}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ) : null}

      {isHovered || isSelected ? (
        <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[SELECTION_RING_RADIUS, SELECTION_RING_TUBE_RADIUS, 8, 40]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={isSelected ? SELECTION_RING_SELECTED_OPACITY : SELECTION_RING_HOVER_OPACITY}
          />
        </mesh>
      ) : null}

      {/* Invisible hit sphere: a forgiving click target around every shape. */}
      <mesh
        visible={false}
        position={[0, 1.6, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[LANDMARK_HIT_SPHERE_RADIUS, 8, 6]} />
      </mesh>
    </group>
  );
}
