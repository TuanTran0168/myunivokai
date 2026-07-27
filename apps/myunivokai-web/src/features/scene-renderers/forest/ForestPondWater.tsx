"use client";

import { useMemo, useRef } from "react";
import { MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, Vector2, type Texture } from "three";

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

type ForestPondWaterProps = {
  radius: number;
  /** Landmark accent, mixed into the water tint so ponds stay per-world. */
  tintColor: string;
};

export function ForestPondWater({ radius, tintColor }: ForestPondWaterProps) {
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

  return (
    <mesh position={[0, WATER_SURFACE_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[radius, 48]} />
      <MeshReflectorMaterial
        // Reflection is intentionally soft: a mirror-sharp pond looks like
        // polished chrome, while a blurred one reads as water under a breeze.
        resolution={512}
        mixBlur={0.85}
        mixStrength={2.2}
        blur={[220, 60]}
        mirror={0.55}
        // Shallow edges stay lighter and more transparent than the middle,
        // which is what stops the disc from looking like a cut-out hole.
        depthScale={0.9}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.2}
        depthToBlurRatioBias={0.3}
        color={tintColor}
        roughness={0.28}
        metalness={0.1}
        normalMap={rippleTexture as unknown as Texture}
        normalScale={NORMAL_STRENGTH}
      />
    </mesh>
  );
}
