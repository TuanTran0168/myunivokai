"use client";

import { useMemo } from "react";
import { AdditiveBlending } from "three";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "../shared/softCircleTexture";

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

const HAZE_POINT_COUNT = 3200;
const HAZE_BAND_SIGMA_RADIANS = 0.13;
const HAZE_POINT_SIZE = 1.7;
const HAZE_OPACITY = 0.08;
const HAZE_COLOR = "#B9C9EA";

const BRIGHT_STAR_COUNT = 1100;
const BRIGHT_BAND_SIGMA_RADIANS = 0.19;
const BRIGHT_POINT_SIZE = 0.45;
const BRIGHT_OPACITY = 0.9;
const BRIGHT_COLOR = "#EDE8DC";

// The galactic core: a warm bright bulge at ONE spot on the band, like the
// center of the real Milky Way in wide-field photos.
const CORE_GLOW_POINT_COUNT = 900;
const CORE_GLOW_AZIMUTH_CENTER_RADIANS = 0.9;
const CORE_GLOW_AZIMUTH_SIGMA_RADIANS = 0.4;
const CORE_GLOW_BAND_SIGMA_RADIANS = 0.17;
const CORE_GLOW_POINT_SIZE = 3.2;
const CORE_GLOW_OPACITY = 0.05;
const CORE_GLOW_COLOR = "#E9C99B";

type RandomSource = () => number;

// Box-Muller: turns two uniform samples into one gaussian sample, which is
// what concentrates points around the band's plane.
function gaussianSample(random: RandomSource): number {
  const uniformA = Math.max(random(), Number.EPSILON);
  const uniformB = random();
  return Math.sqrt(-2 * Math.log(uniformA)) * Math.cos(2 * Math.PI * uniformB);
}

type BandAzimuthCluster = {
  centerRadians: number;
  sigmaRadians: number;
};

function buildBandPositions(
  random: RandomSource,
  pointCount: number,
  bandSigmaRadians: number,
  azimuthCluster?: BandAzimuthCluster
): Float32Array {
  const positions = new Float32Array(pointCount * 3);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const azimuthRadians = azimuthCluster
      ? azimuthCluster.centerRadians + gaussianSample(random) * azimuthCluster.sigmaRadians
      : random() * Math.PI * 2;
    const latitudeRadians = gaussianSample(random) * bandSigmaRadians;
    const radius = BAND_SPHERE_RADIUS * (0.96 + random() * 0.08);
    positions[pointIndex * 3] = radius * Math.cos(latitudeRadians) * Math.cos(azimuthRadians);
    positions[pointIndex * 3 + 1] = radius * Math.sin(latitudeRadians);
    positions[pointIndex * 3 + 2] = radius * Math.cos(latitudeRadians) * Math.sin(azimuthRadians);
  }
  return positions;
}

export function MilkyWayBand() {
  const { hazePositions, brightPositions, coreGlowPositions } = useMemo(() => {
    const random = randomFromSeed(MILKY_WAY_FIXED_SEED);
    return {
      hazePositions: buildBandPositions(random, HAZE_POINT_COUNT, HAZE_BAND_SIGMA_RADIANS),
      brightPositions: buildBandPositions(random, BRIGHT_STAR_COUNT, BRIGHT_BAND_SIGMA_RADIANS),
      coreGlowPositions: buildBandPositions(random, CORE_GLOW_POINT_COUNT, CORE_GLOW_BAND_SIGMA_RADIANS, {
        centerRadians: CORE_GLOW_AZIMUTH_CENTER_RADIANS,
        sigmaRadians: CORE_GLOW_AZIMUTH_SIGMA_RADIANS
      })
    };
  }, []);
  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);

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
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
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
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
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
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={coreGlowPositions.length / 3}
            array={coreGlowPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={CORE_GLOW_COLOR}
          size={CORE_GLOW_POINT_SIZE}
          transparent
          opacity={CORE_GLOW_OPACITY}
          sizeAttenuation
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
