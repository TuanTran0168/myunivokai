"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImplementation } from "three-stdlib";
import { usePlanetPositionTracker } from "./PlanetPositionTracker";

const ORBIT_CONTROLS_MINIMUM_DISTANCE = 2.5;
const ORBIT_CONTROLS_MAXIMUM_DISTANCE = 26;
const CAMERA_FOCUS_LERP_SPEED = 3.2;
const SCENE_CENTER = new Vector3(0, 0, 0);

type CameraRigProps = {
  selectedPlanetKey: string | null;
};

/**
 * Orbit controls plus a smooth "fly to selected object" focus animation,
 * inspired by NASA Eyes. When a planet is selected the controls target glides
 * to that planet and keeps following it; deselecting glides back to center.
 */
export function CameraRig({ selectedPlanetKey }: CameraRigProps) {
  const orbitControlsReference = useRef<OrbitControlsImplementation>(null);
  const planetPositionTracker = usePlanetPositionTracker();
  const desiredTarget = useMemo(() => new Vector3(), []);

  useFrame((_, deltaTimeSeconds) => {
    const orbitControls = orbitControlsReference.current;
    if (!orbitControls) {
      return;
    }
    const selectedPlanetPosition = selectedPlanetKey
      ? planetPositionTracker.get(selectedPlanetKey)
      : undefined;
    desiredTarget.copy(selectedPlanetPosition ?? SCENE_CENTER);

    const frameLerpFactor = 1 - Math.exp(-CAMERA_FOCUS_LERP_SPEED * deltaTimeSeconds);
    orbitControls.target.lerp(desiredTarget, frameLerpFactor);
    orbitControls.update();
  });

  return (
    <OrbitControls
      ref={orbitControlsReference}
      enablePan={false}
      minDistance={ORBIT_CONTROLS_MINIMUM_DISTANCE}
      maxDistance={ORBIT_CONTROLS_MAXIMUM_DISTANCE}
    />
  );
}
