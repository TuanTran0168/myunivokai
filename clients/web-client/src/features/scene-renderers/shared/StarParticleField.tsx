"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Points } from "three";
import type { SceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "./softCircleTexture";

const DEFAULT_PARTICLE_DESKTOP_COUNT = 900;
const DEFAULT_PARTICLE_MOBILE_COUNT = 400;
const DEFAULT_PARTICLE_SPREAD = 16;
const PARTICLE_VERTICAL_SPREAD_RATIO = 0.6;
const PARTICLE_POINT_SIZE = 0.06;
const PARTICLE_OPACITY = 0.85;
const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;
const DEFAULT_PARTICLE_COLOR = "#06B6D4";
// Nearest sky layer, so it drifts the fastest of the three (particles >
// constellations > Milky Way) for a subtle parallax depth cue.
const PARTICLE_ROTATION_RADIANS_PER_SECOND = 0.008;

type StarParticleFieldProps = {
  scene?: SceneConfig;
  seed: string;
  fallbackColor?: string;
};

function buildParticlePositions(seed: string, particleCount: number, particleSpread: number): Float32Array {
  const random = randomFromSeed(`${seed}-particles`);
  const positions = new Float32Array(particleCount * 3);
  for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
    positions[particleIndex * 3] = (random() * 2 - 1) * particleSpread;
    positions[particleIndex * 3 + 1] = (random() * 2 - 1) * particleSpread * PARTICLE_VERTICAL_SPREAD_RATIO;
    positions[particleIndex * 3 + 2] = (random() * 2 - 1) * particleSpread;
  }
  return positions;
}

export function StarParticleField({ scene, seed, fallbackColor }: StarParticleFieldProps) {
  const particleConfig = scene?.particles;
  const isMobileViewport = typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
  const particleCount = isMobileViewport
    ? particleConfig?.mobileCount ?? DEFAULT_PARTICLE_MOBILE_COUNT
    : particleConfig?.desktopCount ?? DEFAULT_PARTICLE_DESKTOP_COUNT;
  const particleSpread = particleConfig?.spread ?? DEFAULT_PARTICLE_SPREAD;
  const particleColor = particleConfig?.color ?? fallbackColor ?? DEFAULT_PARTICLE_COLOR;

  const particlePositions = useMemo(
    () => buildParticlePositions(seed, particleCount, particleSpread),
    [seed, particleCount, particleSpread]
  );
  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);
  const particlePointsReference = useRef<Points>(null);

  useFrame((_, deltaSeconds) => {
    if (particlePointsReference.current) {
      particlePointsReference.current.rotation.y += PARTICLE_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  return (
    <points ref={particlePointsReference} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particlePositions.length / 3}
          array={particlePositions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        map={softCircleTexture ?? undefined}
        alphaTest={0.01}
        color={particleColor}
        size={PARTICLE_POINT_SIZE}
        transparent
        opacity={PARTICLE_OPACITY}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
