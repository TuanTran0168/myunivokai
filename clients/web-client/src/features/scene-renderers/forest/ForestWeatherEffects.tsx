"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial
} from "three";
import type { ForestLightingConfig, ForestTerrainConfig, ForestWeatherConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "@/features/scene-renderers/shared/softCircleTexture";
import { clampValue, treelineRadiusFromTerrain } from "./forestMath";
import { sunDirectionFromLighting } from "./ForestSkyDome";

const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

const CLOUD_SCATTER_SEED_SUFFIX = "-clouds";
const RAIN_SCATTER_SEED_SUFFIX = "-rain";
const SNOW_SCATTER_SEED_SUFFIX = "-snowfall";
const SUN_RAY_SCATTER_SEED_SUFFIX = "-sunrays";

const MINIMUM_CLOUD_SPRITE_COUNT = 3;
const CLOUD_SPRITE_COUNT_PER_COVERAGE = 12;
const CLOUD_ALTITUDE_MINIMUM = 32;
const CLOUD_ALTITUDE_RANGE = 14;
const CLOUD_SCALE_MINIMUM = 16;
const CLOUD_SCALE_RANGE = 22;
const CLOUD_BASE_OPACITY = 0.16;
const CLOUD_OPACITY_PER_COVERAGE = 0.3;
const CLOUD_DRIFT_RADIANS_PER_SECOND = 0.004;
const CLOUD_SUNNY_COLOR = "#FFFFFF";
const CLOUD_OVERCAST_COLOR = "#8E99A8";

const PRECIPITATION_CEILING = 24;
const RAIN_FALL_SPEED_BASE = 15;
const RAIN_FALL_SPEED_PER_INTENSITY = 10;
const RAIN_POINT_SIZE = 0.07;
const RAIN_COLOR = "#A9BFD4";
const RAIN_OPACITY = 0.55;

const SNOW_FALL_SPEED_BASE = 1.4;
const SNOW_FALL_SPEED_PER_INTENSITY = 1.6;
const SNOW_SWAY_AMPLITUDE = 0.9;
const SNOW_SWAY_FREQUENCY = 0.7;
const SNOW_POINT_SIZE = 0.14;
const SNOW_COLOR = "#F4F8FC";
const SNOW_OPACITY = 0.9;

const SUN_RAY_SHAFT_COUNT = 6;
const SUN_RAY_LENGTH = 20;
const SUN_RAY_WIDTH = 1.6;
const SUN_RAY_BASE_OPACITY = 0.035;
const SUN_RAY_OPACITY_PER_INTENSITY = 0.045;

type ForestWeatherEffectsProps = {
  weather?: ForestWeatherConfig;
  lighting?: ForestLightingConfig;
  terrain?: ForestTerrainConfig;
  placementSeed: string;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
}

type PrecipitationLayerProps = {
  particleCount: number;
  areaRadius: number;
  seed: string;
  kind: "rain" | "snow";
  intensity: number;
};

/**
 * One falling-particle system (rain or snow). Positions live in a plain
 * Float32 buffer mutated per frame — thousands of drops stay one draw call.
 */
function PrecipitationLayer({ particleCount, areaRadius, seed, kind, intensity }: PrecipitationLayerProps) {
  const pointsRef = useRef<Points>(null);
  const elapsedSecondsRef = useRef(0);

  const { geometry, material, swayPhases } = useMemo(() => {
    const nextRandomValue = randomFromSeed(seed);
    const positions = new Float32Array(particleCount * 3);
    const phases = new Float32Array(particleCount);
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = Math.sqrt(nextRandomValue()) * areaRadius;
      positions[particleIndex * 3] = Math.cos(angle) * radius;
      positions[particleIndex * 3 + 1] = nextRandomValue() * PRECIPITATION_CEILING;
      positions[particleIndex * 3 + 2] = Math.sin(angle) * radius;
      phases[particleIndex] = nextRandomValue() * Math.PI * 2;
    }
    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const pointsMaterial = new PointsMaterial({
      color: new Color(kind === "rain" ? RAIN_COLOR : SNOW_COLOR),
      size: kind === "rain" ? RAIN_POINT_SIZE : SNOW_POINT_SIZE,
      transparent: true,
      opacity: kind === "rain" ? RAIN_OPACITY : SNOW_OPACITY,
      map: getSoftCircleTexture() ?? undefined,
      depthWrite: false,
      sizeAttenuation: true
    });
    return { geometry: bufferGeometry, material: pointsMaterial, swayPhases: phases };
  }, [areaRadius, kind, particleCount, seed]);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    const positionAttribute = geometry.getAttribute("position");
    const fallSpeed =
      kind === "rain"
        ? RAIN_FALL_SPEED_BASE + intensity * RAIN_FALL_SPEED_PER_INTENSITY
        : SNOW_FALL_SPEED_BASE + intensity * SNOW_FALL_SPEED_PER_INTENSITY;
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      let particleY = positionAttribute.getY(particleIndex) - fallSpeed * deltaTimeSeconds;
      if (particleY < 0) {
        particleY += PRECIPITATION_CEILING;
      }
      positionAttribute.setY(particleIndex, particleY);
      if (kind === "snow") {
        // Snow drifts sideways as it falls; rain drops dead straight.
        const swayPhase = swayPhases[particleIndex];
        const baseX = positionAttribute.getX(particleIndex);
        positionAttribute.setX(
          particleIndex,
          baseX + Math.sin(elapsedSeconds * SNOW_SWAY_FREQUENCY + swayPhase) * SNOW_SWAY_AMPLITUDE * deltaTimeSeconds
        );
      }
    }
    positionAttribute.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

/**
 * The weather layer: drifting cloud sprites scaled by coverage, rain or snow
 * particle systems gated by the weather kind (counts straight from config),
 * and additive light shafts for sunRays.
 */
export function ForestWeatherEffects({ weather, lighting, terrain, placementSeed }: ForestWeatherEffectsProps) {
  const cloudGroupRef = useRef<Group>(null);
  const treelineRadius = treelineRadiusFromTerrain(terrain);
  const weatherKind = weather?.kind ?? "clear";
  const intensity = clampValue(weather?.intensity ?? 0.5, 0, 1);
  const cloudCoverage = clampValue(weather?.cloudCoverage ?? 0.15, 0, 1);

  const cloudSprites = useMemo(() => {
    const cloudCount = MINIMUM_CLOUD_SPRITE_COUNT + Math.round(cloudCoverage * CLOUD_SPRITE_COUNT_PER_COVERAGE);
    const nextRandomValue = randomFromSeed(placementSeed + CLOUD_SCATTER_SEED_SUFFIX);
    return Array.from({ length: cloudCount }, (_, cloudIndex) => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = nextRandomValue() * treelineRadius * 1.6;
      const altitude = CLOUD_ALTITUDE_MINIMUM + nextRandomValue() * CLOUD_ALTITUDE_RANGE;
      const scale = CLOUD_SCALE_MINIMUM + nextRandomValue() * CLOUD_SCALE_RANGE;
      return {
        key: `cloud-${cloudIndex}`,
        position: [Math.cos(angle) * radius, altitude, Math.sin(angle) * radius] as [number, number, number],
        scale
      };
    });
  }, [cloudCoverage, placementSeed, treelineRadius]);

  const sunRayShafts = useMemo(() => {
    if (weatherKind !== "sunRays") {
      return [];
    }
    const nextRandomValue = randomFromSeed(placementSeed + SUN_RAY_SCATTER_SEED_SUFFIX);
    const sunDirection = sunDirectionFromLighting(lighting);
    const shaftTiltRadians = Math.atan2(Math.hypot(sunDirection.x, sunDirection.z), sunDirection.y);
    const sunAzimuthRadians = Math.atan2(sunDirection.z, sunDirection.x);
    return Array.from({ length: SUN_RAY_SHAFT_COUNT }, (_, shaftIndex) => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radius = nextRandomValue() * treelineRadius * 0.5;
      return {
        key: `sun-ray-${shaftIndex}`,
        position: [Math.cos(angle) * radius, SUN_RAY_LENGTH * 0.45, Math.sin(angle) * radius] as [number, number, number],
        rotation: [shaftTiltRadians * 0.8, -sunAzimuthRadians + Math.PI / 2, 0] as [number, number, number],
        widthScale: 0.7 + nextRandomValue() * 0.8
      };
    });
  }, [lighting, placementSeed, treelineRadius, weatherKind]);

  useFrame((_, deltaTimeSeconds) => {
    if (cloudGroupRef.current) {
      cloudGroupRef.current.rotation.y += CLOUD_DRIFT_RADIANS_PER_SECOND * deltaTimeSeconds;
    }
  });

  const softCircleTexture = getSoftCircleTexture();
  const mobileViewport = isMobileViewport();
  const rainDropCount = mobileViewport ? weather?.rainDropCountMobile ?? 0 : weather?.rainDropCountDesktop ?? 0;
  const snowflakeCount = mobileViewport ? weather?.snowflakeCountMobile ?? 0 : weather?.snowflakeCountDesktop ?? 0;
  const cloudColor = useMemo(
    () => new Color(CLOUD_SUNNY_COLOR).lerp(new Color(CLOUD_OVERCAST_COLOR), cloudCoverage),
    [cloudCoverage]
  );

  return (
    <group>
      {softCircleTexture ? (
        <group ref={cloudGroupRef}>
          {cloudSprites.map((cloud) => (
            <sprite key={cloud.key} position={cloud.position} scale={[cloud.scale, cloud.scale * 0.45, 1]}>
              <spriteMaterial
                map={softCircleTexture}
                color={cloudColor}
                transparent
                opacity={CLOUD_BASE_OPACITY + cloudCoverage * CLOUD_OPACITY_PER_COVERAGE}
                depthWrite={false}
              />
            </sprite>
          ))}
        </group>
      ) : null}

      {weatherKind === "rain" && rainDropCount > 0 ? (
        <PrecipitationLayer
          particleCount={rainDropCount}
          areaRadius={treelineRadius}
          seed={placementSeed + RAIN_SCATTER_SEED_SUFFIX}
          kind="rain"
          intensity={intensity}
        />
      ) : null}

      {weatherKind === "snow" && snowflakeCount > 0 ? (
        <PrecipitationLayer
          particleCount={snowflakeCount}
          areaRadius={treelineRadius}
          seed={placementSeed + SNOW_SCATTER_SEED_SUFFIX}
          kind="snow"
          intensity={intensity}
        />
      ) : null}

      {sunRayShafts.map((shaft) => (
        <mesh key={shaft.key} position={shaft.position} rotation={shaft.rotation}>
          <planeGeometry args={[SUN_RAY_WIDTH * shaft.widthScale, SUN_RAY_LENGTH]} />
          <meshBasicMaterial
            color={lighting?.sunColor ?? "#FFF6E5"}
            transparent
            opacity={SUN_RAY_BASE_OPACITY + intensity * SUN_RAY_OPACITY_PER_INTENSITY}
            blending={AdditiveBlending}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
