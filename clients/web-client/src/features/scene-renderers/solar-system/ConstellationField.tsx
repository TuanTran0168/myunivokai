"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Group } from "three";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "../shared/softCircleTexture";

/**
 * Seed-deterministic constellations on the celestial sphere: a handful of
 * star clusters connected by faint brass lines, drawn just inside the Milky
 * Way skybox. Every world gets its own night sky — same seed, same
 * constellations, forever. Static geometry: one <points> + one
 * <lineSegments> draw call total, nothing animates per frame.
 */

const CONSTELLATION_COUNT = 8;
const MINIMUM_STARS_PER_CONSTELLATION = 5;
const MAXIMUM_STARS_PER_CONSTELLATION = 8;
// Just inside the Skybox sphere (radius 60) so stars never clip through it.
const CELESTIAL_SPHERE_RADIUS = 52;
const CONSTELLATION_ANGULAR_SPREAD_RADIANS = 0.24;
// The figures drift a touch faster than the Milky Way behind them, giving
// the sky gentle parallax while orbiting.
const CONSTELLATION_ROTATION_RADIANS_PER_SECOND = 0.005;
// Bias anchors away from the poles, where connected lines look distorted.
const POLE_AVOIDANCE_RATIO = 0.75;
const CONSTELLATION_STAR_POINT_SIZE = 0.75;
const CONSTELLATION_STAR_OPACITY = 0.95;
const CONSTELLATION_LINE_OPACITY = 0.3;
const CONSTELLATION_STAR_COLOR = "#F2EEE6";
const CONSTELLATION_LINE_COLOR = "#D9B96E";

type ConstellationFieldProps = {
  seed: string;
};

type ConstellationGeometry = {
  starPositions: Float32Array;
  linePositions: Float32Array;
};

function buildConstellationGeometry(seed: string): ConstellationGeometry {
  const random = randomFromSeed(`${seed}-constellations`);
  const starVertices: number[] = [];
  const lineVertices: number[] = [];

  for (let constellationIndex = 0; constellationIndex < CONSTELLATION_COUNT; constellationIndex += 1) {
    const anchorAzimuthRadians = random() * Math.PI * 2;
    const anchorPolarRadians = Math.acos((random() * 2 - 1) * POLE_AVOIDANCE_RATIO);
    const starCount =
      MINIMUM_STARS_PER_CONSTELLATION +
      Math.floor(random() * (MAXIMUM_STARS_PER_CONSTELLATION - MINIMUM_STARS_PER_CONSTELLATION + 1));

    let previousStar: [number, number, number] | null = null;
    for (let starIndex = 0; starIndex < starCount; starIndex += 1) {
      const azimuthRadians = anchorAzimuthRadians + (random() * 2 - 1) * CONSTELLATION_ANGULAR_SPREAD_RADIANS;
      const polarRadians = anchorPolarRadians + (random() * 2 - 1) * CONSTELLATION_ANGULAR_SPREAD_RADIANS;
      const x = CELESTIAL_SPHERE_RADIUS * Math.sin(polarRadians) * Math.cos(azimuthRadians);
      const y = CELESTIAL_SPHERE_RADIUS * Math.cos(polarRadians);
      const z = CELESTIAL_SPHERE_RADIUS * Math.sin(polarRadians) * Math.sin(azimuthRadians);
      starVertices.push(x, y, z);
      if (previousStar) {
        lineVertices.push(previousStar[0], previousStar[1], previousStar[2], x, y, z);
      }
      previousStar = [x, y, z];
    }
  }

  return {
    starPositions: new Float32Array(starVertices),
    linePositions: new Float32Array(lineVertices)
  };
}

export function ConstellationField({ seed }: ConstellationFieldProps) {
  const { starPositions, linePositions } = useMemo(() => buildConstellationGeometry(seed), [seed]);
  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);
  const constellationGroupReference = useRef<Group>(null);

  useFrame((_, deltaSeconds) => {
    if (constellationGroupReference.current) {
      constellationGroupReference.current.rotation.y += CONSTELLATION_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  return (
    <group ref={constellationGroupReference}>
      {/* frustumCulled=false on both: the auto bounding sphere of hand-built
          buffer geometry misjudges these sky-wide shells, so orbiting the
          camera made whole constellations pop in and out of existence. */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={starPositions.length / 3}
            array={starPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={CONSTELLATION_STAR_COLOR}
          size={CONSTELLATION_STAR_POINT_SIZE}
          transparent
          opacity={CONSTELLATION_STAR_OPACITY}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </points>
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={linePositions.length / 3}
            array={linePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={CONSTELLATION_LINE_COLOR}
          transparent
          opacity={CONSTELLATION_LINE_OPACITY}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
