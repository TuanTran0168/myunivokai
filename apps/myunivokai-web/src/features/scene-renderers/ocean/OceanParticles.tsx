"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points } from "three";
import type { OceanBioluminescenceConfig, OceanCurrentConfig, OceanWaterConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { rarityFeature } from "@/lib/rarity";

// The two particle layers that give the water body.
//
// Marine snow falls at every depth — unlike the forest's four mutually
// exclusive seasonal systems, there is always something drifting down through
// seawater, and its absence is what makes CG water look like air.
//
// Bioluminescent plankton rises as sunlight falls, and in the abyss it is most
// of the light there is.

const MARINE_SNOW_COLUMN_HEIGHT = 26;
const MARINE_SNOW_FALL_SPEED = 0.35;
const MARINE_SNOW_SIZE = 0.055;
const PLANKTON_COLUMN_HEIGHT = 22;
const PLANKTON_SIZE = 0.13;
const PLANKTON_FLICKER_SPEED = 1.4;

type OceanParticlesProps = {
  bioluminescence?: OceanBioluminescenceConfig;
  current?: OceanCurrentConfig;
  water?: OceanWaterConfig;
  basinRadius: number;
  isMobile: boolean;
  /** The variant seed — the bioluminescent-bloom lottery hangs off it. */
  worldSeed: string;
};

export function OceanParticles({
  bioluminescence,
  current,
  water,
  basinRadius,
  isMobile,
  worldSeed
}: OceanParticlesProps) {
  const marineSnowCount = isMobile
    ? current?.marineSnowCountMobile ?? 300
    : current?.marineSnowCountDesktop ?? 1000;

  // The bloom is a rare feature: when it hits, the plankton count and the glow
  // both rise sharply. It is re-derived from the seed on every render rather
  // than stored, like every other rare feature in this platform.
  const bloomMultiplier = useMemo(() => {
    const feature = rarityFeature("ocean-bioluminescent-bloom");
    const nextRandomValue = randomFromSeed(worldSeed + feature.seedSuffix);
    return nextRandomValue() < feature.probability ? 2.4 : 1;
  }, [worldSeed]);

  return (
    <group>
      <MarineSnow
        count={marineSnowCount}
        basinRadius={basinRadius}
        seed={`${worldSeed}-ocean-marine-snow`}
        color={water?.fogColor ?? "#9FC3D0"}
        driftDirectionRadians={current?.directionRadians ?? 0}
        driftIntensity={current?.intensity ?? 0.3}
      />
      <BioluminescentPlankton
        bioluminescence={bioluminescence}
        basinRadius={basinRadius}
        isMobile={isMobile}
        bloomMultiplier={bloomMultiplier}
      />
    </group>
  );
}

type MarineSnowProps = {
  count: number;
  basinRadius: number;
  seed: string;
  color: string;
  driftDirectionRadians: number;
  driftIntensity: number;
};

function MarineSnow({ count, basinRadius, seed, color, driftDirectionRadians, driftIntensity }: MarineSnowProps) {
  const pointsRef = useRef<Points>(null);
  const softCircleTexture = getSoftCircleTexture();

  const { geometry, fallSpeeds } = useMemo(() => {
    const nextRandomValue = randomFromSeed(seed);
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radial = Math.sqrt(nextRandomValue()) * basinRadius * 1.1;
      positions[index * 3] = Math.cos(angle) * radial;
      positions[index * 3 + 1] = nextRandomValue() * MARINE_SNOW_COLUMN_HEIGHT;
      positions[index * 3 + 2] = Math.sin(angle) * radial;
      // Flakes fall at different rates because they are different sizes. A
      // uniform speed reads as a texture scrolling rather than as particles.
      speeds[index] = 0.4 + nextRandomValue() * 1.2;
    }
    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    return { geometry: bufferGeometry, fallSpeeds: speeds };
  }, [basinRadius, count, seed]);

  useFrame((_, delta) => {
    const points = pointsRef.current;
    if (!points) {
      return;
    }
    const positions = points.geometry.getAttribute("position") as BufferAttribute;
    const lateralDrift = driftIntensity * 0.35 * delta;
    const driftX = Math.cos(driftDirectionRadians) * lateralDrift;
    const driftZ = Math.sin(driftDirectionRadians) * lateralDrift;
    for (let index = 0; index < positions.count; index += 1) {
      let y = positions.getY(index) - MARINE_SNOW_FALL_SPEED * fallSpeeds[index] * delta;
      let x = positions.getX(index) + driftX;
      let z = positions.getZ(index) + driftZ;
      if (y < 0) {
        y = MARINE_SNOW_COLUMN_HEIGHT;
      }
      // Wrap the drift back into the column rather than letting it empty out
      // of one side over a long session.
      if (Math.hypot(x, z) > basinRadius * 1.15) {
        x = -x;
        z = -z;
      }
      positions.setXYZ(index, x, y, z);
    }
    positions.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={MARINE_SNOW_SIZE}
        map={softCircleTexture ?? undefined}
        color={color}
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

type BioluminescentPlanktonProps = {
  bioluminescence?: OceanBioluminescenceConfig;
  basinRadius: number;
  isMobile: boolean;
  bloomMultiplier: number;
};

function BioluminescentPlankton({
  bioluminescence,
  basinRadius,
  isMobile,
  bloomMultiplier
}: BioluminescentPlanktonProps) {
  const pointsRef = useRef<Points>(null);
  const softCircleTexture = getSoftCircleTexture();
  const configuredEmissiveColors = bioluminescence?.emissiveColors;
  const baseCount = bioluminescence?.planktonCount ?? 300;
  const count = Math.round((isMobile ? baseCount * 0.4 : baseCount) * bloomMultiplier);

  const { geometry, flickerPhases } = useMemo(() => {
    // Defaulted INSIDE the memo: as a `?? [...]` above it built a fresh array on
    // every render, which made this dependency change every frame and rebuilt
    // the whole plankton cloud each time.
    const emissiveColors = configuredEmissiveColors ?? ["#5EEAD4", "#67E8F9"];
    const nextRandomValue = randomFromSeed(bioluminescence?.flickerSeed ?? "ocean-biolum");
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const palette = emissiveColors.map((hex) => new Color(hex));
    for (let index = 0; index < count; index += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radial = Math.sqrt(nextRandomValue()) * basinRadius;
      positions[index * 3] = Math.cos(angle) * radial;
      positions[index * 3 + 1] = nextRandomValue() * PLANKTON_COLUMN_HEIGHT;
      positions[index * 3 + 2] = Math.sin(angle) * radial;
      const paletteEntry = palette[Math.min(palette.length - 1, Math.floor(nextRandomValue() * palette.length))];
      colors[index * 3] = paletteEntry.r;
      colors[index * 3 + 1] = paletteEntry.g;
      colors[index * 3 + 2] = paletteEntry.b;
      phases[index] = nextRandomValue() * Math.PI * 2;
    }
    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    bufferGeometry.setAttribute("color", new BufferAttribute(colors, 3));
    return { geometry: bufferGeometry, flickerPhases: phases };
  }, [basinRadius, bioluminescence?.flickerSeed, configuredEmissiveColors, count]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) {
      return;
    }
    // Plankton twitches rather than glowing steadily. Modulating the whole
    // cloud's opacity is far cheaper than per-point colour and reads the same
    // at these sizes.
    const elapsed = clock.getElapsedTime();
    const material = points.material as { opacity: number };
    material.opacity = 0.55 + Math.sin(elapsed * PLANKTON_FLICKER_SPEED + flickerPhases[0]) * 0.15;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      {/* toneMapped false and additive blending: this is emitted light, not a
          lit surface, and it has to read with the Bloom pass disabled. */}
      <pointsMaterial
        size={PLANKTON_SIZE}
        map={softCircleTexture ?? undefined}
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
