"use client";

import { useLoader } from "@react-three/fiber";
import { BackSide, TextureLoader } from "three";
import { MILKY_WAY_SKYBOX_TEXTURE_URL } from "./planetTextureCatalog";

const SKYBOX_RADIUS = 60;
const SKYBOX_OPACITY = 0.85;

export function Skybox() {
  const milkyWayTexture = useLoader(TextureLoader, MILKY_WAY_SKYBOX_TEXTURE_URL);

  return (
    <mesh>
      <sphereGeometry args={[SKYBOX_RADIUS, 48, 32]} />
      <meshBasicMaterial map={milkyWayTexture} side={BackSide} transparent opacity={SKYBOX_OPACITY} />
    </mesh>
  );
}
