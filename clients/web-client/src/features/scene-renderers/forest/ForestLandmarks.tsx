"use client";

import { useEffect, useMemo } from "react";
import { AdditiveBlending, Color, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ForestLandmarkConfig, PlanetSceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { planetIdentityKey } from "@/features/scene-renderers/planetIdentity";
import { usePlanetPositionTracker } from "@/features/scene-renderers/shared/PlanetPositionTracker";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { mixHexColors, type TerrainHeightSampler } from "./forestMath";

// The clickable POI layer — one hero object per Nature DNA landmark, the
// forest's counterpart of planets. Hover feeds the canvas tooltip, click
// flies the camera (positions are registered in the shared tracker CameraRig
// reads from).

const LANDMARK_HIT_SPHERE_RADIUS = 2.0;
const SELECTION_RING_RADIUS = 1.5;
const SELECTION_RING_TUBE_RADIUS = 0.045;
const SELECTION_RING_HOVER_OPACITY = 0.35;
const SELECTION_RING_SELECTED_OPACITY = 0.95;
const LANDMARK_GLOW_SCALE = 4.5;
const LANDMARK_GLOW_OPACITY = 0.28;

const HEART_TREE_TRUNK_HEIGHT = 3.1;
const HEART_TREE_CANOPY_RADIUS = 1.9;
const STANDING_STONE_HEIGHT = 2.3;
const POND_RADIUS = 1.7;
const FALLEN_LOG_LENGTH = 2.7;
const FLOWER_PATCH_FLOWER_COUNT = 12;
const FLOWER_PATCH_RADIUS = 1.3;
const LANTERN_POST_HEIGHT = 1.5;

const FLOWER_SCATTER_SEED_SUFFIX = "-flowers";

type ForestLandmarkProps = {
  landmark: ForestLandmarkConfig;
  pointOfInterest: PlanetSceneConfig;
  landmarkIndex: number;
  terrainHeightSampler: TerrainHeightSampler;
  isSelected: boolean;
  isHovered: boolean;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

function LandmarkShape({ landmark }: { landmark: ForestLandmarkConfig }) {
  const accentColor = landmark.accentColor ?? "#06B6D4";
  const flowerPositions = useMemo(() => {
    if (landmark.kind !== "flowerPatch") {
      return [];
    }
    const nextRandomValue = randomFromSeed(`${landmark.key ?? "landmark"}${FLOWER_SCATTER_SEED_SUFFIX}`);
    return Array.from({ length: FLOWER_PATCH_FLOWER_COUNT }, () => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = Math.sqrt(nextRandomValue()) * FLOWER_PATCH_RADIUS;
      const stemHeight = 0.25 + nextRandomValue() * 0.3;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, stemHeight };
    });
  }, [landmark.key, landmark.kind]);

  switch (landmark.kind) {
    case "standingStone":
      return (
        <group>
          <mesh position={[0, STANDING_STONE_HEIGHT / 2, 0]} rotation={[0, 0.4, 0.04]} castShadow>
            <boxGeometry args={[0.9, STANDING_STONE_HEIGHT, 0.55]} />
            <meshStandardMaterial color="#8D9289" flatShading roughness={0.9} />
          </mesh>
          {/* Carved rune strip that carries the accent color. */}
          <mesh position={[0, STANDING_STONE_HEIGHT * 0.55, 0.29]} rotation={[0, 0.4, 0]}>
            <boxGeometry args={[0.16, STANDING_STONE_HEIGHT * 0.6, 0.03]} />
            <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.9} />
          </mesh>
        </group>
      );
    case "pond":
      return (
        <group>
          <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[POND_RADIUS, 28]} />
            <meshStandardMaterial
              color={mixHexColors("#2E6E8E", accentColor, 0.25)}
              metalness={0.85}
              roughness={0.12}
            />
          </mesh>
          {/* Stone rim + lily pads. */}
          <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[POND_RADIUS, POND_RADIUS + 0.22, 28]} />
            <meshStandardMaterial color="#7D8577" flatShading roughness={1} />
          </mesh>
          <mesh position={[POND_RADIUS * 0.4, 0.06, POND_RADIUS * 0.25]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.22, 8]} />
            <meshStandardMaterial color="#4F8A3D" flatShading roughness={0.8} />
          </mesh>
          <mesh position={[-POND_RADIUS * 0.35, 0.06, -POND_RADIUS * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.16, 8]} />
            <meshStandardMaterial color="#4F8A3D" flatShading roughness={0.8} />
          </mesh>
        </group>
      );
    case "flowerPatch":
      return (
        <group>
          {flowerPositions.map((flower, flowerIndex) => (
            <group key={flowerIndex} position={[flower.x, 0, flower.z]}>
              <mesh position={[0, flower.stemHeight / 2, 0]}>
                <cylinderGeometry args={[0.015, 0.02, flower.stemHeight, 4]} />
                <meshStandardMaterial color="#4F8A3D" flatShading roughness={0.9} />
              </mesh>
              <mesh position={[0, flower.stemHeight + 0.05, 0]}>
                <sphereGeometry args={[0.075, 6, 5]} />
                <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.45} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case "fallenLog":
      return (
        <group>
          <mesh position={[0, 0.34, 0]} rotation={[0, 0.5, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.32, 0.38, FALLEN_LOG_LENGTH, 8]} />
            <meshStandardMaterial color="#6B5744" flatShading roughness={1} />
          </mesh>
          {/* Moss blanket with the accent hue folded in. */}
          <mesh position={[0, 0.62, 0]} rotation={[0, 0.5, 0]}>
            <boxGeometry args={[FALLEN_LOG_LENGTH * 0.7, 0.08, 0.4]} />
            <meshStandardMaterial color={mixHexColors("#5B7A4A", accentColor, 0.2)} flatShading roughness={0.9} />
          </mesh>
        </group>
      );
    case "lanternShrine":
      return (
        <group>
          <mesh position={[0, LANTERN_POST_HEIGHT / 2, 0]} castShadow>
            <boxGeometry args={[0.16, LANTERN_POST_HEIGHT, 0.16]} />
            <meshStandardMaterial color="#4A3B2C" flatShading roughness={0.95} />
          </mesh>
          <mesh position={[0, LANTERN_POST_HEIGHT + 0.22, 0]} castShadow>
            <boxGeometry args={[0.4, 0.44, 0.4]} />
            <meshStandardMaterial
              color={accentColor}
              emissive={accentColor}
              emissiveIntensity={1.3}
              transparent
              opacity={0.92}
            />
          </mesh>
          <mesh position={[0, LANTERN_POST_HEIGHT + 0.5, 0]}>
            <coneGeometry args={[0.34, 0.2, 4]} />
            <meshStandardMaterial color="#4A3B2C" flatShading roughness={0.95} />
          </mesh>
          <pointLight
            position={[0, LANTERN_POST_HEIGHT + 0.22, 0]}
            color={accentColor}
            intensity={2.6}
            distance={9}
            decay={2}
          />
        </group>
      );
    case "heartTree":
    default:
      return (
        <group>
          <mesh position={[0, HEART_TREE_TRUNK_HEIGHT / 2, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.42, HEART_TREE_TRUNK_HEIGHT, 7]} />
            <meshStandardMaterial color="#6E5138" flatShading roughness={0.95} />
          </mesh>
          <mesh position={[0, HEART_TREE_TRUNK_HEIGHT + HEART_TREE_CANOPY_RADIUS * 0.55, 0]} castShadow>
            <icosahedronGeometry args={[HEART_TREE_CANOPY_RADIUS, 1]} />
            <meshStandardMaterial
              color={mixHexColors("#4F8A3D", accentColor, 0.45)}
              emissive={accentColor}
              emissiveIntensity={0.3}
              flatShading
              roughness={0.85}
            />
          </mesh>
          <mesh position={[HEART_TREE_CANOPY_RADIUS * 0.5, HEART_TREE_TRUNK_HEIGHT + HEART_TREE_CANOPY_RADIUS * 1.25, 0]} castShadow>
            <icosahedronGeometry args={[HEART_TREE_CANOPY_RADIUS * 0.6, 1]} />
            <meshStandardMaterial
              color={mixHexColors("#4F8A3D", accentColor, 0.55)}
              emissive={accentColor}
              emissiveIntensity={0.35}
              flatShading
              roughness={0.85}
            />
          </mesh>
        </group>
      );
  }
}

function ForestLandmark({
  landmark,
  pointOfInterest,
  landmarkIndex,
  terrainHeightSampler,
  isSelected,
  isHovered,
  onHoverPlanet,
  onSelectPlanet
}: ForestLandmarkProps) {
  const planetPositionTracker = usePlanetPositionTracker();
  const accentColor = landmark.accentColor ?? "#06B6D4";

  const landmarkPosition = useMemo(() => {
    const angle = landmark.angleRadians ?? 0;
    const radius = landmark.radiusFromCenter ?? 6;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    return new Vector3(x, terrainHeightSampler(x, z), z);
  }, [landmark.angleRadians, landmark.radiusFromCenter, terrainHeightSampler]);

  // Landmarks are static: register the camera-focus position once (the same
  // Map CameraRig lerps toward for planets).
  const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
  useEffect(() => {
    // Aim the camera slightly above the base so the framing shows the object,
    // not its roots.
    planetPositionTracker.set(identityKey, landmarkPosition.clone().add(new Vector3(0, 1.4, 0)));
    return () => {
      planetPositionTracker.delete(identityKey);
    };
  }, [identityKey, landmarkPosition, planetPositionTracker]);

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
      <LandmarkShape landmark={landmark} />
      {/* Soft accent glow anchors the landmark in the scene at a distance. */}
      {softCircleTexture ? (
        <sprite position={[0, 1.1, 0]} scale={[LANDMARK_GLOW_SCALE, LANDMARK_GLOW_SCALE, 1]}>
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
      {/* Ground ring: faint on hover, solid when selected. */}
      {isHovered || isSelected ? (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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
        position={[0, 1.1, 0]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[LANDMARK_HIT_SPHERE_RADIUS, 8, 6]} />
      </mesh>
    </group>
  );
}

type ForestLandmarksProps = {
  landmarks?: ForestLandmarkConfig[];
  pointsOfInterest: PlanetSceneConfig[];
  terrainHeightSampler: TerrainHeightSampler;
  selectedPlanetKey: string | null;
  hoveredPlanetKey: string | null;
  onHoverPlanet: (pointOfInterest: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (pointOfInterest: PlanetSceneConfig | null) => void;
};

export function ForestLandmarks({
  landmarks,
  pointsOfInterest,
  terrainHeightSampler,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: ForestLandmarksProps) {
  return (
    <group>
      {(landmarks ?? []).map((landmark, landmarkIndex) => {
        const pointOfInterest = pointsOfInterest[landmarkIndex];
        if (!pointOfInterest) {
          return null;
        }
        const identityKey = planetIdentityKey(pointOfInterest, landmarkIndex);
        return (
          <ForestLandmark
            key={identityKey}
            landmark={landmark}
            pointOfInterest={pointOfInterest}
            landmarkIndex={landmarkIndex}
            terrainHeightSampler={terrainHeightSampler}
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
