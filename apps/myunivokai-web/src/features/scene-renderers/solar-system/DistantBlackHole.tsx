"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Box3, Vector3, type Group, type Material, type Mesh, type MeshStandardMaterial, type Texture } from "three";
import { randomFromSeed } from "@/lib/scene";
import { BLACK_HOLE_MODEL_URL, BLACK_HOLE_TARGET_SIZE } from "./spacecraftCatalog";

/**
 * Rare seed-gated black hole: a real, self-hosted GLB (Sketchfab CC-BY, see
 * ATTRIBUTION.md) — a pure-black event-horizon core wrapped in emissive
 * accretion rings, playing its own baked swirl animation. The emissive disk is
 * caught by the scene's selective bloom (PostEffects) for a cinematic glow.
 * Scenery only: raycasting is disabled so it never intercepts a planet click.
 * Placed far from the origin so it reads as a distant, majestic object; source
 * units are normalized by bounding box like the NASA spacecraft.
 */

// Placement is constrained by the camera envelope, NOT just by taste: the
// OrbitControls rig always looks at the origin and only zooms out to 26
// (CameraRig ORBIT_CONTROLS_MAXIMUM_DISTANCE), so anything parked beyond that
// radius sits outside the view cone almost always — the reason an earlier
// radius of 30 made the black hole effectively unfindable. The outermost
// planet orbit is ~11, so this band reads as "far beyond the planets" while
// still landing in frame when the camera pans or zooms out.
const DISTANCE_FROM_CENTER = 18;
const ELEVATION = 7;

type DistantBlackHoleProps = {
  seed: string;
};

export function DistantBlackHole({ seed }: DistantBlackHoleProps) {
  const renderer = useThree((state) => state.gl);
  const gltf = useGLTF(BLACK_HOLE_MODEL_URL);
  const animatedRootReference = useRef<Group>(null);
  const { actions } = useAnimations(gltf.animations, animatedRootReference);

  // One-time material pass: max out texture anisotropy so the accretion-ring
  // detail stays crisp at the grazing viewing angle instead of smearing. The
  // model's own emissive/tone-mapping is left untouched — boosting it blows the
  // disk into a screen-filling white bloom blob.
  useMemo(() => {
    const maximumAnisotropy = renderer.capabilities.getMaxAnisotropy();
    gltf.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.material) {
        return;
      }
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as MeshStandardMaterial;
        for (const textureKey of ["map", "emissiveMap"] as const) {
          const texture = standard[textureKey] as Texture | null;
          if (texture) {
            texture.anisotropy = maximumAnisotropy;
            texture.needsUpdate = true;
          }
        }
      }
    });
  }, [gltf, renderer]);

  const { position, tilt, normalizedScale } = useMemo(() => {
    const random = randomFromSeed(`${seed}-black-hole-placement`);
    const orbitAngle = random() * Math.PI * 2;
    const placement: [number, number, number] = [
      Math.cos(orbitAngle) * DISTANCE_FROM_CENTER,
      ELEVATION,
      Math.sin(orbitAngle) * DISTANCE_FROM_CENTER
    ];
    // Seeded orientation: a gentle tilt off face-on plus a full-circle yaw, so
    // no two worlds frame the disk identically.
    const tiltRotation: [number, number, number] = [
      -0.5 - random() * 0.3,
      random() * Math.PI * 2,
      random() * 0.3 - 0.15
    ];
    const boundingBox = new Box3().setFromObject(gltf.scene);
    const size = new Vector3();
    boundingBox.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z);
    const scale = largestDimension > 0 ? BLACK_HOLE_TARGET_SIZE / largestDimension : 1;
    return { position: placement, tilt: tiltRotation, normalizedScale: scale };
  }, [gltf, seed]);

  // Play the model's baked accretion-swirl clip.
  useEffect(() => {
    const firstAction = Object.values(actions)[0];
    firstAction?.reset().play();
  }, [actions]);

  // Scenery: never intercept pointer events meant for a planet.
  useEffect(() => {
    animatedRootReference.current?.traverse((object) => {
      object.raycast = () => null;
    });
  }, [gltf]);

  return (
    <group position={position} rotation={tilt} scale={normalizedScale}>
      <group ref={animatedRootReference}>
        <primitive object={gltf.scene} />
      </group>
    </group>
  );
}
