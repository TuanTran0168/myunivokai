"use client";

import { useMemo, useRef } from "react";
import { MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  Vector2,
  type Texture
} from "three";
import { createWaterOutline, type WaterOutline } from "./forestMath";

// Real-looking pond water. The old pond was a flat disc with metalness 0.85 and
// roughness 0.12 — a shiny blue coin: it reflected nothing (an HDRI alone gives
// a mirror no scene content), never moved, and had no depth.
//
// Two things make water read as water, and both are here:
//  1. TRUE reflection of the actual scene — MeshReflectorMaterial renders the
//     surrounding trees and sky into the surface, so the pond is visibly part
//     of the forest instead of a hole in it.
//  2. MOVEMENT — a tiling ripple normal map, scrolled in two directions at
//     different speeds so the interference never visibly loops.
//
// The ripple map is generated procedurally rather than downloaded: it is a sum
// of sines, so it is exactly tileable (a photo-sourced normal map would seam),
// costs no bytes, and carries no attribution obligation.

const RIPPLE_TEXTURE_SIZE = 128;
const RIPPLE_WAVE_COUNT = 4;
const RIPPLE_TEXTURE_REPEAT = 3;

// Two scroll layers; different speeds/directions so the crests keep
// re-interfering instead of marching in lockstep.
const PRIMARY_SCROLL_SPEED = new Vector2(0.021, 0.013);
const SECONDARY_SCROLL_SPEED = new Vector2(-0.011, 0.017);

const WATER_SURFACE_HEIGHT = 0.03;
const NORMAL_STRENGTH = new Vector2(0.22, 0.22);

/**
 * A tileable ripple normal map built from summed sine waves. Each wave uses
 * INTEGER frequencies over the texture, which is what guarantees the result
 * wraps seamlessly when the texture repeats.
 */
function createRippleNormalTexture(): DataTexture {
  const size = RIPPLE_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  // Fixed wave set (not seeded): water looks the same everywhere, and keeping
  // it constant lets every pond in every world share one texture upload.
  const waves = Array.from({ length: RIPPLE_WAVE_COUNT }, (_, waveIndex) => {
    const harmonic = waveIndex + 1;
    const angle = (waveIndex * Math.PI * 2) / RIPPLE_WAVE_COUNT + 0.4;
    return {
      frequencyX: Math.round(Math.cos(angle) * harmonic),
      frequencyY: Math.round(Math.sin(angle) * harmonic),
      amplitude: 1 / harmonic
    };
  });

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Analytic derivatives of the height field give the surface slope
      // directly — no finite differencing, so the normals stay smooth.
      let slopeX = 0;
      let slopeY = 0;
      for (const wave of waves) {
        const phase = wave.frequencyX * u + wave.frequencyY * v;
        slopeX += wave.amplitude * wave.frequencyX * Math.cos(phase);
        slopeY += wave.amplitude * wave.frequencyY * Math.cos(phase);
      }
      // Pack the slope as a tangent-space normal.
      const normalX = -slopeX;
      const normalY = -slopeY;
      const normalZ = 4; // keeps the ripples shallow rather than spiky
      const length = Math.hypot(normalX, normalY, normalZ) || 1;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(((normalX / length) * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round(((normalY / length) * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round(((normalZ / length) * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.repeat.set(RIPPLE_TEXTURE_REPEAT, RIPPLE_TEXTURE_REPEAT);
  texture.needsUpdate = true;
  return texture;
}

// One shared ripple texture for every pond in the app.
let sharedRippleTexture: DataTexture | null = null;
export function getRippleNormalTexture(): DataTexture {
  if (!sharedRippleTexture) {
    sharedRippleTexture = createRippleNormalTexture();
  }
  return sharedRippleTexture;
}

/**
 * Fan-triangulated disc whose boundary follows a seeded organic outline instead
 * of a circle. Built in the XY plane so the caller's existing -PI/2 X rotation
 * still lays it flat, and UVs are generated so the ripple normal map tiles
 * across it in world-ish proportions.
 */
function buildOrganicWaterDiscGeometry(radius: number, outline: WaterOutline): BufferGeometry {
  const vertexCount = outline.segments + 2; // centre + boundary ring (closed)
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  uvs[0] = 0.5;
  uvs[1] = 0.5;
  for (let segmentIndex = 0; segmentIndex <= outline.segments; segmentIndex += 1) {
    const angle = (segmentIndex / outline.segments) * Math.PI * 2;
    const boundaryRadius = radius * outline.radiusFactorAt(angle);
    const x = Math.cos(angle) * boundaryRadius;
    const y = Math.sin(angle) * boundaryRadius;
    const vertexIndex = segmentIndex + 1;
    positions[vertexIndex * 3] = x;
    positions[vertexIndex * 3 + 1] = y;
    uvs[vertexIndex * 2] = 0.5 + x / (radius * 2);
    uvs[vertexIndex * 2 + 1] = 0.5 + y / (radius * 2);
    if (segmentIndex > 0) {
      indices.push(0, vertexIndex - 1, vertexIndex);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type ForestPondWaterProps = {
  /** MEAN radius: the organic outline varies around it. */
  radius: number;
  /** Landmark accent, mixed into the water tint so ponds stay per-world. */
  tintColor: string;
  /** Drives the shoreline shape; same seed, same lake. */
  shapeSeed: string;
  /**
   * True render-to-texture mirror. Costs a whole extra scene render, so only
   * the hero lake gets it — small ponds fall back to environment reflection,
   * which is indistinguishable at their size.
   */
  reflective?: boolean;
};

export function ForestPondWater({ radius, tintColor, shapeSeed, reflective = true }: ForestPondWaterProps) {
  const rippleTexture = useMemo(() => getRippleNormalTexture(), []);
  // The second layer is a clone so the two can scroll independently while
  // sharing the same GPU image.
  const secondaryRippleTexture = useMemo(() => {
    const clone = rippleTexture.clone();
    clone.needsUpdate = true;
    return clone;
  }, [rippleTexture]);
  const elapsedSecondsRef = useRef(0);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    rippleTexture.offset.set(
      elapsedSeconds * PRIMARY_SCROLL_SPEED.x,
      elapsedSeconds * PRIMARY_SCROLL_SPEED.y
    );
    secondaryRippleTexture.offset.set(
      elapsedSeconds * SECONDARY_SCROLL_SPEED.x,
      elapsedSeconds * SECONDARY_SCROLL_SPEED.y
    );
  });

  const outline = useMemo(() => createWaterOutline(shapeSeed), [shapeSeed]);
  const geometry = useMemo(() => buildOrganicWaterDiscGeometry(radius, outline), [outline, radius]);

  return (
    <mesh geometry={geometry} position={[0, WATER_SURFACE_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      {reflective ? (
        <MeshReflectorMaterial
          // Tuned DOWN from the first pass, which blew out into white patches
          // with a visible grid: mixStrength 2.2 pushed the reflection well past
          // the sky's own brightness, and the depth-blend parameters
          // (depthScale/minDepthThreshold/...) need a depth buffer that the
          // alpha-masked foliage in this scene does not populate cleanly, so they
          // banded. Reflection is now support, not the dominant term.
          resolution={512}
          mixBlur={1}
          mixStrength={0.8}
          blur={[140, 40]}
          mirror={0.4}
          color={tintColor}
          roughness={0.35}
          metalness={0.2}
          normalMap={rippleTexture as unknown as Texture}
          normalScale={NORMAL_STRENGTH}
        />
      ) : (
        <meshStandardMaterial
          color={tintColor}
          transparent
          opacity={0.9}
          roughness={0.16}
          metalness={0.3}
          envMapIntensity={1.5}
          normalMap={rippleTexture as unknown as Texture}
          normalScale={NORMAL_STRENGTH}
        />
      )}
    </mesh>
  );
}

/** Shoreline band hugging the same outline, so the bank is never a clean arc. */
export function ForestWaterShoreline({
  radius,
  shapeSeed,
  bandWidth,
  color,
  height
}: {
  radius: number;
  shapeSeed: string;
  bandWidth: number;
  color: string;
  height: number;
}) {
  const outline = useMemo(() => createWaterOutline(shapeSeed), [shapeSeed]);
  const geometry = useMemo(() => {
    const inner = buildOrganicWaterDiscGeometry(radius + bandWidth, outline);
    return inner;
  }, [bandWidth, outline, radius]);

  return (
    <mesh geometry={geometry} position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}
