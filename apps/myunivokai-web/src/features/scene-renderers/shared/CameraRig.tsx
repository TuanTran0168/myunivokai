"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImplementation } from "three-stdlib";
import { usePlanetPositionTracker } from "./PlanetPositionTracker";

const ORBIT_CONTROLS_MINIMUM_DISTANCE = 2.5;
const ORBIT_CONTROLS_MAXIMUM_DISTANCE = 26;
// No polar clamp by default: universe scenes are viewable from below.
const ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE = Math.PI;
const CAMERA_FOCUS_LERP_SPEED = 3.2;
const SCENE_CENTER = new Vector3(0, 0, 0);

// WASD / arrow-key glide across the scene. Speed scales with zoom distance so
// it feels the same whether you are close in or pulled far out.
const KEYBOARD_PAN_SPEED_PER_DISTANCE = 0.8;
const KEYBOARD_PAN_SPEED_MINIMUM = 5;
const KEYBOARD_PAN_SPEED_MAXIMUM = 55;
const MOVE_FORWARD_KEYS = new Set(["w", "arrowup"]);
const MOVE_BACKWARD_KEYS = new Set(["s", "arrowdown"]);
const MOVE_LEFT_KEYS = new Set(["a", "arrowleft"]);
const MOVE_RIGHT_KEYS = new Set(["d", "arrowright"]);
const ALL_MOVE_KEYS = new Set([...MOVE_FORWARD_KEYS, ...MOVE_BACKWARD_KEYS, ...MOVE_LEFT_KEYS, ...MOVE_RIGHT_KEYS]);

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || element.isContentEditable;
}

type CameraRigProps = {
  selectedPlanetKey: string | null;
  /** Scene families with a ground plane pass their own zoom/tilt envelope. */
  minimumDistance?: number;
  maximumDistance?: number;
  maximumPolarAngleRadians?: number;
  /** Decorative canvases (gallery backdrop) opt out of keyboard movement. */
  keyboardMoveEnabled?: boolean;
};

/**
 * Orbit controls plus a smooth "fly to selected object" focus animation
 * (inspired by NASA Eyes) and WASD / arrow-key free-roam panning. When a
 * planet/landmark/animal is selected the target glides to it and follows;
 * otherwise the keyboard glides the whole rig across the scene.
 */
export function CameraRig({
  selectedPlanetKey,
  minimumDistance = ORBIT_CONTROLS_MINIMUM_DISTANCE,
  maximumDistance = ORBIT_CONTROLS_MAXIMUM_DISTANCE,
  maximumPolarAngleRadians = ORBIT_CONTROLS_MAXIMUM_POLAR_ANGLE,
  keyboardMoveEnabled = true
}: CameraRigProps) {
  const orbitControlsReference = useRef<OrbitControlsImplementation>(null);
  const planetPositionTracker = usePlanetPositionTracker();
  const desiredTarget = useMemo(() => new Vector3(), []);
  const camera = useThree((state) => state.camera);

  const pressedKeysRef = useRef<Set<string>>(new Set());
  // Once the user drives with the keyboard we stop auto-recentering the target,
  // so free-roam position is not yanked back to the origin every frame.
  const hasFreeRoamedRef = useRef(false);

  useEffect(() => {
    if (!keyboardMoveEnabled) {
      return;
    }
    // The ref's Set identity is stable; capture it so the cleanup closes over
    // the same object the handlers mutate.
    const pressedKeys = pressedKeysRef.current;
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (!ALL_MOVE_KEYS.has(key) || isTypingTarget(event.target)) {
        return;
      }
      // Stop arrow keys from scrolling the page while roaming the scene.
      event.preventDefault();
      pressedKeys.add(key);
    }
    function handleKeyUp(event: KeyboardEvent) {
      pressedKeys.delete(event.key.toLowerCase());
    }
    function clearKeys() {
      pressedKeys.clear();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    // A lost focus (tab switch) would otherwise strand a key as "held".
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeys);
      pressedKeys.clear();
    };
  }, [keyboardMoveEnabled]);

  const scratchForward = useMemo(() => new Vector3(), []);
  const scratchRight = useMemo(() => new Vector3(), []);
  const scratchMove = useMemo(() => new Vector3(), []);

  useFrame((_, deltaTimeSeconds) => {
    const orbitControls = orbitControlsReference.current;
    if (!orbitControls) {
      return;
    }

    const selectedPlanetPosition = selectedPlanetKey ? planetPositionTracker.get(selectedPlanetKey) : undefined;

    if (selectedPlanetKey) {
      // Focus mode: glide the target onto the selection and follow it.
      hasFreeRoamedRef.current = false;
      desiredTarget.copy(selectedPlanetPosition ?? SCENE_CENTER);
      const frameLerpFactor = 1 - Math.exp(-CAMERA_FOCUS_LERP_SPEED * deltaTimeSeconds);
      orbitControls.target.lerp(desiredTarget, frameLerpFactor);
      orbitControls.update();
      return;
    }

    // Free-roam: apply keyboard panning (target + camera move together).
    const pressedKeys = pressedKeysRef.current;
    let forwardInput = 0;
    let rightInput = 0;
    for (const key of pressedKeys) {
      if (MOVE_FORWARD_KEYS.has(key)) forwardInput += 1;
      if (MOVE_BACKWARD_KEYS.has(key)) forwardInput -= 1;
      if (MOVE_RIGHT_KEYS.has(key)) rightInput += 1;
      if (MOVE_LEFT_KEYS.has(key)) rightInput -= 1;
    }

    if (forwardInput !== 0 || rightInput !== 0) {
      hasFreeRoamedRef.current = true;
      // Horizontal forward = camera look direction flattened to the ground.
      scratchForward.copy(orbitControls.target).sub(camera.position);
      scratchForward.y = 0;
      if (scratchForward.lengthSq() < 0.000001) {
        scratchForward.set(0, 0, -1);
      }
      scratchForward.normalize();
      scratchRight.crossVectors(scratchForward, camera.up).normalize();

      const distance = camera.position.distanceTo(orbitControls.target);
      const panSpeed = Math.min(
        KEYBOARD_PAN_SPEED_MAXIMUM,
        Math.max(KEYBOARD_PAN_SPEED_MINIMUM, distance * KEYBOARD_PAN_SPEED_PER_DISTANCE)
      );
      scratchMove
        .set(0, 0, 0)
        .addScaledVector(scratchForward, forwardInput)
        .addScaledVector(scratchRight, rightInput);
      if (scratchMove.lengthSq() > 0.000001) {
        scratchMove.normalize().multiplyScalar(panSpeed * deltaTimeSeconds);
        camera.position.add(scratchMove);
        orbitControls.target.add(scratchMove);
      }
    } else if (!hasFreeRoamedRef.current) {
      // Idle and never roamed: gently keep the target at the scene center
      // (preserves the original deselect-returns-to-center feel).
      const frameLerpFactor = 1 - Math.exp(-CAMERA_FOCUS_LERP_SPEED * deltaTimeSeconds);
      orbitControls.target.lerp(SCENE_CENTER, frameLerpFactor);
    }
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
