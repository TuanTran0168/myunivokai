"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import type { SceneConfig } from "@/lib/types";
import { paletteFromScene, randomFromSeed } from "@/lib/scene";

type UniverseCanvasProps = {
  scene?: SceneConfig;
  className?: string;
};

type Body = {
  color: string;
  position: [number, number, number];
  scale: number;
  speed: number;
};

function Universe({ scene }: { scene?: SceneConfig }) {
  const group = useRef<Group>(null);
  const seed = String(scene?.seed ?? "myunivokai");
  const palette = paletteFromScene(scene);

  const bodies = useMemo<Body[]>(() => {
    const random = randomFromSeed(seed);
    return Array.from({ length: 18 }, (_, index) => {
      const radius = 1.4 + random() * 3.8;
      const angle = random() * Math.PI * 2;
      const height = -0.55 + random() * 1.7;
      return {
        color: palette[index % palette.length],
        position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius],
        scale: 0.12 + random() * 0.42,
        speed: 0.15 + random() * 0.38
      };
    });
  }, [palette, seed]);

  useFrame(({ clock }) => {
    if (!group.current) {
      return;
    }
    group.current.rotation.y = clock.elapsedTime * 0.08;
  });

  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[4, 7, 3]} intensity={1.35} />
      <pointLight position={[-4, -2, -3]} intensity={2.2} color={palette[1]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}>
        <ringGeometry args={[1.25, 5.8, 96]} />
        <meshStandardMaterial color={palette[3]} roughness={0.86} metalness={0.08} transparent opacity={0.18} />
      </mesh>
      <group ref={group}>
        <mesh>
          <icosahedronGeometry args={[0.92, 2]} />
          <meshStandardMaterial color={palette[0]} roughness={0.44} metalness={0.18} />
        </mesh>
        {bodies.map((body, index) => (
          <group key={`${seed}-${index}`} rotation={[0, index * body.speed, 0]}>
            <mesh position={body.position}>
              {index % 3 === 0 ? <octahedronGeometry args={[body.scale, 1]} /> : <sphereGeometry args={[body.scale, 24, 16]} />}
              <meshStandardMaterial color={body.color} roughness={0.52} metalness={0.24} />
            </mesh>
          </group>
        ))}
      </group>
    </>
  );
}

export function UniverseCanvas({ scene, className }: UniverseCanvasProps) {
  return (
    <div className={`relative h-full min-h-[320px] overflow-hidden bg-surface-lowest ${className ?? ""}`}>
      <Canvas camera={{ position: [0, 2.4, 7.2], fov: 47 }} dpr={[1, 1.8]}>
        <color attach="background" args={["#101418"]} />
        <fog attach="fog" args={["#101418", 7, 13]} />
        <Universe scene={scene} />
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-lowest/65 to-transparent" />
    </div>
  );
}
