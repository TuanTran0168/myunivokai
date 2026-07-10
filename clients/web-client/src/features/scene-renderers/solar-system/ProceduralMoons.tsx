"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry } from "three";
import type { Group } from "three";
import { createSeededNoise3d, fractalNoise3d } from "../shared/seededNoise3d";
import { buildMoonSystemRecipe, type MoonRecipe } from "./moonRecipe";

/**
 * Seeded moons for one planet. Each moon is an icosphere displaced by fBm
 * bumpiness plus explicit crater dents (bowl + raised rim), so the silhouette
 * reads as cratered rock even at small sizes. Moons live inside the planet's
 * axial-tilt group: they orbit the equatorial plane and roll with the planet
 * (Uranus-style), and because each mesh is a child of its rotating anchor the
 * same face always points at the planet — tidal locking for free.
 *
 * Moons are scenery, not DNA objects: no PlanetPositionTracker entry, no
 * label, raycasting off.
 */

const MOON_ICOSPHERE_DETAIL = 3;
const MOON_SURFACE_NOISE_FREQUENCY = 2.6;
const MOON_SURFACE_NOISE_OCTAVE_COUNT = 4;
const MOON_SURFACE_ROUGHNESS = 1;

// Crater relief profile, in units of the crater's angular radius: a bowl
// deepest at the center, a raised rim peaking right at the edge, fading back
// to the sphere just outside it.
const CRATER_BOWL_END_FRACTION = 0.9;
const CRATER_RIM_START_FRACTION = 0.7;
const CRATER_RIM_PEAK_FRACTION = 1;
const CRATER_RIM_FADE_END_FRACTION = 1.25;
const CRATER_RIM_HEIGHT_RATIO = 0.35;

// When the parent planet wears a ring (photo or procedural; ring outer edges
// sit at ~2.2-2.3x planet size), the whole moon system shifts outward so no
// moon plows through the ring plane.
const RINGED_PLANET_ORBIT_RADIUS_RATIO_OFFSET = 0.8;

function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const normalized = Math.min(1, Math.max(0, (value - edgeStart) / (edgeEnd - edgeStart)));
  return normalized * normalized * (3 - 2 * normalized);
}

function buildMoonGeometry(moonRecipe: MoonRecipe, moonRadius: number): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(moonRadius, MOON_ICOSPHERE_DETAIL);
  const noise = createSeededNoise3d(moonRecipe.surfaceNoiseSeed);
  const positionAttribute = geometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const unitX = positionAttribute.getX(vertexIndex) / moonRadius;
    const unitY = positionAttribute.getY(vertexIndex) / moonRadius;
    const unitZ = positionAttribute.getZ(vertexIndex) / moonRadius;

    let displacement =
      1 +
      moonRecipe.displacementAmplitude *
        fractalNoise3d(
          noise,
          unitX * MOON_SURFACE_NOISE_FREQUENCY,
          unitY * MOON_SURFACE_NOISE_FREQUENCY,
          unitZ * MOON_SURFACE_NOISE_FREQUENCY,
          MOON_SURFACE_NOISE_OCTAVE_COUNT
        );

    for (const crater of moonRecipe.craters) {
      const alignmentWithCraterCenter = Math.min(
        1,
        Math.max(-1, unitX * crater.directionX + unitY * crater.directionY + unitZ * crater.directionZ)
      );
      const angleFromCraterCenter = Math.acos(alignmentWithCraterCenter);
      const craterFraction = angleFromCraterCenter / crater.angularRadiusRadians;
      if (craterFraction >= CRATER_RIM_FADE_END_FRACTION) {
        continue;
      }
      const bowlDepth = crater.depthFraction * (1 - smoothstep(0, CRATER_BOWL_END_FRACTION, craterFraction));
      const rimHeight =
        crater.depthFraction *
        CRATER_RIM_HEIGHT_RATIO *
        smoothstep(CRATER_RIM_START_FRACTION, CRATER_RIM_PEAK_FRACTION, craterFraction) *
        (1 - smoothstep(CRATER_RIM_PEAK_FRACTION, CRATER_RIM_FADE_END_FRACTION, craterFraction));
      displacement += rimHeight - bowlDepth;
    }

    positionAttribute.setXYZ(
      vertexIndex,
      unitX * moonRadius * displacement,
      unitY * moonRadius * displacement,
      unitZ * moonRadius * displacement
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

type ProceduralMoonsProps = {
  moonSystemSeed: string;
  planetRenderedSize: number;
  parentPlanetHasRing: boolean;
};

export function ProceduralMoons({ moonSystemSeed, planetRenderedSize, parentPlanetHasRing }: ProceduralMoonsProps) {
  const moonSystemRecipe = useMemo(() => buildMoonSystemRecipe(moonSystemSeed), [moonSystemSeed]);
  const moonGeometries = useMemo(
    () => moonSystemRecipe.moons.map((moon) => buildMoonGeometry(moon, moon.sizeRatio * planetRenderedSize)),
    [moonSystemRecipe, planetRenderedSize]
  );
  useEffect(() => {
    // Geometry passed as a prop (not JSX-created) is not auto-disposed by R3F.
    return () => {
      for (const geometry of moonGeometries) {
        geometry.dispose();
      }
    };
  }, [moonGeometries]);

  const moonAnchorReferences = useRef<(Group | null)[]>([]);

  useFrame(({ clock }) => {
    for (let moonIndex = 0; moonIndex < moonSystemRecipe.moons.length; moonIndex += 1) {
      const moonAnchor = moonAnchorReferences.current[moonIndex];
      if (!moonAnchor) {
        continue;
      }
      const moon = moonSystemRecipe.moons[moonIndex];
      moonAnchor.rotation.y = moon.orbitPhaseRadians + clock.elapsedTime * moon.orbitSpeedRadiansPerSecond;
    }
  });

  if (moonSystemRecipe.moons.length === 0) {
    return null;
  }

  return (
    <>
      {moonSystemRecipe.moons.map((moon, moonIndex) => {
        const orbitRadius =
          (moon.orbitRadiusRatio + (parentPlanetHasRing ? RINGED_PLANET_ORBIT_RADIUS_RATIO_OFFSET : 0)) *
          planetRenderedSize;
        return (
          <group key={moon.surfaceNoiseSeed} rotation={[moon.orbitInclinationRadians, 0, 0]}>
            <group
              ref={(anchor) => {
                moonAnchorReferences.current[moonIndex] = anchor;
              }}
            >
              <mesh position={[orbitRadius, 0, 0]} geometry={moonGeometries[moonIndex]} raycast={() => null}>
                <meshStandardMaterial color={moon.surfaceColorHex} roughness={MOON_SURFACE_ROUGHNESS} metalness={0} />
              </mesh>
            </group>
          </group>
        );
      })}
    </>
  );
}
