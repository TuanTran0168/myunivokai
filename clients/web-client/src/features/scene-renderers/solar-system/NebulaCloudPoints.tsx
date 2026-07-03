"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { Blending } from "three";
import { getNebulaCloudTexture } from "../shared/nebulaCloudTexture";

/**
 * A layer of large, faint, individually-rotated cloud sprites sampled from
 * the shared noise texture. Dozens of overlapping copies fuse into
 * continuous nebulosity instead of visible dots. With additive blending the
 * layer glows (nebula, galactic core); with normal blending and a dark
 * color it darkens what is behind it (the Milky Way's dust lanes).
 */

const CLOUD_VERTEX_SHADER = /* glsl */ `
  attribute float cloudSize;
  attribute vec3 cloudColor;
  attribute float cloudRotation;
  attribute float cloudAlpha;
  uniform float uPointScale;
  varying vec3 vCloudColor;
  varying float vCloudRotation;
  varying float vCloudAlpha;

  void main() {
    vCloudColor = cloudColor;
    vCloudRotation = cloudRotation;
    vCloudAlpha = cloudAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = cloudSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Each sprite samples the noise texture through a per-cloud rotation, so one
// shared texture never reads as repeated stamps. Rotated corners sample past
// the texture edge, which is fully transparent by construction.
const CLOUD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uCloudMap;
  uniform float uGlobalOpacity;
  varying vec3 vCloudColor;
  varying float vCloudRotation;
  varying float vCloudAlpha;

  void main() {
    vec2 centeredCoord = gl_PointCoord - vec2(0.5);
    float rotationCosine = cos(vCloudRotation);
    float rotationSine = sin(vCloudRotation);
    vec2 rotatedCoord = vec2(
      centeredCoord.x * rotationCosine - centeredCoord.y * rotationSine,
      centeredCoord.x * rotationSine + centeredCoord.y * rotationCosine
    ) + vec2(0.5);
    float sampledAlpha = texture2D(uCloudMap, rotatedCoord).a;
    float alpha = sampledAlpha * vCloudAlpha * uGlobalOpacity;
    if (alpha < 0.004) {
      discard;
    }
    gl_FragColor = vec4(vCloudColor, alpha);
  }
`;

export type CloudLayerAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  rotations: Float32Array;
  alphas: Float32Array;
};

type NebulaCloudPointsProps = {
  clouds: CloudLayerAttributes;
  globalOpacity: number;
  blending: Blending;
  renderOrder?: number;
};

const DEFAULT_RENDER_ORDER = 0;

export function NebulaCloudPoints({
  clouds,
  globalOpacity,
  blending,
  renderOrder = DEFAULT_RENDER_ORDER
}: NebulaCloudPointsProps) {
  // Created once; useFrame keeps the values current without rebuilding the
  // material (a new uniforms object would recompile the shader program).
  const uniforms = useMemo(
    () => ({
      uCloudMap: { value: getNebulaCloudTexture() },
      uPointScale: { value: 1 },
      uGlobalOpacity: { value: 0 }
    }),
    []
  );

  useFrame((state) => {
    // Same sizeAttenuation convention as the star layers, so cloud sizes are
    // stable across window sizes and device pixel ratios.
    uniforms.uPointScale.value = (state.size.height * state.gl.getPixelRatio()) / 2;
    uniforms.uGlobalOpacity.value = globalOpacity;
  });

  return (
    <points frustumCulled={false} renderOrder={renderOrder}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={clouds.positions.length / 3}
          array={clouds.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-cloudColor"
          count={clouds.colors.length / 3}
          array={clouds.colors}
          itemSize={3}
        />
        <bufferAttribute attach="attributes-cloudSize" count={clouds.sizes.length} array={clouds.sizes} itemSize={1} />
        <bufferAttribute
          attach="attributes-cloudRotation"
          count={clouds.rotations.length}
          array={clouds.rotations}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-cloudAlpha"
          count={clouds.alphas.length}
          array={clouds.alphas}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={CLOUD_VERTEX_SHADER}
        fragmentShader={CLOUD_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={blending}
      />
    </points>
  );
}
