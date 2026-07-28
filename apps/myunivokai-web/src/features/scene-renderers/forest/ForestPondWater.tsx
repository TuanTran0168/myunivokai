"use client";

import { useMemo, useRef } from "react";
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

// Real-looking water needs FOUR things, and the biggest one is geometry.
//
// The surface used to be a literal plane: a triangle fan of one centre vertex
// and a ring of boundary vertices, every one of them at the same height, with no
// interior geometry whatsoever. No material can rescue that — a flat sheet
// reflects the sky uniformly and the eye reads it as painted plastic no matter
// how good the normal map is. The surface is now a tessellated radial grid that
// is genuinely DISPLACED by travelling waves every frame, so it has real relief,
// real varying slope, and a horizon-line that breaks up.
//
// The other three, all of which the earlier passes got wrong at least once:
//
//  * The ripple normal map must not be a LATTICE (see RIPPLE_WAVE_COUNT).
//  * Ripples must be sized in WORLD units, or they scale with the lake.
//  * The surface must be TRANSLUCENT over a painted bed, because from overhead
//    water shows its bottom rather than the sky (see the material below).
//
// Everything is procedural rather than downloaded because there is no asset to
// download: neither Poly Haven (786 CC0 textures) nor ambientCG has a
// water-surface material, and a lake GLB would be a static baked mesh that can
// neither ripple nor shade by depth.

// --- Surface displacement ----------------------------------------------------

/**
 * Travelling waves, longest first. Directions are deliberately NOT aligned and
 * the wavelengths are not integer multiples of each other, so the sum never
 * settles into a repeating pattern the way a tidy harmonic series would.
 * Amplitudes are in world units — a lake this size reads best with a few
 * centimetres of relief; more looks like a storm at sea.
 */
const SURFACE_WAVES = [
  { directionX: 0.93, directionY: 0.37, wavelength: 12.7, amplitude: 0.125, speed: 0.6 },
  { directionX: 0.64, directionY: 0.77, wavelength: 9.1, amplitude: 0.088, speed: 0.68 },
  { directionX: -0.41, directionY: 0.91, wavelength: 6.3, amplitude: 0.062, speed: 0.79 },
  { directionX: 0.99, directionY: -0.14, wavelength: 4.7, amplitude: 0.045, speed: 0.9 },
  { directionX: 0.72, directionY: -0.69, wavelength: 3.3, amplitude: 0.032, speed: 1.02 },
  { directionX: -0.19, directionY: -0.98, wavelength: 2.4, amplitude: 0.023, speed: 1.16 },
  { directionX: -0.87, directionY: -0.49, wavelength: 1.7, amplitude: 0.015, speed: 1.33 },
  { directionX: 0.34, directionY: 0.94, wavelength: 1.2, amplitude: 0.009, speed: 1.5 }
];
/**
 * Gerstner steepness. Plain summed sines give symmetric, rounded swells — which
 * is what made the surface read as regular diagonal banding rather than water.
 * Real waves are SHARP at the crest and flat in the trough, and that asymmetry
 * comes from vertices moving HORIZONTALLY toward the crests, not from a taller
 * vertical wave. Above ~0.5 the displacement starts to fold the mesh over itself.
 */
const WAVE_STEEPNESS = 0.35;
/**
 * Angular segments in the water GRID, independent of the outline's own segment
 * count. Gerstner displacement folds the mesh wherever the lateral shift exceeds
 * the local vertex spacing, and spacing shrinks as segments rise — at the
 * outline's 192 the surface folded almost everywhere. 96 still resolves the
 * shoreline comfortably (its highest harmonic is 11).
 */
const WATER_SURFACE_SEGMENT_COUNT = 96;
/**
 * Lateral displacement fades toward the centre, where all the angular segments
 * converge and spacing becomes tiny. Height is unaffected — only the sideways
 * crowding needs limiting, and near the middle it is invisible anyway.
 */
const LATERAL_CENTRE_CALM_FRACTION = 0.45;

// Rings of tessellation from centre to shore. This is the knob that decides
// whether the surface has relief at all: at 1 it is the old flat fan.
const SURFACE_RING_COUNT = 22;
// Waves fade out over this fraction of the radius so the sheet stays welded to
// the bank — an undulating edge would tear away from the shoreline band.
const SHORE_CALM_FRACTION = 0.16;

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
// World size of one ripple tile. Real wind chop is well under a metre; a couple
// of metres per tile stays visible from the default camera without turning into
// noise.
const RIPPLE_WORLD_TILE_SIZE = 2.4;
const PRIMARY_SCROLL_SPEED = new Vector2(0.021, 0.013);

// Translucency is the whole realism mechanism here: it is what lets the painted
// lake bed through, which is what gives pale shallows and a dark deep centre.
// Fully opaque water seen from overhead cannot look like water.
const LAKE_SURFACE_OPACITY = 0.82;
const POND_SURFACE_OPACITY = 0.88;

// Deliberately LOW. Waves taper to nothing at the rim (SHORE_CALM_FRACTION), so
// only the interior ever troughs, and there the carved bed is more than a metre
// down — the surface does not need to be lifted clear of anything. Raising it to
// clear the deepest trough instead leaves the water visibly perched above its
// own bank, like a filled pool.
const WATER_SURFACE_HEIGHT = 0.07;
// Halved from 0.45. At that strength the tiled ripple map was reading as a
// repeating carpet of dark squiggles across the surface — the geometry waves now
// carry the visible motion, and this is only fine detail on top of them.
const NORMAL_STRENGTH = new Vector2(0.22, 0.22);

// Deep water is darker and more saturated than the shallows. Baked into vertex
// colours rather than taken from MeshReflectorMaterial's depth-blend options,
// which need a depth buffer this scene's alpha-masked foliage does not populate
// cleanly — those banded into a visible grid when they were tried.
const SHALLOW_EDGE_BRIGHTNESS = 1.32;
const DEEP_CENTRE_BRIGHTNESS = 0.58;

/** How far the shoreline band reaches back under the water's edge. */
const SHORELINE_UNDERLAP = 0.45;

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
    const amplitude = 1 / (wavelength * wavelength);
    slopeNormalisation += amplitude * wavelength;
    return { frequencyX: safeFrequencyX, frequencyY, amplitude, phase: nextRandomValue() * Math.PI * 2 };
  });
  const slopeScale = slopeNormalisation > 0 ? 1 / slopeNormalisation : 1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Analytic derivatives of the height field give the slope directly — no
      // finite differencing, so the normals stay smooth.
      let slopeX = 0;
      let slopeY = 0;
      for (const wave of waves) {
        const phase = wave.frequencyX * u + wave.frequencyY * v + wave.phase;
        slopeX += wave.amplitude * wave.frequencyX * Math.cos(phase);
        slopeY += wave.amplitude * wave.frequencyY * Math.cos(phase);
      }
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

type WaterSurfaceMesh = {
  geometry: BufferGeometry;
  /** Per-vertex wave amplitude scale: 0 at the shore, 1 in open water. */
  waveScales: Float32Array;
  /**
   * Undisplaced XY of every vertex. Gerstner waves move vertices sideways, so the
   * wave phase MUST be evaluated at the rest position — reading it back from the
   * live position attribute feeds the displacement into its own input and the
   * surface drifts away every frame.
   */
  restPositions: Float32Array;
  /** Per-vertex scale on the SIDEWAYS Gerstner shift only; guards against folding. */
  lateralScales: Float32Array;
};

/**
 * Tessellated disc whose boundary follows the seeded organic outline. Built in
 * the XY plane so the caller's -PI/2 X rotation lays it flat, which means the
 * surface height is the LOCAL Z coordinate.
 *
 * The interior is a real radial grid rather than a fan: displacement needs
 * vertices to displace, and a fan has none between the centre and the rim.
 */
function buildWaterSurfaceMesh(radius: number, outline: WaterOutline, ringCount: number): WaterSurfaceMesh {
  const segments = WATER_SURFACE_SEGMENT_COUNT;
  const vertexCount = 1 + ringCount * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const waveScales = new Float32Array(vertexCount);
  const restPositions = new Float32Array(vertexCount * 2);
  const lateralScales = new Float32Array(vertexCount);
  const indices: number[] = [];

  // Centre vertex.
  uvs[0] = 0;
  uvs[1] = 0;
  normals[2] = 1;
  colors[0] = DEEP_CENTRE_BRIGHTNESS;
  colors[1] = DEEP_CENTRE_BRIGHTNESS;
  colors[2] = DEEP_CENTRE_BRIGHTNESS;
  waveScales[0] = 1;

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    // Rings bunch up toward the rim, where the depth gradient and the wave
    // fade-out both change fastest.
    const ringFraction = Math.sqrt((ringIndex + 1) / ringCount);
    for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
      const angle = (segmentIndex / segments) * Math.PI * 2;
      const shoreRadius = radius * outline.radiusFactorAt(angle);
      const vertexRadius = shoreRadius * ringFraction;
      const x = Math.cos(angle) * vertexRadius;
      const y = Math.sin(angle) * vertexRadius;
      const vertexIndex = 1 + ringIndex * (segments + 1) + segmentIndex;

      positions[vertexIndex * 3] = x;
      positions[vertexIndex * 3 + 1] = y;
      restPositions[vertexIndex * 2] = x;
      restPositions[vertexIndex * 2 + 1] = y;
      normals[vertexIndex * 3 + 2] = 1;
      // UVs in WORLD units so a ripple tile is the same physical size whatever
      // the surface's radius.
      uvs[vertexIndex * 2] = x;
      uvs[vertexIndex * 2 + 1] = y;

      const shallowness = ringFraction * ringFraction;
      const brightness = DEEP_CENTRE_BRIGHTNESS + (SHALLOW_EDGE_BRIGHTNESS - DEEP_CENTRE_BRIGHTNESS) * shallowness;
      colors[vertexIndex * 3] = brightness;
      colors[vertexIndex * 3 + 1] = brightness;
      colors[vertexIndex * 3 + 2] = brightness;

      // Smoothstep, not linear: a linear taper leaves a visible crease where it
      // starts, and it keeps too much amplitude right at the rim — enough for a
      // trough to dip through the shoreline band it overlaps.
      const shoreFade = Math.min(1, (1 - ringFraction) / SHORE_CALM_FRACTION);
      waveScales[vertexIndex] = shoreFade * shoreFade * (3 - 2 * shoreFade);
      const centreFade = Math.min(1, ringFraction / LATERAL_CENTRE_CALM_FRACTION);
      lateralScales[vertexIndex] = centreFade * centreFade * (3 - 2 * centreFade);

      if (segmentIndex < segments) {
        if (ringIndex === 0) {
          indices.push(0, vertexIndex, vertexIndex + 1);
        } else {
          const inner = vertexIndex - (segments + 1);
          indices.push(inner, vertexIndex, vertexIndex + 1);
          indices.push(inner, vertexIndex + 1, inner + 1);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, waveScales, restPositions, lateralScales };
}

/**
 * Displace the surface to time `elapsedSeconds`. Normals come from the ANALYTIC
 * derivative of the same height field rather than from recomputing face normals,
 * which would cost a full pass over the index buffer every frame and come out
 * faceted anyway.
 */
function displaceWaterSurface(
  geometry: BufferGeometry,
  waveScales: Float32Array,
  restPositions: Float32Array,
  lateralScales: Float32Array,
  elapsedSeconds: number
): void {
  const positionAttribute = geometry.getAttribute("position") as BufferAttribute;
  const normalAttribute = geometry.getAttribute("normal") as BufferAttribute;
  const positions = positionAttribute.array as Float32Array;
  const normals = normalAttribute.array as Float32Array;

  for (let vertexIndex = 0; vertexIndex < waveScales.length; vertexIndex += 1) {
    const offset = vertexIndex * 3;
    const restX = restPositions[vertexIndex * 2];
    const restY = restPositions[vertexIndex * 2 + 1];
    const waveScale = waveScales[vertexIndex];
    const lateralScale = lateralScales[vertexIndex];

    let height = 0;
    let shiftX = 0;
    let shiftY = 0;
    let slopeX = 0;
    let slopeY = 0;
    for (const wave of SURFACE_WAVES) {
      const angularFrequency = (Math.PI * 2) / wave.wavelength;
      const phase =
        (wave.directionX * restX + wave.directionY * restY) * angularFrequency -
        elapsedSeconds * wave.speed * angularFrequency;
      const amplitude = wave.amplitude * waveScale;
      const sinPhase = Math.sin(phase);
      const cosPhase = Math.cos(phase);
      height += amplitude * sinPhase;
      // Gerstner: vertices crowd toward the crests, which sharpens them and
      // flattens the troughs. Scaled by waveScale as well, so the rim stays put.
      const lateral = WAVE_STEEPNESS * amplitude * lateralScale * cosPhase;
      shiftX += lateral * wave.directionX;
      shiftY += lateral * wave.directionY;
      const slopeTerm = amplitude * angularFrequency * cosPhase;
      slopeX += slopeTerm * wave.directionX;
      slopeY += slopeTerm * wave.directionY;
    }

    positions[offset] = restX + shiftX;
    positions[offset + 1] = restY + shiftY;
    positions[offset + 2] = height;
    // Local +Z is the surface up-axis, so the normal is (-dh/dx, -dh/dy, 1).
    const length = Math.hypot(slopeX, slopeY, 1) || 1;
    normals[offset] = -slopeX / length;
    normals[offset + 1] = -slopeY / length;
    normals[offset + 2] = 1 / length;
  }

  positionAttribute.needsUpdate = true;
  normalAttribute.needsUpdate = true;
}

type ForestPondWaterProps = {
  /** MEAN radius: the organic outline varies around it. */
  radius: number;
  /** Landmark accent, mixed into the water tint so ponds stay per-world. */
  tintColor: string;
  /** Drives the shoreline shape; same seed, same lake. */
  shapeSeed: string;
  /**
   * Deeper tint and stronger sky response for the hero lake. Ponds are small
   * enough that the difference is invisible, and keeping one material path means
   * one set of behaviour to reason about.
   */
  reflective?: boolean;
};

export function ForestPondWater({ radius, tintColor, shapeSeed, reflective = true }: ForestPondWaterProps) {
  const outline = useMemo(() => createWaterOutline(shapeSeed), [shapeSeed]);
  const { geometry, waveScales, restPositions, lateralScales } = useMemo(
    // A pond does not need a lake's tessellation; scale rings with radius.
    () => buildWaterSurfaceMesh(radius, outline, Math.max(6, Math.round(SURFACE_RING_COUNT * Math.min(1, radius / 8)))),
    [outline, radius]
  );

  // UVs are already in world units, so "repeat" here is tiles per world unit.
  const normalTexture = useMemo(() => {
    const tilesPerWorldUnit = 1 / RIPPLE_WORLD_TILE_SIZE;
    const texture = getRippleNormalTexture().clone();
    texture.repeat.set(tilesPerWorldUnit, tilesPerWorldUnit);
    texture.needsUpdate = true;
    return texture;
  }, []);
  const elapsedSecondsRef = useRef(0);

  useFrame((_, deltaTimeSeconds) => {
    // Clamped for the same reason the animals' clock is: one huge frame delta
    // after a stall would jump the wave phase and read as a glitch.
    elapsedSecondsRef.current += Math.min(deltaTimeSeconds, 1 / 15);
    const elapsedSeconds = elapsedSecondsRef.current;
    displaceWaterSurface(geometry, waveScales, restPositions, lateralScales, elapsedSeconds);
    normalTexture.offset.set(elapsedSeconds * PRIMARY_SCROLL_SPEED.x, elapsedSeconds * PRIMARY_SCROLL_SPEED.y);
  });

  return (
    <mesh geometry={geometry} position={[0, WATER_SURFACE_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      {/* TRANSLUCENT, not a mirror. The camera looks nearly straight down, and at
          normal incidence water's Fresnel reflectance is only about 2% - from
          above you see the BOTTOM, not the sky. MeshReflectorMaterial spent a
          whole extra scene render to produce a uniform dark wash, which is
          exactly what made the lake read as opaque spilled liquid rather than
          water. Transparency over the painted lake bed (see ForestTerrain) is
          both cheaper and what the physics calls for, and the environment map
          still gives real sky reflection as the camera tilts toward grazing
          angles - which is the only place a mirror was ever earning its cost. */}
      <meshStandardMaterial
        color={tintColor}
        transparent
        opacity={reflective ? LAKE_SURFACE_OPACITY : POND_SURFACE_OPACITY}
        roughness={0.16}
        metalness={0.22}
        envMapIntensity={reflective ? 2.1 : 1.5}
        vertexColors
        normalMap={normalTexture as unknown as Texture}
        normalScale={NORMAL_STRENGTH}
      />
    </mesh>
  );
}

/**
 * Shoreline band hugging the same outline, so the bank is never a clean arc.
 *
 * An annulus, not a disc: a full disc under the lake would z-fight the water
 * everywhere and a wave trough could sink through it.
 */
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
  const geometry = useMemo(() => {
    const segments = outline.segments;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices: number[] = [];
    for (let segmentIndex = 0; segmentIndex <= segments; segmentIndex += 1) {
      const angle = (segmentIndex / segments) * Math.PI * 2;
      // Tucked slightly UNDER the water so the joint never shows a gap, whatever
      // the water surface is doing at the rim.
      const innerRadius = radius * outline.radiusFactorAt(angle) - SHORELINE_UNDERLAP;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const innerIndex = segmentIndex * 2;
      const outerIndex = innerIndex + 1;
      positions[innerIndex * 3] = cosine * innerRadius;
      positions[innerIndex * 3 + 1] = sine * innerRadius;
      positions[outerIndex * 3] = cosine * (innerRadius + bandWidth);
      positions[outerIndex * 3 + 1] = sine * (innerRadius + bandWidth);
      if (segmentIndex < segments) {
        indices.push(innerIndex, outerIndex, innerIndex + 2);
        indices.push(outerIndex, outerIndex + 2, innerIndex + 2);
      }
    }
    const bandGeometry = new BufferGeometry();
    bandGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    bandGeometry.setIndex(indices);
    bandGeometry.computeVertexNormals();
    return bandGeometry;
  }, [bandWidth, outline, radius]);

  return (
    <mesh geometry={geometry} position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}
