"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { AdditiveBlending, DoubleSide } from "three";
import type { PlanetSceneConfig, SceneConfig } from "@/lib/types";
import { backgroundColorFromScene, paletteFromScene, planetsFromScene, randomFromSeed } from "@/lib/scene";

const DEFAULT_CAMERA_DISTANCE = 9;
const DEFAULT_CAMERA_FIELD_OF_VIEW = 50;
const CAMERA_HEIGHT_RATIO = 0.42;
const ORBIT_CONTROLS_MINIMUM_DISTANCE = 4;
const ORBIT_CONTROLS_MAXIMUM_DISTANCE = 20;

const DEFAULT_CORE_SCALE = 1.1;
const DEFAULT_CORE_SPIN_SPEED = 0.14;
const CORE_EMISSIVE_INTENSITY = 0.55;

const DEFAULT_PLANET_SIZE = 0.6;
const DEFAULT_PLANET_ORBIT_SPEED = 0.12;
const FIRST_PLANET_ORBIT_RADIUS = 3.2;
const ORBIT_RADIUS_STEP_PER_PLANET = 1.05;
const HOVERED_PLANET_SCALE_MULTIPLIER = 1.3;
const PLANET_EMISSIVE_INTENSITY = 0.35;
const HOVERED_PLANET_EMISSIVE_INTENSITY = 0.9;

const ORBIT_RING_THICKNESS = 0.02;
const ORBIT_RING_OPACITY = 0.16;
const HIGHLIGHTED_ORBIT_RING_OPACITY = 0.5;

const DEFAULT_PARTICLE_DESKTOP_COUNT = 900;
const DEFAULT_PARTICLE_MOBILE_COUNT = 400;
const DEFAULT_PARTICLE_SPREAD = 16;
const PARTICLE_POINT_SIZE = 0.06;
const PARTICLE_OPACITY = 0.85;
const MOBILE_VIEWPORT_MAXIMUM_WIDTH = 768;

const FALLBACK_BODY_COUNT = 18;
const FALLBACK_SEED = "myunivokai";

type UniverseCanvasProps = {
  scene?: SceneConfig;
  className?: string;
  selectedPlanetKey?: string | null;
  onSelectPlanet?: (planet: PlanetSceneConfig | null) => void;
};

export function planetIdentityKey(planet: PlanetSceneConfig, planetIndex: number): string {
  return planet.key ?? planet.name ?? `planet-${planetIndex}`;
}

function CoreGeometry({ shape }: { shape?: string }) {
  if (shape === "octahedron") {
    return <octahedronGeometry args={[1, 0]} />;
  }
  if (shape === "torus") {
    return <torusGeometry args={[0.75, 0.3, 24, 64]} />;
  }
  if (shape === "box") {
    return <boxGeometry args={[1.35, 1.35, 1.35]} />;
  }
  return <icosahedronGeometry args={[1, 2]} />;
}

function UniverseCore({ scene, palette }: { scene?: SceneConfig; palette: string[] }) {
  const coreMeshReference = useRef<Mesh>(null);
  const coreConfig = scene?.core;
  const coreColor = coreConfig?.color ?? palette[0];
  const coreEmissiveColor = coreConfig?.emissive ?? palette[1];
  const coreScale = coreConfig?.scale ?? DEFAULT_CORE_SCALE;
  const coreSpinSpeed = coreConfig?.spinSpeed ?? DEFAULT_CORE_SPIN_SPEED;

  useFrame(({ clock }) => {
    if (!coreMeshReference.current) {
      return;
    }
    coreMeshReference.current.rotation.y = clock.elapsedTime * coreSpinSpeed * Math.PI;
    coreMeshReference.current.rotation.x = clock.elapsedTime * coreSpinSpeed * 0.4;
  });

  return (
    <mesh ref={coreMeshReference} scale={coreScale}>
      <CoreGeometry shape={coreConfig?.shape} />
      <meshStandardMaterial
        color={coreColor}
        emissive={coreEmissiveColor}
        emissiveIntensity={CORE_EMISSIVE_INTENSITY}
        roughness={0.35}
        metalness={0.25}
      />
    </mesh>
  );
}

type OrbitingPlanetProps = {
  planet: PlanetSceneConfig;
  planetIndex: number;
  planetCount: number;
  fallbackColor: string;
  isSelected: boolean;
  isHovered: boolean;
  onHoverChange: (planet: PlanetSceneConfig | null) => void;
  onSelect?: (planet: PlanetSceneConfig) => void;
};

function defaultPhaseForPlanet(planetIndex: number, planetCount: number): number {
  if (planetCount <= 0) {
    return 0;
  }
  return (planetIndex / planetCount) * Math.PI * 2;
}

function orbitRadiusForPlanet(planet: PlanetSceneConfig, planetIndex: number): number {
  return planet.orbitRadius ?? FIRST_PLANET_ORBIT_RADIUS + planetIndex * ORBIT_RADIUS_STEP_PER_PLANET;
}

function OrbitingPlanet({
  planet,
  planetIndex,
  planetCount,
  fallbackColor,
  isSelected,
  isHovered,
  onHoverChange,
  onSelect
}: OrbitingPlanetProps) {
  const planetGroupReference = useRef<Group>(null);
  const orbitRadius = orbitRadiusForPlanet(planet, planetIndex);
  const orbitSpeed = planet.orbitSpeed ?? DEFAULT_PLANET_ORBIT_SPEED;
  const orbitPhase = planet.phase ?? defaultPhaseForPlanet(planetIndex, planetCount);
  const planetSize = planet.size ?? DEFAULT_PLANET_SIZE;
  const planetColor = planet.color ?? fallbackColor;
  const isHighlighted = isHovered || isSelected;

  useFrame(({ clock }) => {
    if (!planetGroupReference.current) {
      return;
    }
    const orbitAngle = orbitPhase + clock.elapsedTime * orbitSpeed;
    planetGroupReference.current.position.set(
      Math.cos(orbitAngle) * orbitRadius,
      0,
      Math.sin(orbitAngle) * orbitRadius
    );
  });

  return (
    <group ref={planetGroupReference}>
      <mesh
        scale={isHighlighted ? HOVERED_PLANET_SCALE_MULTIPLIER : 1}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHoverChange(planet);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          onHoverChange(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect?.(planet);
        }}
      >
        <sphereGeometry args={[planetSize, 32, 24]} />
        <meshStandardMaterial
          color={planetColor}
          emissive={planetColor}
          emissiveIntensity={isHighlighted ? HOVERED_PLANET_EMISSIVE_INTENSITY : PLANET_EMISSIVE_INTENSITY}
          roughness={0.45}
          metalness={0.2}
        />
      </mesh>
    </group>
  );
}

function OrbitRing({ radius, color, isHighlighted }: { radius: number; color: string; isHighlighted: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - ORBIT_RING_THICKNESS, radius + ORBIT_RING_THICKNESS, 128]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={isHighlighted ? HIGHLIGHTED_ORBIT_RING_OPACITY : ORBIT_RING_OPACITY}
        side={DoubleSide}
      />
    </mesh>
  );
}

function buildParticlePositions(seed: string, particleCount: number, particleSpread: number): Float32Array {
  const random = randomFromSeed(`${seed}-particles`);
  const positions = new Float32Array(particleCount * 3);
  for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
    positions[particleIndex * 3] = (random() * 2 - 1) * particleSpread;
    positions[particleIndex * 3 + 1] = (random() * 2 - 1) * particleSpread * 0.6;
    positions[particleIndex * 3 + 2] = (random() * 2 - 1) * particleSpread;
  }
  return positions;
}

function ParticleField({ scene, seed, fallbackColor }: { scene?: SceneConfig; seed: string; fallbackColor: string }) {
  const particleConfig = scene?.particles;
  const isMobileViewport =
    typeof window !== "undefined" && window.innerWidth < MOBILE_VIEWPORT_MAXIMUM_WIDTH;
  const particleCount = isMobileViewport
    ? particleConfig?.mobileCount ?? DEFAULT_PARTICLE_MOBILE_COUNT
    : particleConfig?.desktopCount ?? DEFAULT_PARTICLE_DESKTOP_COUNT;
  const particleSpread = particleConfig?.spread ?? DEFAULT_PARTICLE_SPREAD;
  const particleColor = particleConfig?.color ?? fallbackColor;

  const particlePositions = useMemo(
    () => buildParticlePositions(seed, particleCount, particleSpread),
    [seed, particleCount, particleSpread]
  );

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particlePositions.length / 3}
          array={particlePositions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={particleColor}
        size={PARTICLE_POINT_SIZE}
        transparent
        opacity={PARTICLE_OPACITY}
        sizeAttenuation
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

function FallbackUniverse({ seed, palette }: { seed: string; palette: string[] }) {
  const fallbackGroupReference = useRef<Group>(null);

  const fallbackBodies = useMemo(() => {
    const random = randomFromSeed(seed);
    return Array.from({ length: FALLBACK_BODY_COUNT }, (_, bodyIndex) => {
      const bodyOrbitRadius = 1.4 + random() * 3.8;
      const bodyAngle = random() * Math.PI * 2;
      const bodyHeight = -0.55 + random() * 1.7;
      return {
        color: palette[bodyIndex % palette.length],
        position: [Math.cos(bodyAngle) * bodyOrbitRadius, bodyHeight, Math.sin(bodyAngle) * bodyOrbitRadius] as [
          number,
          number,
          number
        ],
        scale: 0.12 + random() * 0.42,
        rotationOffset: random() * Math.PI * 2
      };
    });
  }, [palette, seed]);

  useFrame(({ clock }) => {
    if (!fallbackGroupReference.current) {
      return;
    }
    fallbackGroupReference.current.rotation.y = clock.elapsedTime * 0.08;
  });

  return (
    <group ref={fallbackGroupReference}>
      <mesh>
        <icosahedronGeometry args={[0.92, 2]} />
        <meshStandardMaterial color={palette[0]} roughness={0.44} metalness={0.18} />
      </mesh>
      {fallbackBodies.map((body, bodyIndex) => (
        <group key={`${seed}-${bodyIndex}`} rotation={[0, body.rotationOffset, 0]}>
          <mesh position={body.position}>
            {bodyIndex % 3 === 0 ? (
              <octahedronGeometry args={[body.scale, 1]} />
            ) : (
              <sphereGeometry args={[body.scale, 24, 16]} />
            )}
            <meshStandardMaterial color={body.color} roughness={0.52} metalness={0.24} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

type UniverseSceneContentProps = {
  scene?: SceneConfig;
  seed: string;
  selectedPlanetKey?: string | null;
  hoveredPlanetKey: string | null;
  onHoverPlanet: (planet: PlanetSceneConfig | null) => void;
  onSelectPlanet?: (planet: PlanetSceneConfig | null) => void;
};

function UniverseSceneContent({
  scene,
  seed,
  selectedPlanetKey,
  hoveredPlanetKey,
  onHoverPlanet,
  onSelectPlanet
}: UniverseSceneContentProps) {
  const palette = paletteFromScene(scene);
  const planets = planetsFromScene(scene);
  const hasConfiguredPlanets = planets.length > 0;

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[4, 7, 3]} intensity={1.3} />
      <pointLight position={[0, 0, 0]} intensity={2.4} color={palette[1]} />
      <ParticleField scene={scene} seed={seed} fallbackColor={palette[1]} />
      {hasConfiguredPlanets ? (
        <>
          <UniverseCore scene={scene} palette={palette} />
          {planets.map((planet, planetIndex) => {
            const identityKey = planetIdentityKey(planet, planetIndex);
            const isHighlighted = identityKey === hoveredPlanetKey || identityKey === selectedPlanetKey;
            return (
              <OrbitRing
                key={`orbit-ring-${identityKey}`}
                radius={orbitRadiusForPlanet(planet, planetIndex)}
                color={planet.color ?? palette[planetIndex % palette.length]}
                isHighlighted={isHighlighted}
              />
            );
          })}
          {planets.map((planet, planetIndex) => {
            const identityKey = planetIdentityKey(planet, planetIndex);
            return (
              <OrbitingPlanet
                key={`planet-${identityKey}`}
                planet={planet}
                planetIndex={planetIndex}
                planetCount={planets.length}
                fallbackColor={palette[planetIndex % palette.length]}
                isSelected={identityKey === selectedPlanetKey}
                isHovered={identityKey === hoveredPlanetKey}
                onHoverChange={onHoverPlanet}
                onSelect={onSelectPlanet}
              />
            );
          })}
        </>
      ) : (
        <FallbackUniverse seed={seed} palette={palette} />
      )}
    </>
  );
}

export function UniverseCanvas({ scene, className, selectedPlanetKey, onSelectPlanet }: UniverseCanvasProps) {
  const [hoveredPlanet, setHoveredPlanet] = useState<PlanetSceneConfig | null>(null);

  const seed = String(scene?.seed ?? FALLBACK_SEED);
  const backgroundColor = backgroundColorFromScene(scene);
  const cameraDistance = scene?.camera?.distance ?? DEFAULT_CAMERA_DISTANCE;
  const cameraFieldOfView = scene?.camera?.fov ?? DEFAULT_CAMERA_FIELD_OF_VIEW;
  const showPlanetLabels = scene?.hud?.showLabels !== false;
  const planets = planetsFromScene(scene);
  const hoveredPlanetKey = hoveredPlanet
    ? planetIdentityKey(
        hoveredPlanet,
        planets.findIndex((planet) => planet === hoveredPlanet)
      )
    : null;

  return (
    <div
      className={`relative h-full min-h-[320px] overflow-hidden ${className ?? ""}`}
      style={{ backgroundColor, cursor: hoveredPlanet ? "pointer" : "grab" }}
    >
      <Canvas
        key={`${seed}-${cameraDistance}-${cameraFieldOfView}`}
        camera={{
          position: [0, cameraDistance * CAMERA_HEIGHT_RATIO, cameraDistance],
          fov: cameraFieldOfView
        }}
        dpr={[1, 1.8]}
        onPointerMissed={() => onSelectPlanet?.(null)}
      >
        <color attach="background" args={[backgroundColor]} />
        <fog attach="fog" args={[backgroundColor, cameraDistance + 4, cameraDistance + 16]} />
        <UniverseSceneContent
          scene={scene}
          seed={seed}
          selectedPlanetKey={selectedPlanetKey}
          hoveredPlanetKey={hoveredPlanetKey}
          onHoverPlanet={setHoveredPlanet}
          onSelectPlanet={onSelectPlanet}
        />
        <OrbitControls
          enablePan={false}
          minDistance={ORBIT_CONTROLS_MINIMUM_DISTANCE}
          maxDistance={ORBIT_CONTROLS_MAXIMUM_DISTANCE}
        />
      </Canvas>
      {showPlanetLabels && hoveredPlanet ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-xs rounded-lg border border-white/15 bg-surface-low/85 px-3 py-2 backdrop-blur">
          <p className="text-sm font-semibold text-on-surface">{hoveredPlanet.name ?? "Unknown planet"}</p>
          {typeof hoveredPlanet.energy === "number" ? (
            <p className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">
              Energy {hoveredPlanet.energy}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-lowest/65 to-transparent" />
    </div>
  );
}
