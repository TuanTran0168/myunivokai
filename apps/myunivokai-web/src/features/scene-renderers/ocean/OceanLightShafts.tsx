"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, DoubleSide, Group, Mesh, PlaneGeometry } from "three";
import type { OceanLightingConfig, OceanSeafloorConfig, OceanWaterConfig } from "@/lib/types";
import { randomFromSeed } from "@/lib/scene";
import { getLightShaftTexture } from "@/features/scene-renderers/shared/lightShaftTexture";
import { createCausticTexture } from "./oceanCausticTexture";
import { basinRadiusFromSeafloor, type SeafloorHeightSampler } from "./oceanMath";

// God rays and caustics, both driven by numbers the depth curve already
// decided.
//
// NOTHING HERE ASKS WHICH ZONE THIS IS. godRayStrength and causticStrength
// reach exactly zero on their own as depth crosses the sunlight floor, so an
// abyssal world renders no shafts and no caustics because the arithmetic says
// so — which is the whole reason one renderer covers a sunlit reef and an
// abyssal trench without a mode flag.

const SHAFT_COUNT = 14;
const SHAFT_HEIGHT = 34;
const SHAFT_WIDTH_BASE = 2.2;
const SHAFT_WIDTH_RANGE = 3.4;
const SHAFT_MAXIMUM_OPACITY = 0.3;
const SHAFT_SWAY_SPEED = 0.18;
const SHAFT_SWAY_RADIANS = 0.04;

const CAUSTIC_MAXIMUM_OPACITY = 0.28;
const CAUSTIC_SCROLL_SPEED = 0.035;
const CAUSTIC_SEGMENTS = 48;
const CAUSTIC_FLOOR_OFFSET = 0.06;

type OceanLightShaftsProps = {
  lighting?: OceanLightingConfig;
  water?: OceanWaterConfig;
  seafloor?: OceanSeafloorConfig;
  heightSampler: SeafloorHeightSampler;
  seed: string;
};

export function OceanLightShafts({ lighting, water, seafloor, heightSampler, seed }: OceanLightShaftsProps) {
  const godRayStrength = lighting?.godRayStrength ?? 0;
  const causticStrength = lighting?.causticStrength ?? 0;
  const basinRadius = basinRadiusFromSeafloor(seafloor);

  return (
    <group>
      {godRayStrength > 0 ? (
        <GodRays
          strength={godRayStrength}
          elevationRadians={lighting?.surfaceElevationRadians ?? 0.9}
          lightColor={lighting?.surfaceLightColor ?? "#8FD8E8"}
          basinRadius={basinRadius}
          seed={seed}
        />
      ) : null}
      {causticStrength > 0 ? (
        <Caustics
          strength={causticStrength}
          lightColor={lighting?.surfaceLightColor ?? "#8FD8E8"}
          basinRadius={basinRadius}
          visibilityMetres={water?.visibilityMetres ?? 24}
          heightSampler={heightSampler}
        />
      ) : null}
    </group>
  );
}

type GodRaysProps = {
  strength: number;
  elevationRadians: number;
  lightColor: string;
  basinRadius: number;
  seed: string;
};

function GodRays({ strength, elevationRadians, lightColor, basinRadius, seed }: GodRaysProps) {
  const groupRef = useRef<Group>(null);
  const shaftTexture = getLightShaftTexture();

  const shafts = useMemo(() => {
    const nextRandomValue = randomFromSeed(`${seed}-ocean-god-rays`);
    return Array.from({ length: SHAFT_COUNT }, () => {
      const angle = nextRandomValue() * Math.PI * 2;
      const radial = Math.sqrt(nextRandomValue()) * basinRadius * 0.9;
      const width = SHAFT_WIDTH_BASE + nextRandomValue() * SHAFT_WIDTH_RANGE;
      const phase = nextRandomValue() * Math.PI * 2;
      const opacity = 0.4 + nextRandomValue() * 0.6;
      return { x: Math.cos(angle) * radial, z: Math.sin(angle) * radial, width, phase, opacity };
    });
  }, [basinRadius, seed]);

  // The shafts lean by the angle the surface light enters at — that is what
  // surfaceElevationRadians is for. Vertical shafts read as a studio effect;
  // leaning ones read as a sun somewhere above the water.
  const leanRadians = Math.PI / 2 - elevationRadians;

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    const elapsed = clock.getElapsedTime();
    group.children.forEach((child, index) => {
      const shaft = shafts[index];
      if (!shaft) {
        return;
      }
      // Surface chop makes the shafts wander. Without it they are searchlights.
      child.rotation.z = leanRadians + Math.sin(elapsed * SHAFT_SWAY_SPEED + shaft.phase) * SHAFT_SWAY_RADIANS;
      const mesh = child as Mesh;
      const material = mesh.material as { opacity: number };
      material.opacity =
        SHAFT_MAXIMUM_OPACITY * strength * shaft.opacity * (0.7 + Math.sin(elapsed * 0.4 + shaft.phase) * 0.3);
    });
  });

  return (
    <group ref={groupRef}>
      {shafts.map((shaft, index) => (
        <mesh key={index} position={[shaft.x, SHAFT_HEIGHT / 2, shaft.z]} rotation={[0, shaft.phase, leanRadians]}>
          <planeGeometry args={[shaft.width, SHAFT_HEIGHT]} />
          <meshBasicMaterial
            map={shaftTexture ?? undefined}
            color={lightColor}
            transparent
            opacity={0}
            side={DoubleSide}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

type CausticsProps = {
  strength: number;
  lightColor: string;
  basinRadius: number;
  visibilityMetres: number;
  heightSampler: SeafloorHeightSampler;
};

/**
 * The moving light pattern the surface projects onto the floor.
 *
 * Two counter-scrolling layers of the same texture. One layer reads as a
 * repeating tile; two at different speeds and scales interfere and stop
 * looking like a texture at all — the cheapest convincing caustic there is.
 */
function Caustics({ strength, lightColor, basinRadius, visibilityMetres, heightSampler }: CausticsProps) {
  // One texture instance PER LAYER, not a shared singleton: the two layers
  // scroll at different speeds by mutating texture.offset, and a shared
  // instance would have them overwriting each other every frame.
  const firstTexture = useMemo(() => createCausticTexture(), []);
  const secondTexture = useMemo(() => createCausticTexture(), []);

  // Caustics only reach as far as the light does. Sizing the patch to the
  // water's visibility rather than to the basin keeps them from glowing on a
  // seabed the viewer cannot see anyway.
  const extent = Math.min(basinRadius * 2, visibilityMetres * 1.8);

  // The caustic sheet FOLLOWS THE FLOOR rather than lying flat at y = 0. A flat
  // plane is buried by the first ridge it meets, which is exactly what a first
  // draft of this looked like: bright water on the flats and nothing at all on
  // the rocks that most need it.
  const causticGeometry = useMemo(() => {
    const geometry = new PlaneGeometry(extent, extent, CAUSTIC_SEGMENTS, CAUSTIC_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position") as BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, heightSampler(positions.getX(index), positions.getZ(index)) + CAUSTIC_FLOOR_OFFSET);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [extent, heightSampler]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    firstTexture?.offset.set(elapsed * CAUSTIC_SCROLL_SPEED, elapsed * CAUSTIC_SCROLL_SPEED * 0.6);
    secondTexture?.offset.set(-elapsed * CAUSTIC_SCROLL_SPEED * 1.7, elapsed * CAUSTIC_SCROLL_SPEED * 1.1);
  });

  return (
    <group>
      <mesh geometry={causticGeometry}>
        <meshBasicMaterial
          map={firstTexture ?? undefined}
          color={lightColor}
          transparent
          opacity={CAUSTIC_MAXIMUM_OPACITY * strength}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={causticGeometry} position={[0, CAUSTIC_FLOOR_OFFSET, 0]} scale={[0.8, 1, 0.8]}>
        <meshBasicMaterial
          map={secondTexture ?? undefined}
          color={lightColor}
          transparent
          opacity={CAUSTIC_MAXIMUM_OPACITY * strength * 0.7}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
