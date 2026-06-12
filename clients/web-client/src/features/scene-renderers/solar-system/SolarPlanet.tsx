"use client";

import { Html } from "@react-three/drei";
import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, DoubleSide, TextureLoader, Vector3 } from "three";
import type { Group, Mesh } from "three";
import type { PlanetSceneConfig } from "@/lib/types";
import { usePlanetPositionTracker } from "../shared/PlanetPositionTracker";
import { planetTextureEntryForIndex } from "./planetTextureCatalog";

const DEFAULT_PLANET_SIZE = 0.6;
const PLANET_SIZE_MULTIPLIER = 0.78;
const DEFAULT_PLANET_ORBIT_SPEED = 0.12;
const FIRST_PLANET_ORBIT_RADIUS = 3.2;
const ORBIT_RADIUS_STEP_PER_PLANET = 1.05;
const PLANET_SELF_ROTATION_SPEED = 0.3;
const HIGHLIGHT_GLOW_SCALE_MULTIPLIER = 1.35;
const HIGHLIGHT_GLOW_OPACITY = 0.4;
const RING_INNER_RADIUS_MULTIPLIER = 1.35;
const RING_OUTER_RADIUS_MULTIPLIER = 2.2;
const RING_OPACITY = 0.85;
const PLANET_LABEL_VERTICAL_OFFSET = 0.55;
const PLANET_LABEL_DISTANCE_FACTOR = 9;
const DEFAULT_HIGHLIGHT_COLOR = "#8B5CF6";

export function defaultPhaseForPlanet(planetIndex: number, planetCount: number): number {
  if (planetCount <= 0) {
    return 0;
  }
  return (planetIndex / planetCount) * Math.PI * 2;
}

export function orbitRadiusForPlanet(planet: PlanetSceneConfig, planetIndex: number): number {
  return planet.orbitRadius ?? FIRST_PLANET_ORBIT_RADIUS + planetIndex * ORBIT_RADIUS_STEP_PER_PLANET;
}

export function renderedPlanetSize(planet: PlanetSceneConfig): number {
  return (planet.size ?? DEFAULT_PLANET_SIZE) * PLANET_SIZE_MULTIPLIER;
}

type SolarPlanetProps = {
  planet: PlanetSceneConfig;
  planetIndex: number;
  planetCount: number;
  identityKey: string;
  isSelected: boolean;
  isHovered: boolean;
  showLabel: boolean;
  onHoverChange: (planet: PlanetSceneConfig | null) => void;
  onSelect?: (planet: PlanetSceneConfig | null) => void;
};

/**
 * One personality planet rendered with a real solar-system surface texture.
 * Orbits the sun in its (possibly inclined) parent group, spins on a tilted
 * axis, and reports its world position so the CameraRig can fly to it.
 */
export function SolarPlanet({
  planet,
  planetIndex,
  planetCount,
  identityKey,
  isSelected,
  isHovered,
  showLabel,
  onHoverChange,
  onSelect
}: SolarPlanetProps) {
  const orbitAnchorReference = useRef<Group>(null);
  const planetMeshReference = useRef<Mesh>(null);
  const planetPositionTracker = usePlanetPositionTracker();
  const trackedWorldPosition = useMemo(() => new Vector3(), []);

  const textureEntry = planetTextureEntryForIndex(planetIndex);
  const surfaceTexture = useLoader(TextureLoader, textureEntry.textureUrl);
  const ringTexture = useLoader(
    TextureLoader,
    textureEntry.ringTextureUrl ?? textureEntry.textureUrl
  );

  const orbitRadius = orbitRadiusForPlanet(planet, planetIndex);
  const orbitSpeed = planet.orbitSpeed ?? DEFAULT_PLANET_ORBIT_SPEED;
  const orbitPhase = planet.phase ?? defaultPhaseForPlanet(planetIndex, planetCount);
  const planetSize = renderedPlanetSize(planet);
  const highlightColor = planet.color ?? DEFAULT_HIGHLIGHT_COLOR;
  const isHighlighted = isHovered || isSelected;
  const hasRing = Boolean(textureEntry.ringTextureUrl);

  useEffect(() => {
    planetPositionTracker.set(identityKey, trackedWorldPosition);
    return () => {
      planetPositionTracker.delete(identityKey);
    };
  }, [identityKey, planetPositionTracker, trackedWorldPosition]);

  useFrame(({ clock }, deltaTimeSeconds) => {
    const orbitAnchor = orbitAnchorReference.current;
    if (!orbitAnchor) {
      return;
    }
    const orbitAngle = orbitPhase + clock.elapsedTime * orbitSpeed;
    orbitAnchor.position.set(Math.cos(orbitAngle) * orbitRadius, 0, Math.sin(orbitAngle) * orbitRadius);
    orbitAnchor.getWorldPosition(trackedWorldPosition);

    if (planetMeshReference.current) {
      planetMeshReference.current.rotation.y += PLANET_SELF_ROTATION_SPEED * deltaTimeSeconds;
    }
  });

  return (
    <group ref={orbitAnchorReference}>
      <group rotation={[0, 0, textureEntry.axialTiltRadians]}>
        <mesh
          ref={planetMeshReference}
          onPointerOver={(event) => {
            event.stopPropagation();
            onHoverChange(planet);
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            onHoverChange(null);
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(planet);
          }}
        >
          <sphereGeometry args={[planetSize, 40, 28]} />
          <meshStandardMaterial map={surfaceTexture} roughness={0.92} metalness={0} />
        </mesh>
        {hasRing ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry
              args={[planetSize * RING_INNER_RADIUS_MULTIPLIER, planetSize * RING_OUTER_RADIUS_MULTIPLIER, 96]}
            />
            <meshBasicMaterial map={ringTexture} transparent opacity={RING_OPACITY} side={DoubleSide} />
          </mesh>
        ) : null}
      </group>
      {isHighlighted ? (
        <mesh scale={planetSize * HIGHLIGHT_GLOW_SCALE_MULTIPLIER}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial
            color={highlightColor}
            transparent
            opacity={HIGHLIGHT_GLOW_OPACITY}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {showLabel ? (
        <Html
          center
          position={[0, planetSize + PLANET_LABEL_VERTICAL_OFFSET, 0]}
          distanceFactor={PLANET_LABEL_DISTANCE_FACTOR}
          className="pointer-events-none select-none"
        >
          <span
            className={`whitespace-nowrap font-mono text-[11px] uppercase tracking-widest ${
              isHighlighted ? "text-white" : "text-white/65"
            }`}
          >
            {planet.name ?? identityKey}
          </span>
        </Html>
      ) : null}
    </group>
  );
}
