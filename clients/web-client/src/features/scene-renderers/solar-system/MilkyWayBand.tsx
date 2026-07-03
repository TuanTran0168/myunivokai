"use client";

import { useMemo } from "react";
import { AdditiveBlending, Color, NormalBlending } from "three";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "../shared/softCircleTexture";

/**
 * A procedural Milky Way built from five point layers on the celestial
 * sphere, modeled on wide-field photographs of the real galaxy:
 *
 *   1. all-sky stars    — faint multi-colored stars covering the whole sky
 *   2. band haze        — the soft blue-white glow of the tilted band
 *   3. band stars       — denser, brighter multi-colored stars inside it
 *   4. galactic core    — a warm bright bulge at one spot on the band
 *   5. dust lanes       — dark streaks over the band (normal blending),
 *                         the signature look of the real Milky Way
 *
 * The band's width wobbles along its length so it reads organic, not like a
 * perfect ring. Fixed seed on purpose: there is one Milky Way, so every
 * world shares the same galaxy while its constellations stay personal.
 * Everything is static geometry — no per-frame work.
 */

const MILKY_WAY_FIXED_SEED = "myunivokai-milky-way";
// Between the constellations (52) and the skybox (60) so the band sits
// behind the figures but inside the backdrop.
const BAND_SPHERE_RADIUS = 56;
const BAND_TILT_X_RADIANS = 0.5;
const BAND_TILT_Z_RADIANS = 0.35;
// The band's half-width breathes +-35% along its length (two slow waves),
// which breaks the "perfect ring" look of a constant-sigma band.
const BAND_WIDTH_WOBBLE_RATIO = 0.35;
const BAND_WIDTH_WOBBLE_WAVES = 2;

// Real night skies mix blue-white, white and warm stars.
const STAR_COLOR_PALETTE = ["#C7D8FF", "#F4F1E8", "#FFE9C4", "#FFD9A0"];

const ALL_SKY_STAR_COUNT = 2800;
const ALL_SKY_STAR_POINT_SIZE = 0.3;
const ALL_SKY_STAR_OPACITY = 0.7;

const HAZE_POINT_COUNT = 3200;
const HAZE_BAND_SIGMA_RADIANS = 0.13;
const HAZE_POINT_SIZE = 1.7;
const HAZE_OPACITY = 0.08;
const HAZE_COLOR = "#B9C9EA";

const BAND_STAR_COUNT = 1400;
const BAND_STAR_SIGMA_RADIANS = 0.19;
const BAND_STAR_POINT_SIZE = 0.5;
const BAND_STAR_OPACITY = 0.9;

// The galactic core: a warm bright bulge at ONE spot on the band, like the
// center of the real Milky Way in wide-field photos.
const CORE_GLOW_POINT_COUNT = 900;
const CORE_GLOW_AZIMUTH_CENTER_RADIANS = 0.9;
const CORE_GLOW_AZIMUTH_SIGMA_RADIANS = 0.4;
const CORE_GLOW_BAND_SIGMA_RADIANS = 0.17;
const CORE_GLOW_POINT_SIZE = 3.2;
const CORE_GLOW_OPACITY = 0.05;
const CORE_GLOW_COLOR = "#E9C99B";

// Dust lanes: short dark chains hugging the band's midline, drawn with
// NORMAL blending so they darken the glow behind them (additive layers can
// only ever brighten).
const DUST_CHAIN_COUNT = 150;
const DUST_MINIMUM_CHAIN_LENGTH = 4;
const DUST_MAXIMUM_CHAIN_LENGTH = 8;
const DUST_CHAIN_AZIMUTH_STEP_RADIANS = 0.035;
const DUST_BAND_SIGMA_RADIANS = 0.05;
const DUST_LATITUDE_JITTER_RADIANS = 0.02;
const DUST_POINT_SIZE = 2.6;
const DUST_OPACITY = 0.3;
const DUST_COLOR = "#06050B";
// Slightly inside the glow layers so the dark patches always win the
// draw-order fight against the haze they are meant to occlude.
const DUST_SPHERE_RADIUS = 55;

type RandomSource = () => number;

// Box-Muller: turns two uniform samples into one gaussian sample, which is
// what concentrates points around the band's plane.
function gaussianSample(random: RandomSource): number {
  const uniformA = Math.max(random(), Number.EPSILON);
  const uniformB = random();
  return Math.sqrt(-2 * Math.log(uniformA)) * Math.cos(2 * Math.PI * uniformB);
}

function wobbledSigma(baseSigmaRadians: number, azimuthRadians: number): number {
  return baseSigmaRadians * (1 + BAND_WIDTH_WOBBLE_RATIO * Math.sin(BAND_WIDTH_WOBBLE_WAVES * azimuthRadians));
}

function pushSpherePoint(
  target: number[],
  radius: number,
  azimuthRadians: number,
  latitudeRadians: number
): void {
  target.push(
    radius * Math.cos(latitudeRadians) * Math.cos(azimuthRadians),
    radius * Math.sin(latitudeRadians),
    radius * Math.cos(latitudeRadians) * Math.sin(azimuthRadians)
  );
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
  const vertices: number[] = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const azimuthRadians = azimuthCluster
      ? azimuthCluster.centerRadians + gaussianSample(random) * azimuthCluster.sigmaRadians
      : random() * Math.PI * 2;
    const latitudeRadians = gaussianSample(random) * wobbledSigma(bandSigmaRadians, azimuthRadians);
    const radius = BAND_SPHERE_RADIUS * (0.96 + random() * 0.08);
    pushSpherePoint(vertices, radius, azimuthRadians, latitudeRadians);
  }
  return new Float32Array(vertices);
}

// Uniform points over the whole sphere (uniform in solid angle via acos).
function buildAllSkyPositions(random: RandomSource, pointCount: number): Float32Array {
  const vertices: number[] = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const azimuthRadians = random() * Math.PI * 2;
    const latitudeRadians = Math.asin(random() * 2 - 1);
    pushSpherePoint(vertices, BAND_SPHERE_RADIUS, azimuthRadians, latitudeRadians);
  }
  return new Float32Array(vertices);
}

// Short chains of dark points stepping along the band, so the dust reads as
// elongated streaks instead of round blobs.
function buildDustLanePositions(random: RandomSource): Float32Array {
  const vertices: number[] = [];
  for (let chainIndex = 0; chainIndex < DUST_CHAIN_COUNT; chainIndex += 1) {
    let azimuthRadians = random() * Math.PI * 2;
    let latitudeRadians = gaussianSample(random) * DUST_BAND_SIGMA_RADIANS;
    const chainLength =
      DUST_MINIMUM_CHAIN_LENGTH +
      Math.floor(random() * (DUST_MAXIMUM_CHAIN_LENGTH - DUST_MINIMUM_CHAIN_LENGTH + 1));
    for (let linkIndex = 0; linkIndex < chainLength; linkIndex += 1) {
      pushSpherePoint(vertices, DUST_SPHERE_RADIUS, azimuthRadians, latitudeRadians);
      azimuthRadians += DUST_CHAIN_AZIMUTH_STEP_RADIANS * (0.6 + random() * 0.8);
      latitudeRadians += (random() * 2 - 1) * DUST_LATITUDE_JITTER_RADIANS;
    }
  }
  return new Float32Array(vertices);
}

function buildStarColors(random: RandomSource, pointCount: number): Float32Array {
  const colors = new Float32Array(pointCount * 3);
  const paletteColors = STAR_COLOR_PALETTE.map((hex) => new Color(hex));
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const paletteColor = paletteColors[Math.floor(random() * paletteColors.length)];
    colors[pointIndex * 3] = paletteColor.r;
    colors[pointIndex * 3 + 1] = paletteColor.g;
    colors[pointIndex * 3 + 2] = paletteColor.b;
  }
  return colors;
}

export function MilkyWayBand() {
  const layers = useMemo(() => {
    const random = randomFromSeed(MILKY_WAY_FIXED_SEED);
    const allSkyPositions = buildAllSkyPositions(random, ALL_SKY_STAR_COUNT);
    const allSkyColors = buildStarColors(random, ALL_SKY_STAR_COUNT);
    const hazePositions = buildBandPositions(random, HAZE_POINT_COUNT, HAZE_BAND_SIGMA_RADIANS);
    const bandStarPositions = buildBandPositions(random, BAND_STAR_COUNT, BAND_STAR_SIGMA_RADIANS);
    const bandStarColors = buildStarColors(random, BAND_STAR_COUNT);
    const coreGlowPositions = buildBandPositions(random, CORE_GLOW_POINT_COUNT, CORE_GLOW_BAND_SIGMA_RADIANS, {
      centerRadians: CORE_GLOW_AZIMUTH_CENTER_RADIANS,
      sigmaRadians: CORE_GLOW_AZIMUTH_SIGMA_RADIANS
    });
    const dustPositions = buildDustLanePositions(random);
    return { allSkyPositions, allSkyColors, hazePositions, bandStarPositions, bandStarColors, coreGlowPositions, dustPositions };
  }, []);
  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);

  return (
    <group rotation={[BAND_TILT_X_RADIANS, 0, BAND_TILT_Z_RADIANS]}>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={layers.allSkyPositions.length / 3}
            array={layers.allSkyPositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={layers.allSkyColors.length / 3}
            array={layers.allSkyColors}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          vertexColors
          size={ALL_SKY_STAR_POINT_SIZE}
          transparent
          opacity={ALL_SKY_STAR_OPACITY}
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
            count={layers.hazePositions.length / 3}
            array={layers.hazePositions}
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
            count={layers.bandStarPositions.length / 3}
            array={layers.bandStarPositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={layers.bandStarColors.length / 3}
            array={layers.bandStarColors}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          vertexColors
          size={BAND_STAR_POINT_SIZE}
          transparent
          opacity={BAND_STAR_OPACITY}
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
            count={layers.coreGlowPositions.length / 3}
            array={layers.coreGlowPositions}
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
      <points frustumCulled={false} renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={layers.dustPositions.length / 3}
            array={layers.dustPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={DUST_COLOR}
          size={DUST_POINT_SIZE}
          transparent
          opacity={DUST_OPACITY}
          sizeAttenuation
          depthWrite={false}
          blending={NormalBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
