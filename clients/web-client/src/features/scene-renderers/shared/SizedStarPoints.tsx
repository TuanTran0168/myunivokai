"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending } from "three";

/**
 * Star points with a PER-STAR size, color and twinkle phase. three's stock
 * PointsMaterial gives every point in a layer the same size, which is what
 * made the sky read as uniform "confetti"; a real starfield follows a power
 * law — thousands of faint pinpricks and only a handful of bright glows.
 * The fragment shader draws each star as a hot compact core plus a wide
 * faint halo (the way stars bloom in long-exposure photographs) and
 * modulates it with a slow twinkle.
 *
 * Colors are passed as RAW sRGB values and written to the framebuffer
 * unconverted (a raw ShaderMaterial skips three's color-space and
 * tone-mapping chunks), so the authored hex palette is exactly what shows
 * on screen.
 */

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float starSize;
  attribute vec3 starColor;
  attribute float twinklePhase;
  uniform float uPointScale;
  varying vec3 vStarColor;
  varying float vTwinklePhase;

  void main() {
    vStarColor = starColor;
    vTwinklePhase = twinklePhase;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = starSize * (uPointScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Core + halo can sum past 1.0 at the very center; the framebuffer clamps
// per channel, so bright star centers wash toward white while their edges
// keep the star's tint — exactly how stars over-expose in photographs.
const STAR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTimeSeconds;
  uniform float uGlobalOpacity;
  varying vec3 vStarColor;
  varying float vTwinklePhase;

  void main() {
    vec2 offsetFromCenter = gl_PointCoord - vec2(0.5);
    float normalizedDistance = length(offsetFromCenter) * 2.0;
    if (normalizedDistance > 1.0) {
      discard;
    }
    float coreIntensity = smoothstep(0.42, 0.0, normalizedDistance);
    float haloIntensity = 0.5 * exp(-4.0 * normalizedDistance);
    float twinkle = 0.85 + 0.15 * sin(uTimeSeconds * 1.4 + vTwinklePhase);
    float intensity = (coreIntensity + haloIntensity) * twinkle * uGlobalOpacity;
    if (intensity < 0.01) {
      discard;
    }
    // Alpha stays 1.0: with additive blending the contribution is rgb * alpha,
    // so baking intensity into rgb keeps the falloff linear instead of squared.
    gl_FragColor = vec4(vStarColor * intensity, 1.0);
  }
`;

export type StarLayerAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  twinklePhases: Float32Array;
};

type SizedStarPointsProps = {
  stars: StarLayerAttributes;
  globalOpacity?: number;
  renderOrder?: number;
  /** Forces the buffer geometry to remount when the star arrays change. */
  geometryKey?: string;
};

const DEFAULT_GLOBAL_OPACITY = 1;
const DEFAULT_RENDER_ORDER = 0;

/**
 * Parses a #RRGGBB hex color into raw sRGB unit components, bypassing
 * three's Color class on purpose: Color converts hex to the linear working
 * space, but this shader writes colors to the framebuffer unconverted.
 */
export function hexColorToUnitRgb(hexColor: string): [number, number, number] {
  const parsedColor = Number.parseInt(hexColor.slice(1), 16);
  return [
    ((parsedColor >> 16) & 0xff) / 255,
    ((parsedColor >> 8) & 0xff) / 255,
    (parsedColor & 0xff) / 255
  ];
}

export function SizedStarPoints({
  stars,
  globalOpacity = DEFAULT_GLOBAL_OPACITY,
  renderOrder = DEFAULT_RENDER_ORDER,
  geometryKey
}: SizedStarPointsProps) {
  // Created once; useFrame keeps the values current without rebuilding the
  // material (a new uniforms object would recompile the shader program).
  const uniforms = useMemo(
    () => ({
      uPointScale: { value: 1 },
      uTimeSeconds: { value: 0 },
      uGlobalOpacity: { value: DEFAULT_GLOBAL_OPACITY }
    }),
    []
  );

  useFrame((state) => {
    // Matches PointsMaterial's sizeAttenuation convention (half the drawing
    // buffer height), so star sizes stay consistent across window sizes and
    // device pixel ratios.
    uniforms.uPointScale.value = (state.size.height * state.gl.getPixelRatio()) / 2;
    uniforms.uTimeSeconds.value = state.clock.elapsedTime;
    uniforms.uGlobalOpacity.value = globalOpacity;
  });

  return (
    <points frustumCulled={false} renderOrder={renderOrder}>
      <bufferGeometry key={geometryKey}>
        <bufferAttribute
          attach="attributes-position"
          count={stars.positions.length / 3}
          array={stars.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-starColor"
          count={stars.colors.length / 3}
          array={stars.colors}
          itemSize={3}
        />
        <bufferAttribute attach="attributes-starSize" count={stars.sizes.length} array={stars.sizes} itemSize={1} />
        <bufferAttribute
          attach="attributes-twinklePhase"
          count={stars.twinklePhases.length}
          array={stars.twinklePhases}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={STAR_VERTEX_SHADER}
        fragmentShader={STAR_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
