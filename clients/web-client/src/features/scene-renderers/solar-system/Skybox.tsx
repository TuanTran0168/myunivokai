"use client";

import { useLoader } from "@react-three/fiber";
import { BackSide, TextureLoader } from "three";
import { MILKY_WAY_SKYBOX_TEXTURE_URL } from "./planetTextureCatalog";

const SKYBOX_RADIUS = 60;
// Full opacity so the Milky Way band reads clearly instead of sinking into
// the background color.
const SKYBOX_OPACITY = 1;

export function Skybox() {
  const milkyWayTexture = useLoader(TextureLoader, MILKY_WAY_SKYBOX_TEXTURE_URL);

  return (
    <mesh>
      <sphereGeometry args={[SKYBOX_RADIUS, 48, 32]} />
      {/* toneMapped=false: ACES tone mapping crushes the already-dark starfield
          texture; raw output keeps the Milky Way band clearly visible. */}
      <meshBasicMaterial map={milkyWayTexture} side={BackSide} transparent opacity={SKYBOX_OPACITY} toneMapped={false} />
    </mesh>
  );
}
