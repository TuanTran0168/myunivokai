"use client";

import { useMemo } from "react";
import { randomFromSeed } from "@/lib/scene";
import { planetsFromScene, paletteFromScene } from "@/lib/scene";
import { planetIdentityKey } from "../planetIdentity";
import type { SceneRendererProps } from "../types";
import { StarParticleField } from "../shared/StarParticleField";
import { OrbitPath } from "./OrbitPath";
import { Skybox } from "./Skybox";
import { SolarPlanet, orbitRadiusForPlanet } from "./SolarPlanet";
import { Sun } from "./Sun";

const AMBIENT_LIGHT_INTENSITY = 0.18;
const MAXIMUM_ORBIT_INCLINATION_RADIANS = 0.14;

function buildOrbitInclinations(seed: string, planetCount: number): number[] {
  const random = randomFromSeed(`${seed}-orbit-inclinations`);
  return Array.from(
    { length: planetCount },
    () => (random() * 2 - 1) * MAXIMUM_ORBIT_INCLINATION_RADIANS
  );
}

/**
 * Solar-system style scene: a glowing textured sun in the center, personality
 * planets with real planetary surface textures on slightly inclined orbits, a
 * milky-way skybox and a seeded star particle field.
 */
export function SolarSystemRenderer({
  scene,
  seed,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: SceneRendererProps) {
  const palette = paletteFromScene(scene);
  const planets = planetsFromScene(scene);
  const showPlanetLabels = scene.hud?.showLabels !== false;

  const orbitInclinations = useMemo(
    () => buildOrbitInclinations(seed, planets.length),
    [seed, planets.length]
  );

  return (
    <>
      <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
      <Skybox />
      <StarParticleField scene={scene} seed={seed} fallbackColor={palette[1]} />
      <Sun coreConfig={scene.core} />
      {planets.map((planet, planetIndex) => {
        const identityKey = planetIdentityKey(planet, planetIndex);
        const isSelected = identityKey === selectedPlanetKey;
        const isHovered = identityKey === hoveredPlanetKey;
        const orbitInclination = orbitInclinations[planetIndex] ?? 0;
        return (
          <group key={identityKey} rotation={[orbitInclination, 0, orbitInclination * 0.6]}>
            <OrbitPath
              radius={orbitRadiusForPlanet(planet, planetIndex)}
              color={planet.color ?? palette[planetIndex % palette.length]}
              isHighlighted={isSelected || isHovered}
            />
            <SolarPlanet
              planet={planet}
              planetIndex={planetIndex}
              planetCount={planets.length}
              identityKey={identityKey}
              isSelected={isSelected}
              isHovered={isHovered}
              showLabel={showPlanetLabels}
              onHoverChange={onHoverPlanet}
              onSelect={onSelectPlanet}
            />
          </group>
        );
      })}
    </>
  );
}
