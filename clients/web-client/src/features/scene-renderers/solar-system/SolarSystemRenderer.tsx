"use client";

import { useMemo } from "react";
import { randomFromSeed } from "@/lib/scene";
import { planetsFromScene, paletteFromScene } from "@/lib/scene";
import { planetIdentityKey } from "../planetIdentity";
import type { SceneRendererProps } from "../types";
import { StarParticleField } from "../shared/StarParticleField";
import { ConstellationField } from "./ConstellationField";
import { MilkyWayBand } from "./MilkyWayBand";
import { OrbitPath } from "./OrbitPath";
import { Skybox } from "./Skybox";
import { SolarPlanet, orbitRadiusForPlanet } from "./SolarPlanet";
import { Sun } from "./Sun";

const AMBIENT_LIGHT_INTENSITY = 0.18;
// Headroom for orbital tilt. Kept high so the world-style contrast below is
// clearly visible (a steeply scattered nebula vs flat, precise cyber rings),
// not a few near-identical degrees.
const MAXIMUM_ORBIT_INCLINATION_RADIANS = 0.42;

// The world style gives each scene a distinct orbital character: flat ordered
// rings vs steeply scattered, tilted orbits. This applies to both the live
// preview and the generated world (both carry theme = the chosen style), so the
// style choice is visible without overriding the user's color palette. The
// spread is deliberately wide so switching styles is obvious at a glance.
const THEME_ORBIT_INCLINATION_MULTIPLIERS: Record<string, number> = {
  "cosmic-galaxy": 0.8, // gentle galactic tilt
  nebula: 2, // chaotic, steeply scattered planes
  crystal: 0.12, // near-flat, ordered lattice
  aurora: 1.3, // flowing, clearly tilted
  "cyber-orbit": 0.05 // flat, precise concentric rings
};
const DEFAULT_ORBIT_INCLINATION_MULTIPLIER = 0.8;

function orbitInclinationMultiplierForTheme(theme?: string): number {
  if (theme && theme in THEME_ORBIT_INCLINATION_MULTIPLIERS) {
    return THEME_ORBIT_INCLINATION_MULTIPLIERS[theme];
  }
  return DEFAULT_ORBIT_INCLINATION_MULTIPLIER;
}

function buildOrbitInclinations(seed: string, planetCount: number, inclinationMultiplier: number): number[] {
  const random = randomFromSeed(`${seed}-orbit-inclinations`);
  return Array.from(
    { length: planetCount },
    () => (random() * 2 - 1) * MAXIMUM_ORBIT_INCLINATION_RADIANS * inclinationMultiplier
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

  const orbitInclinationMultiplier = orbitInclinationMultiplierForTheme(scene.theme);
  const orbitInclinations = useMemo(
    () => buildOrbitInclinations(seed, planets.length, orbitInclinationMultiplier),
    [seed, planets.length, orbitInclinationMultiplier]
  );

  return (
    <>
      <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
      <Skybox />
      <MilkyWayBand sky={scene.sky?.milkyWay} />
      <ConstellationField seed={seed} scene={scene} />
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
