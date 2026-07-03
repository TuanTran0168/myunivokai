"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Vector3, type Group } from "three";
import type { SceneConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getSoftCircleTexture } from "../shared/softCircleTexture";
import { ZODIAC_CONSTELLATIONS } from "./constellationCatalog";

/**
 * Real zodiac constellations on the celestial sphere. The seed picks WHICH
 * figures appear, WHERE they sit and how they are rotated — so every world
 * still has its own personal sky — but the figures themselves are the
 * recognizable star-map shapes from the catalog, drawn like classic
 * constellation art: big glowing anchor stars, small companion stars, thin
 * connecting lines. Colors follow the world style (theme) and the glow
 * strength follows the mood (via the mood-driven bloom intensity).
 */

const CONSTELLATION_DISPLAY_COUNT = 8;
// Just inside the Skybox sphere (radius 60) so stars never clip through it.
const CELESTIAL_SPHERE_RADIUS = 52;
// Chord size of one figure's patch on the unit sphere (~24 degrees of sky).
const CONSTELLATION_PATCH_SIZE = 0.42;
// Bias anchors away from the poles, where the tangent patch distorts.
const POLE_AVOIDANCE_RATIO = 0.7;
// The figures drift a touch faster than the Milky Way behind them, giving
// the sky gentle parallax while orbiting.
const CONSTELLATION_ROTATION_RADIANS_PER_SECOND = 0.005;

const MAJOR_STAR_POINT_SIZE = 1.25;
const MINOR_STAR_POINT_SIZE = 0.6;
const STAR_OPACITY = 0.95;
const LINE_OPACITY = 0.32;
// Mood (via bloom intensity) scales the glow; clamped so a reflective world
// stays readable and an energetic one does not blow out.
const MINIMUM_MOOD_GLOW_MULTIPLIER = 0.7;
const MAXIMUM_MOOD_GLOW_MULTIPLIER = 1.3;

type ConstellationTint = {
  starColor: string;
  lineColor: string;
};

// One tint pair per world style, so switching the style visibly recolors the
// night sky along with the orbits.
const THEME_CONSTELLATION_TINTS: Record<string, ConstellationTint> = {
  "cosmic-galaxy": { starColor: "#EAF2FF", lineColor: "#8FB6FF" },
  nebula: { starColor: "#F3E8FF", lineColor: "#C084FC" },
  crystal: { starColor: "#EAFBFF", lineColor: "#7DD3FC" },
  aurora: { starColor: "#ECFFF6", lineColor: "#6EE7B7" },
  "cyber-orbit": { starColor: "#E6FDFF", lineColor: "#22D3EE" }
};
const DEFAULT_CONSTELLATION_TINT: ConstellationTint = { starColor: "#F2EEE6", lineColor: "#D9B96E" };

type ConstellationFieldProps = {
  seed: string;
  scene: SceneConfig;
};

type ConstellationGeometry = {
  majorStarPositions: Float32Array;
  minorStarPositions: Float32Array;
  linePositions: Float32Array;
};

const WORLD_UP = new Vector3(0, 1, 0);

function buildConstellationGeometry(seed: string): ConstellationGeometry {
  const random = randomFromSeed(`${seed}-constellations`);
  const majorStarVertices: number[] = [];
  const minorStarVertices: number[] = [];
  const lineVertices: number[] = [];

  // Seeded shuffle picks which zodiac figures this world's sky shows.
  const figureIndices = ZODIAC_CONSTELLATIONS.map((_, figureIndex) => figureIndex);
  for (let shuffleIndex = figureIndices.length - 1; shuffleIndex > 0; shuffleIndex -= 1) {
    const swapIndex = Math.floor(random() * (shuffleIndex + 1));
    [figureIndices[shuffleIndex], figureIndices[swapIndex]] = [figureIndices[swapIndex], figureIndices[shuffleIndex]];
  }
  const chosenFigures = figureIndices.slice(0, CONSTELLATION_DISPLAY_COUNT);

  for (const figureIndex of chosenFigures) {
    const figure = ZODIAC_CONSTELLATIONS[figureIndex];

    // Anchor direction on the sphere + a tangent-plane basis around it.
    const anchorAzimuthRadians = random() * Math.PI * 2;
    const anchorPolarRadians = Math.acos((random() * 2 - 1) * POLE_AVOIDANCE_RATIO);
    const anchorDirection = new Vector3(
      Math.sin(anchorPolarRadians) * Math.cos(anchorAzimuthRadians),
      Math.cos(anchorPolarRadians),
      Math.sin(anchorPolarRadians) * Math.sin(anchorAzimuthRadians)
    );
    const tangentEast = new Vector3().crossVectors(WORLD_UP, anchorDirection).normalize();
    const tangentNorth = new Vector3().crossVectors(anchorDirection, tangentEast).normalize();

    // Each figure gets a seeded roll so the same constellation can appear in
    // any orientation, like a real star map turned overhead.
    const patchRollRadians = random() * Math.PI * 2;
    const rollCosine = Math.cos(patchRollRadians);
    const rollSine = Math.sin(patchRollRadians);

    const starPointsOnSphere: Vector3[] = figure.stars.map((star) => {
      const centeredX = star.x - 0.5;
      const centeredY = star.y - 0.5;
      const rolledX = centeredX * rollCosine - centeredY * rollSine;
      const rolledY = centeredX * rollSine + centeredY * rollCosine;
      return new Vector3()
        .copy(anchorDirection)
        .addScaledVector(tangentEast, rolledX * CONSTELLATION_PATCH_SIZE)
        .addScaledVector(tangentNorth, rolledY * CONSTELLATION_PATCH_SIZE)
        .normalize()
        .multiplyScalar(CELESTIAL_SPHERE_RADIUS);
    });

    figure.stars.forEach((star, starIndex) => {
      const target = star.isMajor ? majorStarVertices : minorStarVertices;
      const point = starPointsOnSphere[starIndex];
      target.push(point.x, point.y, point.z);
    });

    for (const [fromIndex, toIndex] of figure.lineIndexPairs) {
      const fromPoint = starPointsOnSphere[fromIndex];
      const toPoint = starPointsOnSphere[toIndex];
      lineVertices.push(fromPoint.x, fromPoint.y, fromPoint.z, toPoint.x, toPoint.y, toPoint.z);
    }
  }

  return {
    majorStarPositions: new Float32Array(majorStarVertices),
    minorStarPositions: new Float32Array(minorStarVertices),
    linePositions: new Float32Array(lineVertices)
  };
}

export function ConstellationField({ seed, scene }: ConstellationFieldProps) {
  const { majorStarPositions, minorStarPositions, linePositions } = useMemo(
    () => buildConstellationGeometry(seed),
    [seed]
  );
  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);
  const constellationGroupReference = useRef<Group>(null);

  const tint = THEME_CONSTELLATION_TINTS[scene.theme ?? ""] ?? DEFAULT_CONSTELLATION_TINT;
  const moodGlowMultiplier = Math.min(
    MAXIMUM_MOOD_GLOW_MULTIPLIER,
    Math.max(MINIMUM_MOOD_GLOW_MULTIPLIER, scene.postFX?.bloomIntensity ?? 1)
  );
  const starOpacity = Math.min(1, STAR_OPACITY * moodGlowMultiplier);
  const lineOpacity = Math.min(1, LINE_OPACITY * moodGlowMultiplier);

  useFrame((_, deltaSeconds) => {
    if (constellationGroupReference.current) {
      constellationGroupReference.current.rotation.y += CONSTELLATION_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  return (
    <group ref={constellationGroupReference}>
      {/* frustumCulled=false everywhere: the auto bounding sphere of
          hand-built buffer geometry misjudges these sky-wide shells, so
          orbiting the camera made whole constellations pop in and out. */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={majorStarPositions.length / 3}
            array={majorStarPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={tint.starColor}
          size={MAJOR_STAR_POINT_SIZE}
          transparent
          opacity={starOpacity}
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
            count={minorStarPositions.length / 3}
            array={minorStarPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          map={softCircleTexture ?? undefined}
          alphaTest={0.01}
          color={tint.starColor}
          size={MINOR_STAR_POINT_SIZE}
          transparent
          opacity={starOpacity}
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
          color={tint.lineColor}
          transparent
          opacity={lineOpacity}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
