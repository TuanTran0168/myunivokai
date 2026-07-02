"use client";

import { useLoader } from "@react-three/fiber";
import { BackSide, TextureLoader } from "three";
import { MILKY_WAY_SKYBOX_TEXTURE_URL } from "./planetTextureCatalog";

const SKYBOX_RADIUS = 60;

export function Skybox() {
  const milkyWayTexture = useLoader(TextureLoader, MILKY_WAY_SKYBOX_TEXTURE_URL);

  return (
    <mesh>
      <sphereGeometry args={[SKYBOX_RADIUS, 48, 32]} />
      {/* Opaque + depthWrite=false: as a transparent material the skybox was
          distance-sorted against the star/constellation point layers, and the
          flipping draw order made them blink while orbiting. Opaque renders
          first, always behind everything. toneMapped=false: ACES tone mapping
          crushes the already-dark starfield texture. */}
      <meshBasicMaterial map={milkyWayTexture} side={BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
