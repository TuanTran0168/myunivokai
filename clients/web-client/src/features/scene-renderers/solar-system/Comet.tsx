"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { IcosahedronGeometry, Vector3, type Group } from "three";
import type { SceneConfig } from "@/lib/types";
import { planetsFromScene, randomFromSeed } from "@/lib/scene";
import { SizedStarPoints, hexColorToUnitRgb, type StarLayerAttributes } from "../shared/SizedStarPoints";
import { createSeededNoise3d, fractalNoise3d } from "../shared/seededNoise3d";
import { getSoftCircleTexture } from "../shared/softCircleTexture";
import { orbitRadiusForPlanet } from "./SolarPlanet";

/**
 * A seeded comet on an inclined orbit outside the asteroid belt: a dark
 * noise-displaced nucleus, a soft coma sprite, and two particle tails built
 * the way real comets grow them — a curved warm DUST tail and a straight
 * blue ION tail, both pointing away from the sun (the tail group re-orients
 * anti-sunward every frame). Tail particles reuse the star PSF shader, so
 * they twinkle like sunlit dust.
 */

const COMET_ORBIT_GAP_BEYOND_LAST_ORBIT = 3.0;
const COMET_ORBIT_INCLINATION_RADIANS = 0.35;
const COMET_ORBIT_RADIANS_PER_SECOND = 0.02;
const FIRST_PLANET_ORBIT_RADIUS = 3.2;

const NUCLEUS_RADIUS = 0.12;
const NUCLEUS_ICOSPHERE_DETAIL = 2;
const NUCLEUS_NOISE_FREQUENCY = 2.2;
const NUCLEUS_NOISE_OCTAVES = 4;
const NUCLEUS_DISPLACEMENT_AMPLITUDE = 0.45;
// Comet nuclei are among the darkest objects in the solar system.
const NUCLEUS_COLOR = "#1A1714";

const COMA_SPRITE_SCALE = 0.55;
const COMA_COLOR = "#FFEFD8";
const COMA_OPACITY = 0.5;

const DUST_TAIL_PARTICLE_COUNT = 700;
const DUST_TAIL_LENGTH = 4.2;
const DUST_TAIL_WIDTH_RATIO = 0.16;
const DUST_TAIL_CURVE_BEND = 0.55;
const DUST_TAIL_COLOR = "#FFE8C8";
const ION_TAIL_PARTICLE_COUNT = 350;
const ION_TAIL_LENGTH = 5.5;
const ION_TAIL_WIDTH_RATIO = 0.05;
const ION_TAIL_COLOR = "#88AAFF";
const TAIL_PARTICLE_MINIMUM_SIZE = 0.015;
const TAIL_PARTICLE_SIZE_RANGE = 0.05;

type CometProps = {
  scene: SceneConfig;
  seed: string;
};

type TailShapeOptions = {
  particleCount: number;
  tailLength: number;
  widthRatio: number;
  curveBend: number;
  tailColorHex: string;
  brightnessFalloffExponent: number;
};

// Tail particles live in the tail group's LOCAL space along +Z; the group is
// re-aimed anti-sunward every frame, so the shape itself is static geometry.
function buildTailParticles(seedLabel: string, options: TailShapeOptions): StarLayerAttributes {
  const random = randomFromSeed(seedLabel);
  const [baseRed, baseGreen, baseBlue] = hexColorToUnitRgb(options.tailColorHex);
  const positions = new Float32Array(options.particleCount * 3);
  const colors = new Float32Array(options.particleCount * 3);
  const sizes = new Float32Array(options.particleCount);
  const twinklePhases = new Float32Array(options.particleCount);
  for (let particleIndex = 0; particleIndex < options.particleCount; particleIndex += 1) {
    // Denser near the nucleus, thinning toward the tip.
    const tailFraction = random() ** 1.2;
    const localWidth = options.widthRatio * (0.25 + tailFraction) * options.tailLength;
    positions[particleIndex * 3] =
      (random() * 2 - 1) * localWidth + options.curveBend * tailFraction * tailFraction * options.tailLength * 0.25;
    positions[particleIndex * 3 + 1] = (random() * 2 - 1) * localWidth;
    positions[particleIndex * 3 + 2] = tailFraction * options.tailLength;

    const brightness = (1 - tailFraction) ** options.brightnessFalloffExponent;
    colors[particleIndex * 3] = baseRed * brightness;
    colors[particleIndex * 3 + 1] = baseGreen * brightness;
    colors[particleIndex * 3 + 2] = baseBlue * brightness;

    sizes[particleIndex] = TAIL_PARTICLE_MINIMUM_SIZE + random() * TAIL_PARTICLE_SIZE_RANGE;
    twinklePhases[particleIndex] = random() * Math.PI * 2;
  }
  return { positions, colors, sizes, twinklePhases };
}

function buildNucleusGeometry(seed: string): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(NUCLEUS_RADIUS, NUCLEUS_ICOSPHERE_DETAIL);
  const noise = createSeededNoise3d(`${seed}-comet-nucleus`);
  const positionAttribute = geometry.attributes.position;
  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    const x = positionAttribute.getX(vertexIndex);
    const y = positionAttribute.getY(vertexIndex);
    const z = positionAttribute.getZ(vertexIndex);
    const displacement =
      1 +
      NUCLEUS_DISPLACEMENT_AMPLITUDE *
        fractalNoise3d(
          noise,
          (x / NUCLEUS_RADIUS) * NUCLEUS_NOISE_FREQUENCY,
          (y / NUCLEUS_RADIUS) * NUCLEUS_NOISE_FREQUENCY,
          (z / NUCLEUS_RADIUS) * NUCLEUS_NOISE_FREQUENCY,
          NUCLEUS_NOISE_OCTAVES
        );
    positionAttribute.setXYZ(vertexIndex, x * displacement, y * displacement, z * displacement);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function Comet({ scene, seed }: CometProps) {
  const planets = planetsFromScene(scene);
  const outermostOrbitRadius = planets.reduce(
    (maximumRadius, planet, planetIndex) => Math.max(maximumRadius, orbitRadiusForPlanet(planet, planetIndex)),
    FIRST_PLANET_ORBIT_RADIUS
  );
  const cometOrbitRadius = outermostOrbitRadius + COMET_ORBIT_GAP_BEYOND_LAST_ORBIT;

  const orbitPhase = useMemo(() => randomFromSeed(`${seed}-comet-orbit`)() * Math.PI * 2, [seed]);
  const nucleusGeometry = useMemo(() => buildNucleusGeometry(seed), [seed]);
  useEffect(() => {
    return () => {
      nucleusGeometry.dispose();
    };
  }, [nucleusGeometry]);

  const dustTail = useMemo(
    () =>
      buildTailParticles(`${seed}-comet-dust-tail`, {
        particleCount: DUST_TAIL_PARTICLE_COUNT,
        tailLength: DUST_TAIL_LENGTH,
        widthRatio: DUST_TAIL_WIDTH_RATIO,
        curveBend: DUST_TAIL_CURVE_BEND,
        tailColorHex: DUST_TAIL_COLOR,
        brightnessFalloffExponent: 1.5
      }),
    [seed]
  );
  const ionTail = useMemo(
    () =>
      buildTailParticles(`${seed}-comet-ion-tail`, {
        particleCount: ION_TAIL_PARTICLE_COUNT,
        tailLength: ION_TAIL_LENGTH,
        widthRatio: ION_TAIL_WIDTH_RATIO,
        curveBend: 0,
        tailColorHex: ION_TAIL_COLOR,
        brightnessFalloffExponent: 1.2
      }),
    [seed]
  );

  const softCircleTexture = useMemo(() => getSoftCircleTexture(), []);
  const cometAnchorReference = useRef<Group>(null);
  const tailGroupReference = useRef<Group>(null);
  const antiSunwardTarget = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const cometAnchor = cometAnchorReference.current;
    if (!cometAnchor) {
      return;
    }
    const orbitAngle = orbitPhase + clock.elapsedTime * COMET_ORBIT_RADIANS_PER_SECOND;
    cometAnchor.position.set(Math.cos(orbitAngle) * cometOrbitRadius, 0, Math.sin(orbitAngle) * cometOrbitRadius);
    if (tailGroupReference.current) {
      // Aim the tail's +Z straight away from the sun at the origin.
      cometAnchor.getWorldPosition(antiSunwardTarget).multiplyScalar(2);
      tailGroupReference.current.lookAt(antiSunwardTarget);
    }
  });

  return (
    <group rotation={[COMET_ORBIT_INCLINATION_RADIANS, 0, 0.1]}>
      <group ref={cometAnchorReference}>
        <mesh geometry={nucleusGeometry} raycast={() => null}>
          <meshStandardMaterial color={NUCLEUS_COLOR} roughness={1} metalness={0} />
        </mesh>
        <sprite scale={COMA_SPRITE_SCALE} raycast={() => null}>
          <spriteMaterial
            map={softCircleTexture ?? undefined}
            color={COMA_COLOR}
            transparent
            opacity={COMA_OPACITY}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </sprite>
        <group ref={tailGroupReference}>
          <SizedStarPoints stars={dustTail} geometryKey={`${seed}-comet-dust`} />
          <SizedStarPoints stars={ionTail} geometryKey={`${seed}-comet-ion`} />
        </group>
      </group>
    </group>
  );
}
