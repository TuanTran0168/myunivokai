"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Clone, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Color, IcosahedronGeometry, Object3D, Vector3, type Group, type InstancedMesh } from "three";
import type { SceneConfig } from "@/lib/types";
import { planetsFromScene, randomFromSeed } from "@/lib/scene";
import { createSeededNoise3d, fractalNoise3d } from "../shared/seededNoise3d";
import { orbitRadiusForPlanet } from "./SolarPlanet";
import { BENNU_MODEL_URL, BENNU_TARGET_SIZE } from "./spacecraftCatalog";

/**
 * A procedural asteroid belt just outside the outermost personality planet.
 * Everything is seeded: a few potato-shaped rock geometries (noise-displaced
 * icospheres) instanced a thousand times with power-law sizes (many small,
 * few big — real belt statistics), gaussian radial/vertical scatter, and a
 * slow rigid drift. Zero downloads, infinite per-world variety.
 */

const ROCK_GEOMETRY_VARIANT_COUNT = 3;
const ROCK_ICOSPHERE_DETAIL = 3;
const ROCK_NOISE_FREQUENCY = 1.6;
const ROCK_NOISE_OCTAVES = 4;
const ROCK_DISPLACEMENT_AMPLITUDE = 0.38;
// Real asteroids are elongated potatoes, not spheres.
const ROCK_MAXIMUM_ELONGATION = 0.5;

const ASTEROID_INSTANCE_COUNT = 1100;
const BELT_GAP_BEYOND_LAST_ORBIT = 1.7;
const BELT_RADIAL_SIGMA = 0.55;
const BELT_VERTICAL_SIGMA = 0.18;
const MINIMUM_ASTEROID_SCALE = 0.035;
const ASTEROID_SCALE_RANGE = 0.095;
// scale = min + range * u^2: the quadratic bias yields many small, few big.
const ASTEROID_SCALE_POWER = 2;
const BELT_ROTATION_RADIANS_PER_SECOND = 0.008;
const BELT_TILT_RADIANS: [number, number, number] = [0.05, 0, 0.03];
const ASTEROID_BASE_COLOR = "#8A7F72";
const ASTEROID_BRIGHTNESS_VARIATION = 0.35;

// Matches the default orbit layout in SolarPlanet for worlds without explicit radii.
const FIRST_PLANET_ORBIT_RADIUS = 3.2;

const BENNU_TUMBLE_RADIANS_PER_SECOND = 0.08;
const BENNU_ROCK_COLOR = "#5C544B";

type AsteroidBeltProps = {
  scene: SceneConfig;
  seed: string;
};

/**
 * The belt's named hero rock: NASA's radar shape model of asteroid Bennu
 * (real silhouette, public domain), parked at a seeded spot on the belt ring
 * inside the rotating group so it drifts with the swarm.
 */
function BennuHeroRock({ seed, beltRadius }: { seed: string; beltRadius: number }) {
  const gltf = useGLTF(BENNU_MODEL_URL);
  const normalizedScale = useMemo(() => {
    const boundingBox = new Box3().setFromObject(gltf.scene);
    const size = new Vector3();
    boundingBox.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z);
    return largestDimension > 0 ? BENNU_TARGET_SIZE / largestDimension : 1;
  }, [gltf]);
  const beltAngle = useMemo(() => randomFromSeed(`${seed}-bennu`)() * Math.PI * 2, [seed]);
  const rockReference = useRef<Group>(null);
  const rockColor = useMemo(() => new Color(BENNU_ROCK_COLOR), []);

  useEffect(() => {
    rockReference.current?.traverse((object) => {
      object.raycast = () => null;
      // The NASA shape model ships without materials; tint whatever standard
      // material Clone gave it toward dark regolith.
      const mesh = object as { material?: { color?: Color } };
      if (mesh.material?.color) {
        mesh.material.color.copy(rockColor);
      }
    });
  }, [gltf, rockColor]);

  useFrame((_, deltaSeconds) => {
    if (rockReference.current) {
      rockReference.current.rotation.y += BENNU_TUMBLE_RADIANS_PER_SECOND * deltaSeconds;
      rockReference.current.rotation.x += BENNU_TUMBLE_RADIANS_PER_SECOND * 0.4 * deltaSeconds;
    }
  });

  return (
    <group
      ref={rockReference}
      position={[Math.cos(beltAngle) * beltRadius, 0, Math.sin(beltAngle) * beltRadius]}
      scale={normalizedScale}
    >
      <Clone object={gltf.scene} />
    </group>
  );
}

useGLTF.preload(BENNU_MODEL_URL);

function buildRockGeometry(seed: string, variantIndex: number): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(1, ROCK_ICOSPHERE_DETAIL);
  const noise = createSeededNoise3d(`${seed}-rock-${variantIndex}`);
  const random = randomFromSeed(`${seed}-rock-shape-${variantIndex}`);
  const positionAttribute = geometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const x = positionAttribute.getX(vertexIndex);
    const y = positionAttribute.getY(vertexIndex);
    const z = positionAttribute.getZ(vertexIndex);
    // On a unit icosphere the position IS the normal; push along it.
    const displacement =
      1 +
      ROCK_DISPLACEMENT_AMPLITUDE *
        fractalNoise3d(noise, x * ROCK_NOISE_FREQUENCY, y * ROCK_NOISE_FREQUENCY, z * ROCK_NOISE_FREQUENCY, ROCK_NOISE_OCTAVES);
    positionAttribute.setXYZ(vertexIndex, x * displacement, y * displacement, z * displacement);
  }
  geometry.scale(1 + random() * ROCK_MAXIMUM_ELONGATION, 1 - random() * ROCK_MAXIMUM_ELONGATION * 0.6, 1);
  geometry.computeVertexNormals();
  return geometry;
}

// Box-Muller gaussian from the seeded uniform source.
function gaussianSample(random: () => number): number {
  const uniformA = Math.max(random(), Number.EPSILON);
  const uniformB = random();
  return Math.sqrt(-2 * Math.log(uniformA)) * Math.cos(2 * Math.PI * uniformB);
}

export function AsteroidBelt({ scene, seed }: AsteroidBeltProps) {
  const planets = planetsFromScene(scene);
  const outermostOrbitRadius = planets.reduce(
    (maximumRadius, planet, planetIndex) => Math.max(maximumRadius, orbitRadiusForPlanet(planet, planetIndex)),
    FIRST_PLANET_ORBIT_RADIUS
  );
  const beltRadius = outermostOrbitRadius + BELT_GAP_BEYOND_LAST_ORBIT;

  const rockGeometries = useMemo(
    () =>
      Array.from({ length: ROCK_GEOMETRY_VARIANT_COUNT }, (_, variantIndex) => buildRockGeometry(seed, variantIndex)),
    [seed]
  );
  useEffect(() => {
    return () => {
      rockGeometries.forEach((geometry) => geometry.dispose());
    };
  }, [rockGeometries]);

  const instancedMeshReferences = useRef<(InstancedMesh | null)[]>([]);
  const beltGroupReference = useRef<Group>(null);

  // Seeded placement, written once per (seed, beltRadius) into the instance buffers.
  useEffect(() => {
    const random = randomFromSeed(`${seed}-asteroid-belt`);
    const placementProxy = new Object3D();
    const instanceColor = new Color();
    const baseColor = new Color(ASTEROID_BASE_COLOR);
    const instancesPerVariant = Math.floor(ASTEROID_INSTANCE_COUNT / ROCK_GEOMETRY_VARIANT_COUNT);
    for (let variantIndex = 0; variantIndex < ROCK_GEOMETRY_VARIANT_COUNT; variantIndex += 1) {
      const instancedMesh = instancedMeshReferences.current[variantIndex];
      if (!instancedMesh) {
        continue;
      }
      for (let instanceIndex = 0; instanceIndex < instancesPerVariant; instanceIndex += 1) {
        const orbitAngle = random() * Math.PI * 2;
        const orbitRadius = beltRadius + gaussianSample(random) * BELT_RADIAL_SIGMA;
        const verticalOffset = gaussianSample(random) * BELT_VERTICAL_SIGMA;
        placementProxy.position.set(
          Math.cos(orbitAngle) * orbitRadius,
          verticalOffset,
          Math.sin(orbitAngle) * orbitRadius
        );
        placementProxy.rotation.set(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2);
        const scale = MINIMUM_ASTEROID_SCALE + ASTEROID_SCALE_RANGE * random() ** ASTEROID_SCALE_POWER;
        placementProxy.scale.setScalar(scale);
        placementProxy.updateMatrix();
        instancedMesh.setMatrixAt(instanceIndex, placementProxy.matrix);
        const brightness = 1 - ASTEROID_BRIGHTNESS_VARIATION * random();
        instanceColor.copy(baseColor).multiplyScalar(brightness);
        instancedMesh.setColorAt(instanceIndex, instanceColor);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) {
        instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }, [seed, beltRadius, rockGeometries]);

  useFrame((_, deltaSeconds) => {
    if (beltGroupReference.current) {
      beltGroupReference.current.rotation.y += BELT_ROTATION_RADIANS_PER_SECOND * deltaSeconds;
    }
  });

  const instancesPerVariant = Math.floor(ASTEROID_INSTANCE_COUNT / ROCK_GEOMETRY_VARIANT_COUNT);

  return (
    <group ref={beltGroupReference} rotation={BELT_TILT_RADIANS}>
      {rockGeometries.map((geometry, variantIndex) => (
        <instancedMesh
          // eslint-disable-next-line react/no-array-index-key -- variants are stable, index IS the identity
          key={`${seed}-belt-variant-${variantIndex}`}
          ref={(instancedMesh) => {
            instancedMeshReferences.current[variantIndex] = instancedMesh;
          }}
          args={[geometry, undefined, instancesPerVariant]}
          frustumCulled={false}
          // Belt rocks are scenery, not DNA objects — never intercept clicks.
          raycast={() => null}
        >
          <meshStandardMaterial roughness={0.95} metalness={0.05} />
        </instancedMesh>
      ))}
      <Suspense fallback={null}>
        <BennuHeroRock seed={seed} beltRadius={beltRadius} />
      </Suspense>
    </group>
  );
}
