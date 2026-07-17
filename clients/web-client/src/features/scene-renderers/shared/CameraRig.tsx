"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImplementation } from "three-stdlib";
import { usePlanetPositionTracker } from "./PlanetPositionTracker";

const ORBIT_CONTROLS_MINIMUM_DISTANCE = 2.5;
const ORBIT_CONTROLS_MAXIMUM_DISTANCE = 26;
// No polar clamp by default: universe scenes are viewable from below.
const ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE = Math.PI;
const CAMERA_FOCUS_LERP_SPEED = 3.2;
const SCENE_CENTER = new Vector3(0, 0, 0);

type CameraRigProps = {
  selectedPlanetKey: string | null;
  /** Scene families with a ground plane pass their own zoom/tilt envelope. */
  minimumDistance?: number;
  maximumDistance?: number;
  maximumPolarAngleRadians?: number;
};

/**
 * Orbit controls plus a smooth "fly to selected object" focus animation,
 * inspired by NASA Eyes. When a planet is selected the controls target glides
 * to that planet and keeps following it; deselecting glides back to center.
 */
export function CameraRig({
  selectedPlanetKey,
  minimumDistance = ORBIT_CONTROLS_MINIMUM_DISTANCE,
  maximumDistance = ORBIT_CONTROLS_MAXIMUM_DISTANCE,
  maximumPolarAngleRadians = ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE
}: CameraRigProps) {
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
      minDistance={minimumDistance}
      maxDistance={maximumDistance}
      maxPolarAngle={maximumPolarAngleRadians}
    />
  );
}
