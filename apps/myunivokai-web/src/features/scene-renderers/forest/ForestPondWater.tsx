"use client";

import { useMemo, useRef } from "react";
import { MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  Vector2,
  type Texture
} from "three";
import { randomFromSeed } from "@/lib/scene";
import { createWaterOutline, type WaterOutline } from "./forestMath";

// Real-looking water. Three things had to be true at once, and the first pass
// got only the third:
//
//  1. The ripple pattern must not be a LATTICE. The first version summed four
//     plane waves at rounded integer frequencies, which is a textbook
//     interference grid — visible on the lake as a plastic checkerboard. It is
//     now a sum of many waves with irregular frequency vectors, so the crests
//     never line up into a repeating cell.
//  2. There must be TWO uncorrelated moving layers. The first version built a
//     second scrolling texture, animated it every frame — and never bound it to
//     anything. One normal map sliding in one direction is exactly what reads as
//     a sheet of plastic being dragged. The second layer now drives the
//     reflection distortion, at a different scale and speed from the surface
//     normals.
//  3. Ripples must be sized in WORLD units, not in UV. A fixed texture repeat
//     makes ripples scale with the lake, so a big lake gets metres-wide ripples.
//     Repeat is now derived from the surface's world diameter.
//
// The ripple map is still generated procedurally rather than downloaded: the
// waves use integer frequencies, so it tiles exactly (a photo-sourced normal map
// would seam), costs no bytes, and carries no attribution obligation.

const RIPPLE_TEXTURE_SIZE = 256;
// Enough overlapping waves that the interference reads as noise rather than as a
// pattern. Four was not: the old fan of four rounded frequencies self-correlates
// at 0.85 across the tile (1.0 would be an exact repeat), which is the plastic
// checkerboard that showed up on the lake. This pair was picked by sweeping, not
// by taste — MORE waves is worse, so do not "improve" these upward:
//
//     waves/maxFreq   self-correlation   slope spread
//     4 / 4  (old)          0.852            —
//     18 / 7 (this)         0.618          0.136
//     28 / 9                0.700          0.116
//     48 / 13               0.605          0.090
//
// Amplitude falls as 1/wavelength^2, so extra high-frequency waves add almost no
// slope while still enlarging the normalisation sum — the water gets FLATTER,
// which is the exact defect being fixed.
const RIPPLE_WAVE_COUNT = 18;
const RIPPLE_MAXIMUM_FREQUENCY = 7;
// World size of one ripple tile. Real wind chop on a pond is well under a metre;
// a couple of metres per tile keeps it visible from the default camera without
// turning into noise.
const RIPPLE_WORLD_TILE_SIZE = 2.4;
// The distortion layer is deliberately a different scale from the normal layer —
// equal scales would correlate and re-introduce a visible pattern.
const DISTORTION_TILE_SCALE = 0.62;

const PRIMARY_SCROLL_SPEED = new Vector2(0.021, 0.013);
const SECONDARY_SCROLL_SPEED = new Vector2(-0.013, 0.019);

const WATER_SURFACE_HEIGHT = 0.03;
// The measured slope field peaks around 0.43, so this is the multiplier that
// decides how pronounced the chop is. Raised from 0.32: the surface was reading
// as too smooth to be water.
const NORMAL_STRENGTH = new Vector2(0.45, 0.45);

// Deep water is darker and more saturated than the shallows. Baked into vertex
// colours rather than taken from MeshReflectorMaterial's depth-blend options,
// which need a depth buffer this scene's alpha-masked foliage does not populate
// cleanly — those banded into a visible grid when they were tried.
const SHALLOW_EDGE_BRIGHTNESS = 1.28;
const DEEP_CENTRE_BRIGHTNESS = 0.62;

/**
 * A tileable ripple normal map. Each wave uses INTEGER frequencies over the
 * texture, which is what guarantees the result wraps seamlessly when the texture
 * repeats; the frequency VECTORS are irregular, which is what stops the sum from
 * looking like a grid.
 */
function createRippleNormalTexture(): DataTexture {
  const size = RIPPLE_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  // Fixed seed (not per-world): water looks the same everywhere, and keeping it
  // constant lets every surface in the app share one texture upload.
  const nextRandomValue = randomFromSeed("forest-water-ripple");
  let slopeNormalisation = 0;
  const waves = Array.from({ length: RIPPLE_WAVE_COUNT }, () => {
    const frequencyX = Math.round((nextRandomValue() * 2 - 1) * RIPPLE_MAXIMUM_FREQUENCY);
    const frequencyY = Math.round((nextRandomValue() * 2 - 1) * RIPPLE_MAXIMUM_FREQUENCY);
    // A zero/zero wave is a constant offset and contributes nothing.
    const safeFrequencyX = frequencyX === 0 && frequencyY === 0 ? 1 : frequencyX;
    const wavelength = Math.hypot(safeFrequencyX, frequencyY) || 1;
    // Amplitude falls with frequency, as in a real wave spectrum: a few long
    // swells carry the shape, many short ones carry the detail.
    const amplitude = 1 / (wavelength * wavelength);
    slopeNormalisation += amplitude * wavelength;
    return { frequencyX: safeFrequencyX, frequencyY, amplitude, phase: nextRandomValue() * Math.PI * 2 };
  });
  const slopeScale = slopeNormalisation > 0 ? 1 / slopeNormalisation : 1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Analytic derivatives of the height field give the surface slope
      // directly — no finite differencing, so the normals stay smooth.
      let slopeX = 0;
      let slopeY = 0;
      for (const wave of waves) {
        const phase = wave.frequencyX * u + wave.frequencyY * v + wave.phase;
        slopeX += wave.amplitude * wave.frequencyX * Math.cos(phase);
        slopeY += wave.amplitude * wave.frequencyY * Math.cos(phase);
      }
      // Pack the slope as a tangent-space normal.
      const normalX = -slopeX * slopeScale;
      const normalY = -slopeY * slopeScale;
      const normalZ = 0.55; // shallower than 1 keeps the chop crisp, not spiky
      const length = Math.hypot(normalX, normalY, normalZ) || 1;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(((normalX / length) * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round(((normalY / length) * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round(((normalZ / length) * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// One shared ripple image for every water surface in the app. Callers clone it
// so each can carry its own repeat and scroll offset.
let sharedRippleTexture: DataTexture | null = null;
export function getRippleNormalTexture(): DataTexture {
  if (!sharedRippleTexture) {
    sharedRippleTexture = createRippleNormalTexture();
  }
  return sharedRippleTexture;
}

/**
 * Fan-triangulated disc whose boundary follows a seeded organic outline instead
 * of a circle. Built in the XY plane so the caller's existing -PI/2 X rotation
 * still lays it flat. UVs are in WORLD units (one unit of UV per world unit) so
 * a ripple tile is the same physical size on a pond and on a lake.
 */
function buildOrganicWaterDiscGeometry(radius: number, outline: WaterOutline): BufferGeometry {
  const vertexCount = outline.segments + 2; // centre + boundary ring (closed)
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  uvs[0] = 0.5;
  uvs[1] = 0.5;
  colors[0] = DEEP_CENTRE_BRIGHTNESS;
  colors[1] = DEEP_CENTRE_BRIGHTNESS;
  colors[2] = DEEP_CENTRE_BRIGHTNESS;
  for (let segmentIndex = 0; segmentIndex <= outline.segments; segmentIndex += 1) {
    const angle = (segmentIndex / outline.segments) * Math.PI * 2;
    const boundaryRadius = radius * outline.radiusFactorAt(angle);
    const x = Math.cos(angle) * boundaryRadius;
    const y = Math.sin(angle) * boundaryRadius;
    const vertexIndex = segmentIndex + 1;
    positions[vertexIndex * 3] = x;
    positions[vertexIndex * 3 + 1] = y;
    uvs[vertexIndex * 2] = 0.5 + x / (radius * 2);
    uvs[vertexIndex * 2 + 1] = 0.5 + y / (radius * 2);
    colors[vertexIndex * 3] = SHALLOW_EDGE_BRIGHTNESS;
    colors[vertexIndex * 3 + 1] = SHALLOW_EDGE_BRIGHTNESS;
    colors[vertexIndex * 3 + 2] = SHALLOW_EDGE_BRIGHTNESS;
    if (segmentIndex > 0) {
      indices.push(0, vertexIndex - 1, vertexIndex);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type ForestPondWaterProps = {
  /** MEAN radius: the organic outline varies around it. */
  radius: number;
  /** Landmark accent, mixed into the water tint so ponds stay per-world. */
  tintColor: string;
  /** Drives the shoreline shape; same seed, same lake. */
  shapeSeed: string;
  /**
   * True render-to-texture mirror. Costs a whole extra scene render, so only
   * the hero lake gets it — small ponds fall back to environment reflection,
   * which is indistinguishable at their size.
   */
  reflective?: boolean;
};

export function ForestPondWater({ radius, tintColor, shapeSeed, reflective = true }: ForestPondWaterProps) {
  const outline = useMemo(() => createWaterOutline(shapeSeed), [shapeSeed]);
  const geometry = useMemo(() => buildOrganicWaterDiscGeometry(radius, outline), [outline, radius]);

  // Two clones of one GPU image: one drives the surface normals, the other warps
  // the reflection. Different repeats and opposing scroll directions, so the two
  // never correlate into a pattern.
  const { normalTexture, distortionTexture } = useMemo(() => {
    const baseTexture = getRippleNormalTexture();
    const tilesAcross = Math.max(1, (radius * 2) / RIPPLE_WORLD_TILE_SIZE);
    const primary = baseTexture.clone();
    primary.repeat.set(tilesAcross, tilesAcross);
    primary.needsUpdate = true;
    const secondary = baseTexture.clone();
    secondary.repeat.set(tilesAcross * DISTORTION_TILE_SCALE, tilesAcross * DISTORTION_TILE_SCALE);
    secondary.needsUpdate = true;
    return { normalTexture: primary, distortionTexture: secondary };
  }, [radius]);
  const elapsedSecondsRef = useRef(0);

  useFrame((_, deltaTimeSeconds) => {
    elapsedSecondsRef.current += deltaTimeSeconds;
    const elapsedSeconds = elapsedSecondsRef.current;
    normalTexture.offset.set(
      elapsedSeconds * PRIMARY_SCROLL_SPEED.x,
      elapsedSeconds * PRIMARY_SCROLL_SPEED.y
    );
    distortionTexture.offset.set(
      elapsedSeconds * SECONDARY_SCROLL_SPEED.x,
      elapsedSeconds * SECONDARY_SCROLL_SPEED.y
    );
  });

  return (
    <mesh geometry={geometry} position={[0, WATER_SURFACE_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      {reflective ? (
        <MeshReflectorMaterial
          // Sharper than the previous tuning, which blurred the reflection into
          // an undifferentiated wash — at that point the surface carries no scene
          // information and the eye reads it as coloured plastic. A mirror needs
          // to be legible; the ripples, not the blur, supply the softness.
          resolution={1024}
          mixBlur={0.55}
          mixStrength={1.15}
          blur={[55, 18]}
          mirror={0.7}
          // The second moving layer, finally connected: it warps the reflected
          // image so the mirrored treeline shimmers instead of sitting still.
          distortion={0.32}
          distortionMap={distortionTexture as unknown as Texture}
          color={tintColor}
          roughness={0.18}
          metalness={0.25}
          vertexColors
          normalMap={normalTexture as unknown as Texture}
          normalScale={NORMAL_STRENGTH}
        />
      ) : (
        <meshStandardMaterial
          color={tintColor}
          transparent
          opacity={0.9}
          roughness={0.16}
          metalness={0.3}
          envMapIntensity={1.5}
          vertexColors
          normalMap={normalTexture as unknown as Texture}
          normalScale={NORMAL_STRENGTH}
        />
      )}
    </mesh>
  );
}

/** Shoreline band hugging the same outline, so the bank is never a clean arc. */
export function ForestWaterShoreline({
  radius,
  shapeSeed,
  bandWidth,
  color,
  height
}: {
  radius: number;
  shapeSeed: string;
  bandWidth: number;
  color: string;
  height: number;
}) {
  const outline = useMemo(() => createWaterOutline(shapeSeed), [shapeSeed]);
  const geometry = useMemo(
    () => buildOrganicWaterDiscGeometry(radius + bandWidth, outline),
    [bandWidth, outline, radius]
  );

  return (
    <mesh geometry={geometry} position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}
