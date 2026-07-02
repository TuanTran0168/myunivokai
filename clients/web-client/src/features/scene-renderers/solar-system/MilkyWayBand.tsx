"use client";

import { useMemo } from "react";
import { AdditiveBlending } from "three";
import { randomFromSeed } from "@/lib/scene";

/**
 * A procedural Milky Way: two point layers concentrated in a tilted band
 * across the celestial sphere — a dense soft haze that reads as the glowing
 * band, and sparser bright stars scattered inside it. Drawn on top of the
 * skybox texture (which is too dark to carry the effect alone).
 *
 * The band uses a FIXED seed on purpose: there is one Milky Way, so every
 * world shares the same galaxy while its constellations stay personal.
 */

const MILKY_WAY_FIXED_SEED = "myunivokai-milky-way";
// Between the constellations (52) and the skybox (60) so the band sits
// behind the figures but inside the backdrop.
const BAND_SPHERE_RADIUS = 56;
const BAND_TILT_X_RADIANS = 0.5;
const BAND_TILT_Z_RADIANS = 0.35;

const HAZE_POINT_COUNT = 2200;
const HAZE_BAND_SIGMA_RADIANS = 0.14;
const HAZE_POINT_SIZE = 2.6;
const HAZE_OPACITY = 0.05;
const HAZE_COLOR = "#AFC3E8";

const BRIGHT_STAR_COUNT = 900;
const BRIGHT_BAND_SIGMA_RADIANS = 0.2;
const BRIGHT_POINT_SIZE = 0.5;
const BRIGHT_OPACITY = 0.85;
const BRIGHT_COLOR = "#EDE8DC";

type RandomSource = () => number;

// Box-Muller: turns two uniform samples into one gaussian sample, which is
// what concentrates points around the band's plane.
function gaussianSample(random: RandomSource): number {
  const uniformA = Math.max(random(), Number.EPSILON);
  const uniformB = random();
  return Math.sqrt(-2 * Math.log(uniformA)) * Math.cos(2 * Math.PI * uniformB);
}

function buildBandPositions(random: RandomSource, pointCount: number, bandSigmaRadians: number): Float32Array {
  const positions = new Float32Array(pointCount * 3);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const azimuthRadians = random() * Math.PI * 2;
    const latitudeRadians = gaussianSample(random) * bandSigmaRadians;
    const radius = BAND_SPHERE_RADIUS * (0.96 + random() * 0.08);
    positions[pointIndex * 3] = radius * Math.cos(latitudeRadians) * Math.cos(azimuthRadians);
    positions[pointIndex * 3 + 1] = radius * Math.sin(latitudeRadians);
    positions[pointIndex * 3 + 2] = radius * Math.cos(latitudeRadians) * Math.sin(azimuthRadians);
  }
  return positions;
}

export function MilkyWayBand() {
  const { hazePositions, brightPositions } = useMemo(() => {
    const random = randomFromSeed(MILKY_WAY_FIXED_SEED);
    return {
      hazePositions: buildBandPositions(random, HAZE_POINT_COUNT, HAZE_BAND_SIGMA_RADIANS),
      brightPositions: buildBandPositions(random, BRIGHT_STAR_COUNT, BRIGHT_BAND_SIGMA_RADIANS)
    };
  }, []);

  return (
    <group rotation={[BAND_TILT_X_RADIANS, 0, BAND_TILT_Z_RADIANS]}>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={hazePositions.length / 3}
            array={hazePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color={HAZE_COLOR}
          size={HAZE_POINT_SIZE}
          transparent
          opacity={HAZE_OPACITY}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </points>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={brightPositions.length / 3}
            array={brightPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color={BRIGHT_COLOR}
          size={BRIGHT_POINT_SIZE}
          transparent
          opacity={BRIGHT_OPACITY}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
