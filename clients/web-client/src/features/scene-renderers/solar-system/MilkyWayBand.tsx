"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, NormalBlending, type Group } from "three";
import { randomFromSeed } from "@/lib/scene";
import { SizedStarPoints, hexColorToUnitRgb, type StarLayerAttributes } from "../shared/SizedStarPoints";
import { NebulaCloudPoints, type CloudLayerAttributes } from "./NebulaCloudPoints";

/**
 * A procedural Milky Way modeled on wide-field photographs, built from
 * seven layers on the celestial sphere:
 *
 *   stars (custom shader, PER-STAR power-law sizes + twinkle):
 *     1. all-sky stars   — faint pinpricks covering the whole sky
 *     2. band stars      — a denser strip inside the tilted band
 *     3. core stars      — a warm crowded bulge at one spot on the band
 *     4. hero stars      — a couple dozen big glowing standouts
 *
 *   clouds (noise-texture sprites that fuse into continuous nebulosity):
 *     5. band nebulosity — blue-grey / dusty-pink glow along the band
 *     6. core glow       — warm amber clouds around the galactic center
 *     7. dust lanes      — dark clouds carving the band's midline
 *                          (normal blending: the only layer that can DARKEN)
 *
 * The band's width wobbles along its length so it reads organic, not like a
 * perfect ring. Fixed seed on purpose: there is one Milky Way, so every
 * world shares the same galaxy while its constellations stay personal.
 */

const MILKY_WAY_FIXED_SEED = "myunivokai-milky-way";
// Between the constellations (52) and the skybox (60) so the band sits
// behind the figures but inside the backdrop.
const BAND_SPHERE_RADIUS = 56;
// Slightly inside the glow layers so the dark patches sit visually on top
// of the haze they are meant to occlude.
const DUST_SPHERE_RADIUS = 55;
const BAND_TILT_X_RADIANS = 0.5;
const BAND_TILT_Z_RADIANS = 0.35;
// The whole galaxy wheels slowly overhead, like a long-exposure night sky.
// Farthest layer, so it drifts slower than the constellations in front.
const BAND_ROTATION_RADIANS_PER_SECOND = 0.003;
// The band's half-width breathes +-35% along its length (two slow waves),
// which breaks the "perfect ring" look of a constant-sigma band.
const BAND_WIDTH_WOBBLE_RATIO = 0.35;
const BAND_WIDTH_WOBBLE_WAVES = 2;
// Layers hug the sphere loosely (+-4% radius) so the band has a bit of depth.
const SPHERE_RADIUS_JITTER_RATIO = 0.04;

// The galactic core sits at ONE azimuth on the band, like the bright center
// of the real Milky Way in wide-field photos.
const CORE_AZIMUTH_CENTER_RADIANS = 0.9;

// --- star populations -------------------------------------------------------
// Star sizes follow a steep power law: almost every star is a faint
// pinprick and only the rare tail is bright. This size spread is the single
// biggest difference between a photographic starfield and uniform dots.
const STAR_SIZE_POWER_LAW_EXPONENT = 5;
// Brightness rises with the same draw that sets the size, so big stars glow
// and small ones stay faint instead of every dot having equal weight.
const STAR_MINIMUM_BRIGHTNESS = 0.45;

const ALL_SKY_STAR_COUNT = 5200;
const ALL_SKY_STAR_MINIMUM_SIZE = 0.06;
const ALL_SKY_STAR_SIZE_RANGE = 0.5;

const BAND_STAR_COUNT = 4200;
const BAND_STAR_SIGMA_RADIANS = 0.1;
const BAND_STAR_MINIMUM_SIZE = 0.05;
const BAND_STAR_SIZE_RANGE = 0.42;

const CORE_STAR_COUNT = 1800;
const CORE_STAR_AZIMUTH_SIGMA_RADIANS = 0.35;
const CORE_STAR_BAND_SIGMA_RADIANS = 0.15;
const CORE_STAR_MINIMUM_SIZE = 0.05;
const CORE_STAR_SIZE_RANGE = 0.34;

// A few standout stars with wide halos, like the bright foreground stars in
// the reference photographs. Linear size spread — these are all meant to pop.
const HERO_STAR_COUNT = 26;
const HERO_STAR_SIZE_POWER_LAW_EXPONENT = 1;
const HERO_STAR_MINIMUM_SIZE = 0.85;
const HERO_STAR_SIZE_RANGE = 0.9;

type WeightedColor = {
  hexColor: string;
  weight: number;
};

// Blue-white dominant with a warm minority — the mix visible in real
// starfield photographs.
const SKY_STAR_COLOR_DISTRIBUTION: WeightedColor[] = [
  { hexColor: "#9BB8FF", weight: 0.22 },
  { hexColor: "#C7D8FF", weight: 0.26 },
  { hexColor: "#EDF2FF", weight: 0.22 },
  { hexColor: "#FFF3DC", weight: 0.16 },
  { hexColor: "#FFD9A0", weight: 0.1 },
  { hexColor: "#FF9F7A", weight: 0.04 }
];
// The galactic bulge is older and yellower than the disk.
const CORE_STAR_COLOR_DISTRIBUTION: WeightedColor[] = [
  { hexColor: "#FFE7C0", weight: 0.38 },
  { hexColor: "#F4E4C8", weight: 0.3 },
  { hexColor: "#FFD09A", weight: 0.22 },
  { hexColor: "#E8F0FF", weight: 0.1 }
];

// --- nebula clouds -----------------------------------------------------------
const CLOUD_MINIMUM_ALPHA = 0.35;
const CLOUD_ALPHA_RANGE = 0.65;

const NEBULA_CLOUD_COUNT = 130;
const NEBULA_CLOUD_SIGMA_RADIANS = 0.085;
const NEBULA_CLOUD_MINIMUM_SIZE = 3.5;
const NEBULA_CLOUD_SIZE_RANGE = 8.5;
const NEBULA_CLOUD_LAYER_OPACITY = 0.16;
// Blue-grey nebulosity with dusty pink and brown patches, like the
// photographed band.
const NEBULA_CLOUD_COLOR_DISTRIBUTION: WeightedColor[] = [
  { hexColor: "#8FA5CE", weight: 0.35 },
  { hexColor: "#B4C4E8", weight: 0.3 },
  { hexColor: "#C9B7D6", weight: 0.15 },
  { hexColor: "#A08A70", weight: 0.2 }
];

const CORE_CLOUD_COUNT = 55;
const CORE_CLOUD_AZIMUTH_SIGMA_RADIANS = 0.32;
const CORE_CLOUD_SIGMA_RADIANS = 0.12;
const CORE_CLOUD_MINIMUM_SIZE = 4.5;
const CORE_CLOUD_SIZE_RANGE = 9.5;
const CORE_CLOUD_LAYER_OPACITY = 0.18;
const CORE_CLOUD_COLOR_DISTRIBUTION: WeightedColor[] = [
  { hexColor: "#E8C79A", weight: 0.45 },
  { hexColor: "#D9A468", weight: 0.35 },
  { hexColor: "#C08A5A", weight: 0.2 }
];

// Dark dust carving the band's midline. Normal blending darkens what is
// behind it (additive layers can only ever brighten), drawn after the glow
// layers via render order.
const DUST_CLOUD_COUNT = 95;
const DUST_CLOUD_SIGMA_RADIANS = 0.03;
const DUST_CLOUD_MINIMUM_SIZE = 2.2;
const DUST_CLOUD_SIZE_RANGE = 5;
const DUST_CLOUD_LAYER_OPACITY = 0.55;
const DUST_CLOUD_COLOR_DISTRIBUTION: WeightedColor[] = [
  { hexColor: "#0A0710", weight: 0.5 },
  { hexColor: "#120C08", weight: 0.5 }
];
const MILKY_WAY_DUST_RENDER_ORDER = 1;

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

type SphereDirection = {
  azimuthRadians: number;
  latitudeRadians: number;
};

// Uniform over the whole sphere (uniform in solid angle via asin).
function sampleAllSkyDirection(random: RandomSource): SphereDirection {
  return {
    azimuthRadians: random() * Math.PI * 2,
    latitudeRadians: Math.asin(random() * 2 - 1)
  };
}

type BandAzimuthCluster = {
  centerRadians: number;
  sigmaRadians: number;
};

function sampleBandDirection(
  random: RandomSource,
  bandSigmaRadians: number,
  azimuthCluster?: BandAzimuthCluster
): SphereDirection {
  const azimuthRadians = azimuthCluster
    ? azimuthCluster.centerRadians + gaussianSample(random) * azimuthCluster.sigmaRadians
    : random() * Math.PI * 2;
  return {
    azimuthRadians,
    latitudeRadians: gaussianSample(random) * wobbledSigma(bandSigmaRadians, azimuthRadians)
  };
}

function writeSpherePoint(
  positions: Float32Array,
  pointIndex: number,
  radius: number,
  direction: SphereDirection
): void {
  positions[pointIndex * 3] = radius * Math.cos(direction.latitudeRadians) * Math.cos(direction.azimuthRadians);
  positions[pointIndex * 3 + 1] = radius * Math.sin(direction.latitudeRadians);
  positions[pointIndex * 3 + 2] = radius * Math.cos(direction.latitudeRadians) * Math.sin(direction.azimuthRadians);
}

function pickWeightedColor(random: RandomSource, distribution: WeightedColor[]): [number, number, number] {
  const totalWeight = distribution.reduce((weightSum, entry) => weightSum + entry.weight, 0);
  let remainingWeight = random() * totalWeight;
  for (const entry of distribution) {
    remainingWeight -= entry.weight;
    if (remainingWeight <= 0) {
      return hexColorToUnitRgb(entry.hexColor);
    }
  }
  return hexColorToUnitRgb(distribution[distribution.length - 1].hexColor);
}

type StarPopulationOptions = {
  starCount: number;
  minimumSize: number;
  sizeRange: number;
  sizePowerLawExponent: number;
  colorDistribution: WeightedColor[];
  sampleDirection: (random: RandomSource) => SphereDirection;
};

function buildStarLayer(random: RandomSource, options: StarPopulationOptions): StarLayerAttributes {
  const positions = new Float32Array(options.starCount * 3);
  const colors = new Float32Array(options.starCount * 3);
  const sizes = new Float32Array(options.starCount);
  const twinklePhases = new Float32Array(options.starCount);
  for (let starIndex = 0; starIndex < options.starCount; starIndex += 1) {
    const radius = BAND_SPHERE_RADIUS * (1 + (random() * 2 - 1) * SPHERE_RADIUS_JITTER_RATIO);
    writeSpherePoint(positions, starIndex, radius, options.sampleDirection(random));

    const sizeDraw = random();
    sizes[starIndex] = options.minimumSize + sizeDraw ** options.sizePowerLawExponent * options.sizeRange;
    const brightness = STAR_MINIMUM_BRIGHTNESS + (1 - STAR_MINIMUM_BRIGHTNESS) * sizeDraw;
    const [red, green, blue] = pickWeightedColor(random, options.colorDistribution);
    colors[starIndex * 3] = red * brightness;
    colors[starIndex * 3 + 1] = green * brightness;
    colors[starIndex * 3 + 2] = blue * brightness;

    twinklePhases[starIndex] = random() * Math.PI * 2;
  }
  return { positions, colors, sizes, twinklePhases };
}

type CloudPopulationOptions = {
  cloudCount: number;
  minimumSize: number;
  sizeRange: number;
  colorDistribution: WeightedColor[];
  bandSigmaRadians: number;
  azimuthCluster?: BandAzimuthCluster;
  sphereRadius: number;
};

function buildCloudLayer(random: RandomSource, options: CloudPopulationOptions): CloudLayerAttributes {
  const positions = new Float32Array(options.cloudCount * 3);
  const colors = new Float32Array(options.cloudCount * 3);
  const sizes = new Float32Array(options.cloudCount);
  const rotations = new Float32Array(options.cloudCount);
  const alphas = new Float32Array(options.cloudCount);
  for (let cloudIndex = 0; cloudIndex < options.cloudCount; cloudIndex += 1) {
    const direction = sampleBandDirection(random, options.bandSigmaRadians, options.azimuthCluster);
    writeSpherePoint(positions, cloudIndex, options.sphereRadius, direction);

    const [red, green, blue] = pickWeightedColor(random, options.colorDistribution);
    colors[cloudIndex * 3] = red;
    colors[cloudIndex * 3 + 1] = green;
    colors[cloudIndex * 3 + 2] = blue;

    sizes[cloudIndex] = options.minimumSize + random() * options.sizeRange;
    rotations[cloudIndex] = random() * Math.PI * 2;
    alphas[cloudIndex] = CLOUD_MINIMUM_ALPHA + random() * CLOUD_ALPHA_RANGE;
  }
  return { positions, colors, sizes, rotations, alphas };
}

export function MilkyWayBand() {
  const layers = useMemo(() => {
    const random = randomFromSeed(MILKY_WAY_FIXED_SEED);
    const coreAzimuthCluster: BandAzimuthCluster = {
      centerRadians: CORE_AZIMUTH_CENTER_RADIANS,
      sigmaRadians: CORE_STAR_AZIMUTH_SIGMA_RADIANS
    };
    return {
      allSkyStars: buildStarLayer(random, {
        starCount: ALL_SKY_STAR_COUNT,
        minimumSize: ALL_SKY_STAR_MINIMUM_SIZE,
        sizeRange: ALL_SKY_STAR_SIZE_RANGE,
        sizePowerLawExponent: STAR_SIZE_POWER_LAW_EXPONENT,
        colorDistribution: SKY_STAR_COLOR_DISTRIBUTION,
        sampleDirection: sampleAllSkyDirection
      }),
      bandStars: buildStarLayer(random, {
        starCount: BAND_STAR_COUNT,
        minimumSize: BAND_STAR_MINIMUM_SIZE,
        sizeRange: BAND_STAR_SIZE_RANGE,
        sizePowerLawExponent: STAR_SIZE_POWER_LAW_EXPONENT,
        colorDistribution: SKY_STAR_COLOR_DISTRIBUTION,
        sampleDirection: (randomSource) => sampleBandDirection(randomSource, BAND_STAR_SIGMA_RADIANS)
      }),
      coreStars: buildStarLayer(random, {
        starCount: CORE_STAR_COUNT,
        minimumSize: CORE_STAR_MINIMUM_SIZE,
        sizeRange: CORE_STAR_SIZE_RANGE,
        sizePowerLawExponent: STAR_SIZE_POWER_LAW_EXPONENT,
        colorDistribution: CORE_STAR_COLOR_DISTRIBUTION,
        sampleDirection: (randomSource) =>
          sampleBandDirection(randomSource, CORE_STAR_BAND_SIGMA_RADIANS, coreAzimuthCluster)
      }),
      heroStars: buildStarLayer(random, {
        starCount: HERO_STAR_COUNT,
        minimumSize: HERO_STAR_MINIMUM_SIZE,
        sizeRange: HERO_STAR_SIZE_RANGE,
        sizePowerLawExponent: HERO_STAR_SIZE_POWER_LAW_EXPONENT,
        colorDistribution: SKY_STAR_COLOR_DISTRIBUTION,
        sampleDirection: sampleAllSkyDirection
      }),
      nebulaClouds: buildCloudLayer(random, {
        cloudCount: NEBULA_CLOUD_COUNT,
        minimumSize: NEBULA_CLOUD_MINIMUM_SIZE,
        sizeRange: NEBULA_CLOUD_SIZE_RANGE,
        colorDistribution: NEBULA_CLOUD_COLOR_DISTRIBUTION,
        bandSigmaRadians: NEBULA_CLOUD_SIGMA_RADIANS,
        sphereRadius: BAND_SPHERE_RADIUS
      }),
      coreClouds: buildCloudLayer(random, {
        cloudCount: CORE_CLOUD_COUNT,
        minimumSize: CORE_CLOUD_MINIMUM_SIZE,
        sizeRange: CORE_CLOUD_SIZE_RANGE,
        colorDistribution: CORE_CLOUD_COLOR_DISTRIBUTION,
        bandSigmaRadians: CORE_CLOUD_SIGMA_RADIANS,
        azimuthCluster: {
          centerRadians: CORE_AZIMUTH_CENTER_RADIANS,
          sigmaRadians: CORE_CLOUD_AZIMUTH_SIGMA_RADIANS
        },
        sphereRadius: BAND_SPHERE_RADIUS
      }),
      dustClouds: buildCloudLayer(random, {
        cloudCount: DUST_CLOUD_COUNT,
        minimumSize: DUST_CLOUD_MINIMUM_SIZE,
        sizeRange: DUST_CLOUD_SIZE_RANGE,
        colorDistribution: DUST_CLOUD_COLOR_DISTRIBUTION,
        bandSigmaRadians: DUST_CLOUD_SIGMA_RADIANS,
        sphereRadius: DUST_SPHERE_RADIUS
      })
    };
  }, []);
  const bandGroupReference = useRef<Group>(null);

  useFrame((_, deltaSeconds) => {
    if (bandGroupReference.current) {
      bandGroupReference.current.rotation.y += BAND_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  return (
    <group ref={bandGroupReference} rotation={[BAND_TILT_X_RADIANS, 0, BAND_TILT_Z_RADIANS]}>
      <NebulaCloudPoints clouds={layers.nebulaClouds} globalOpacity={NEBULA_CLOUD_LAYER_OPACITY} blending={AdditiveBlending} />
      <NebulaCloudPoints clouds={layers.coreClouds} globalOpacity={CORE_CLOUD_LAYER_OPACITY} blending={AdditiveBlending} />
      <SizedStarPoints stars={layers.allSkyStars} />
      <SizedStarPoints stars={layers.bandStars} />
      <SizedStarPoints stars={layers.coreStars} />
      <SizedStarPoints stars={layers.heroStars} />
      <NebulaCloudPoints
        clouds={layers.dustClouds}
        globalOpacity={DUST_CLOUD_LAYER_OPACITY}
        blending={NormalBlending}
        renderOrder={MILKY_WAY_DUST_RENDER_ORDER}
      />
    </group>
  );
}
