import { randomFromSeed } from "@/lib/scene";
import type { OceanSeafloorConfig } from "@/lib/types";

/**
 * Deterministic maths for the ocean renderer.
 *
 * Everything scattered, swum or drifted here comes from a seed embedded in the
 * config by ocean-service. Math.random() is banned in scene code for exactly
 * this reason: a world has to render the same way tomorrow, on someone else's
 * machine, from the same seed.
 */

export type SeafloorHeightSampler = (x: number, z: number) => number;

const DEFAULT_BASIN_RADIUS = 30;
const DEFAULT_RIDGE_AMPLITUDE = 2.2;
const DEFAULT_RIDGE_FREQUENCY = 0.045;

// A second, finer octave at these ratios turns a single smooth swell into
// something that reads as rock rather than as a bedsheet.
const SECOND_OCTAVE_FREQUENCY_MULTIPLIER = 2.7;
const SECOND_OCTAVE_AMPLITUDE_MULTIPLIER = 0.38;

// The basin dishes downward toward its rim so the floor does not simply end at
// a cliff where the geometry runs out.
const BASIN_RIM_DROP = 3.5;

export function basinRadiusFromSeafloor(seafloor?: OceanSeafloorConfig): number {
  return seafloor?.basinRadius ?? DEFAULT_BASIN_RADIUS;
}

/**
 * The seafloor's height at a point. Two sine octaves plus a rim dish — the
 * ocean counterpart of the forest's hill sampler, and like it, a pure function
 * so terrain, flora, rocks and fish all agree about where the floor is without
 * sharing state.
 */
export function createSeafloorHeightSampler(seafloor?: OceanSeafloorConfig): SeafloorHeightSampler {
  const amplitude = seafloor?.ridgeAmplitude ?? DEFAULT_RIDGE_AMPLITUDE;
  const frequency = seafloor?.ridgeFrequency ?? DEFAULT_RIDGE_FREQUENCY;
  const basinRadius = basinRadiusFromSeafloor(seafloor);
  return (x: number, z: number) => {
    const primary = Math.sin(x * frequency * Math.PI) * Math.cos(z * frequency * Math.PI);
    const secondary =
      Math.sin(x * frequency * SECOND_OCTAVE_FREQUENCY_MULTIPLIER * Math.PI + 1.7) *
      Math.cos(z * frequency * SECOND_OCTAVE_FREQUENCY_MULTIPLIER * Math.PI - 0.9) *
      SECOND_OCTAVE_AMPLITUDE_MULTIPLIER;
    const radial = Math.min(1, Math.hypot(x, z) / Math.max(1, basinRadius));
    return (primary + secondary) * amplitude - radial * radial * BASIN_RIM_DROP;
  };
}

export type ScatterPoint = {
  x: number;
  z: number;
  /** 0..1, for per-instance scale/rotation variation. */
  variation: number;
  yawRadians: number;
};

/**
 * Scatters `count` points across a disc of `radius`, deterministically.
 *
 * sqrt on the radial roll is what keeps the density even: without it every
 * point crowds the centre, because a disc's area grows with r squared.
 */
export function scatterOnDisc(seed: string, count: number, radius: number, innerRadius = 0): ScatterPoint[] {
  const nextRandomValue = randomFromSeed(seed);
  const points: ScatterPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = nextRandomValue() * Math.PI * 2;
    const radial = Math.sqrt(nextRandomValue());
    const variation = nextRandomValue();
    const yawRadians = nextRandomValue() * Math.PI * 2;
    const distance = innerRadius + radial * (radius - innerRadius);
    points.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, variation, yawRadians });
  }
  return points;
}

export type SchoolPath = {
  /** Centre of the loop the school swims. */
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  /** Height above the seafloor the school holds. */
  heightAboveFloor: number;
  phase: number;
  /** Radians per second around the loop. */
  angularSpeed: number;
  /** Small vertical bob so a school does not read as a flat carousel. */
  bobAmplitude: number;
  bobSpeed: number;
};

const SCHOOL_LOOP_RADIUS_FRACTION_BASE = 0.35;
const SCHOOL_LOOP_RADIUS_FRACTION_RANGE = 0.4;
const SCHOOL_LOOP_ECCENTRICITY_RANGE = 0.45;
const SCHOOL_ANGULAR_SPEED_SCALE = 0.055;
const SCHOOL_BOB_AMPLITUDE_BASE = 0.4;
const SCHOOL_BOB_AMPLITUDE_RANGE = 0.9;
const SCHOOL_BOB_SPEED_BASE = 0.25;
const SCHOOL_BOB_SPEED_RANGE = 0.4;

/**
 * One school's loop, derived from its own pathSeed. Draw order is fixed so
 * adding a field later never moves an existing school.
 */
export function createSchoolPath(
  pathSeed: string,
  basinRadius: number,
  depthBandMin: number,
  depthBandMax: number,
  swimSpeed: number
): SchoolPath {
  const nextRandomValue = randomFromSeed(pathSeed);
  const centerAngle = nextRandomValue() * Math.PI * 2;
  const centerDistance = nextRandomValue() * basinRadius * 0.35;
  const radiusFraction = SCHOOL_LOOP_RADIUS_FRACTION_BASE + nextRandomValue() * SCHOOL_LOOP_RADIUS_FRACTION_RANGE;
  const eccentricity = 1 - nextRandomValue() * SCHOOL_LOOP_ECCENTRICITY_RANGE;
  const heightRoll = nextRandomValue();
  const phase = nextRandomValue() * Math.PI * 2;
  const direction = nextRandomValue() < 0.5 ? -1 : 1;
  const bobAmplitude = SCHOOL_BOB_AMPLITUDE_BASE + nextRandomValue() * SCHOOL_BOB_AMPLITUDE_RANGE;
  const bobSpeed = SCHOOL_BOB_SPEED_BASE + nextRandomValue() * SCHOOL_BOB_SPEED_RANGE;

  const loopRadius = basinRadius * radiusFraction;
  return {
    centerX: Math.cos(centerAngle) * centerDistance,
    centerZ: Math.sin(centerAngle) * centerDistance,
    radiusX: loopRadius,
    radiusZ: loopRadius * eccentricity,
    heightAboveFloor: depthBandMin + heightRoll * Math.max(0, depthBandMax - depthBandMin),
    phase,
    angularSpeed: direction * swimSpeed * SCHOOL_ANGULAR_SPEED_SCALE,
    bobAmplitude,
    bobSpeed
  };
}

export type SchoolMemberOffset = {
  /** Along-track offset in radians — spreads the school into a stream. */
  alongTrackRadians: number;
  lateralOffset: number;
  verticalOffset: number;
  /** Per-fish tail-beat phase, so a school does not flap in unison. */
  beatPhase: number;
  scale: number;
};

const MEMBER_SCALE_BASE = 0.78;
const MEMBER_SCALE_RANGE = 0.44;

/**
 * Per-fish offsets from the school's path.
 *
 * cohesion pulls the members together along and across the track; separation
 * pushes them apart. Both arrive from the config, which is what makes a school
 * move as one body instead of as N fish on parallel rails — and what makes two
 * schools in the same world look like different species of behaviour.
 */
export function createSchoolMemberOffsets(
  pathSeed: string,
  count: number,
  cohesion: number,
  separation: number
): SchoolMemberOffset[] {
  const nextRandomValue = randomFromSeed(`${pathSeed}-members`);
  const spreadRadians = (1 - cohesion) * 1.6 + separation * 0.5;
  const lateralSpread = separation * 3.4 + (1 - cohesion) * 1.2;
  const verticalSpread = separation * 1.8;
  const offsets: SchoolMemberOffset[] = [];
  for (let index = 0; index < count; index += 1) {
    offsets.push({
      alongTrackRadians: (nextRandomValue() - 0.5) * spreadRadians,
      lateralOffset: (nextRandomValue() - 0.5) * lateralSpread,
      verticalOffset: (nextRandomValue() - 0.5) * verticalSpread,
      beatPhase: nextRandomValue() * Math.PI * 2,
      scale: MEMBER_SCALE_BASE + nextRandomValue() * MEMBER_SCALE_RANGE
    });
  }
  return offsets;
}

/**
 * Blends two hex colours. Used to tint everything toward the water's own colour
 * by the config's tintStrength — the reason a red coral reads brown-grey at
 * depth without anyone authoring a brown.
 */
export function mixHexColors(fromHex: string, toHex: string, amount: number): string {
  const from = parseHexColor(fromHex);
  const to = parseHexColor(toHex);
  const clamped = Math.min(1, Math.max(0, amount));
  const channels = [0, 1, 2].map((channel) => Math.round(from[channel] + (to[channel] - from[channel]) * clamped));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseHexColor(value: string): [number, number, number] {
  const normalized = value.replace("#", "");
  if (normalized.length !== 6) {
    return [255, 255, 255];
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

/**
 * A giant's pass: it enters at approachDistance, crosses in front of the
 * camera and leaves, then waits before coming round again.
 *
 * Returns null while the giant is off stage, which is the point — a giant that
 * is always visible is a prop, and the config's passDurationSeconds is how long
 * it gets to be a moment instead.
 */
export type GiantPassState = {
  x: number;
  z: number;
  headingRadians: number;
  /** 0 at the edges of the pass, 1 in the middle — drives the fade. */
  presence: number;
};

const GIANT_REST_MULTIPLIER = 1.8;

export function giantPassStateAt(
  passSeed: string,
  approachDistance: number,
  passDurationSeconds: number,
  elapsedSeconds: number
): GiantPassState | null {
  const nextRandomValue = randomFromSeed(passSeed);
  const crossingAngle = nextRandomValue() * Math.PI * 2;
  const startOffset = nextRandomValue();
  const cycleSeconds = passDurationSeconds * GIANT_REST_MULTIPLIER;
  const cycleProgress = ((elapsedSeconds / cycleSeconds + startOffset) % 1 + 1) % 1;
  const passProgress = cycleProgress / (1 / GIANT_REST_MULTIPLIER);
  if (passProgress > 1) {
    return null;
  }
  // Travels across the full diameter of the visible sphere, so it arrives out
  // of the fog on one side and leaves into it on the other.
  const travel = (passProgress - 0.5) * approachDistance * 2;
  const lateral = approachDistance * 0.85;
  const x = Math.cos(crossingAngle) * travel - Math.sin(crossingAngle) * lateral;
  const z = Math.sin(crossingAngle) * travel + Math.cos(crossingAngle) * lateral;
  const edgeFade = Math.sin(Math.PI * Math.min(1, Math.max(0, passProgress)));
  return { x, z, headingRadians: crossingAngle, presence: edgeFade };
}
