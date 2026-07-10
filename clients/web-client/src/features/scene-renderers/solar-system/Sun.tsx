"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, TextureLoader } from "three";
import type { Mesh } from "three";
import type { SceneCoreConfig } from "@/lib/types";
import { applyColorTextureQuality } from "../shared/textureQuality";
import { SUN_TEXTURE_URL } from "./planetTextureCatalog";

const DEFAULT_SUN_SCALE = 1.1;
const SUN_SCALE_MULTIPLIER = 1.45;
const DEFAULT_SUN_SPIN_SPEED = 0.05;
const SUN_LIGHT_INTENSITY = 38;
const SUN_LIGHT_DECAY = 1.6;
const SUN_GLOW_SCALE_MULTIPLIER = 1.22;
const SUN_GLOW_OPACITY = 0.32;
const SUN_GLOW_COLOR = "#FDB813";

type SunProps = {
  coreConfig?: SceneCoreConfig;
};

/**
 * The sun replaces the abstract "core" of the universe. A texture-mapped basic
 * material (not affected by lighting) plus the bloom pass make it glow; the
 * point light at its center is the single light source for the planets.
 */
export function Sun({ coreConfig }: SunProps) {
  const sunMeshReference = useRef<Mesh>(null);
  const gl = useThree((state) => state.gl);
  const sunTexture = useLoader(TextureLoader, SUN_TEXTURE_URL);
  useMemo(() => applyColorTextureQuality(sunTexture, gl), [sunTexture, gl]);
  const sunScale = (coreConfig?.scale ?? DEFAULT_SUN_SCALE) * SUN_SCALE_MULTIPLIER;
  const sunSpinSpeed = coreConfig?.spinSpeed ?? DEFAULT_SUN_SPIN_SPEED;

  useFrame((_, deltaTimeSeconds) => {
    if (!sunMeshReference.current) {
      return;
    }
    sunMeshReference.current.rotation.y += sunSpinSpeed * deltaTimeSeconds;
  });

  return (
    <group>
      <mesh ref={sunMeshReference} scale={sunScale}>
        <sphereGeometry args={[1, 96, 64]} />
        <meshBasicMaterial map={sunTexture} toneMapped={false} />
      </mesh>
      <mesh scale={sunScale * SUN_GLOW_SCALE_MULTIPLIER}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial
          color={SUN_GLOW_COLOR}
          transparent
          opacity={SUN_GLOW_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight intensity={SUN_LIGHT_INTENSITY} decay={SUN_LIGHT_DECAY} color="#FFF4D6" />
    </group>
  );
}
