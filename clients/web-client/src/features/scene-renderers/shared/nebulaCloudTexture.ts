import { CanvasTexture } from "three";
import { randomFromSeed } from "@/lib/scene";

/**
 * A runtime-generated nebula cloud sprite: seeded multi-octave value noise
 * shaped by a radial falloff, stored in the ALPHA channel (RGB stays white
 * so the material tints it). Large overlapping copies of this sprite blend
 * into continuous wispy nebulosity — the thing photographs of the Milky Way
 * show and plain dot-particles never do. Lazy singleton, seeded so every
 * visitor sees the same clouds.
 */

const CLOUD_TEXTURE_SEED = "myunivokai-nebula-cloud";
const TEXTURE_SIZE_PIXELS = 256;
const NOISE_OCTAVE_COUNT = 4;
const NOISE_BASE_CELLS_PER_SIDE = 4;
// Only the brighter half of the noise becomes visible, so clouds have holes
// and filaments instead of reading as an even fog.
const NOISE_VISIBILITY_FLOOR = 0.32;
const NOISE_CONTRAST_EXPONENT = 1.7;
// Alpha is forced to zero before the sprite edge so the square texture can
// never show a hard border, even when the sprite is rotated in the shader.
const RADIAL_FALLOFF_START_RADIUS = 0.3;

type RandomSource = () => number;

function smoothInterpolationWeight(fraction: number): number {
  return fraction * fraction * (3 - 2 * fraction);
}

function buildRandomValueGrid(random: RandomSource, cellsPerSide: number): Float32Array {
  const verticesPerSide = cellsPerSide + 1;
  const grid = new Float32Array(verticesPerSide * verticesPerSide);
  for (let vertexIndex = 0; vertexIndex < grid.length; vertexIndex += 1) {
    grid[vertexIndex] = random();
  }
  return grid;
}

function sampleValueGrid(grid: Float32Array, cellsPerSide: number, u: number, v: number): number {
  const verticesPerSide = cellsPerSide + 1;
  const gridX = u * cellsPerSide;
  const gridY = v * cellsPerSide;
  const columnIndex = Math.min(Math.floor(gridX), cellsPerSide - 1);
  const rowIndex = Math.min(Math.floor(gridY), cellsPerSide - 1);
  const weightX = smoothInterpolationWeight(gridX - columnIndex);
  const weightY = smoothInterpolationWeight(gridY - rowIndex);
  const topLeft = grid[rowIndex * verticesPerSide + columnIndex];
  const topRight = grid[rowIndex * verticesPerSide + columnIndex + 1];
  const bottomLeft = grid[(rowIndex + 1) * verticesPerSide + columnIndex];
  const bottomRight = grid[(rowIndex + 1) * verticesPerSide + columnIndex + 1];
  const interpolatedTop = topLeft + (topRight - topLeft) * weightX;
  const interpolatedBottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
  return interpolatedTop + (interpolatedBottom - interpolatedTop) * weightY;
}

function radialFalloff(normalizedRadius: number): number {
  if (normalizedRadius <= RADIAL_FALLOFF_START_RADIUS) {
    return 1;
  }
  if (normalizedRadius >= 1) {
    return 0;
  }
  const falloffFraction = (1 - normalizedRadius) / (1 - RADIAL_FALLOFF_START_RADIUS);
  return smoothInterpolationWeight(falloffFraction);
}

let sharedNebulaCloudTexture: CanvasTexture | null = null;

export function getNebulaCloudTexture(): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (sharedNebulaCloudTexture) {
    return sharedNebulaCloudTexture;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE_PIXELS;
  canvas.height = TEXTURE_SIZE_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const random = randomFromSeed(CLOUD_TEXTURE_SEED);
  const octaves: { grid: Float32Array; cellsPerSide: number; amplitude: number }[] = [];
  let amplitudeSum = 0;
  for (let octaveIndex = 0; octaveIndex < NOISE_OCTAVE_COUNT; octaveIndex += 1) {
    const cellsPerSide = NOISE_BASE_CELLS_PER_SIDE * 2 ** octaveIndex;
    const amplitude = 0.5 ** octaveIndex;
    amplitudeSum += amplitude;
    octaves.push({ grid: buildRandomValueGrid(random, cellsPerSide), cellsPerSide, amplitude });
  }

  const imageData = context.createImageData(TEXTURE_SIZE_PIXELS, TEXTURE_SIZE_PIXELS);
  const halfSizePixels = TEXTURE_SIZE_PIXELS / 2;
  for (let pixelY = 0; pixelY < TEXTURE_SIZE_PIXELS; pixelY += 1) {
    for (let pixelX = 0; pixelX < TEXTURE_SIZE_PIXELS; pixelX += 1) {
      const u = pixelX / (TEXTURE_SIZE_PIXELS - 1);
      const v = pixelY / (TEXTURE_SIZE_PIXELS - 1);
      let noiseValue = 0;
      for (const octave of octaves) {
        noiseValue += sampleValueGrid(octave.grid, octave.cellsPerSide, u, v) * octave.amplitude;
      }
      noiseValue /= amplitudeSum;
      const liftedValue = Math.max(0, (noiseValue - NOISE_VISIBILITY_FLOOR) / (1 - NOISE_VISIBILITY_FLOOR));
      const shapedValue = liftedValue ** NOISE_CONTRAST_EXPONENT;
      const normalizedRadius = Math.hypot(pixelX - halfSizePixels, pixelY - halfSizePixels) / halfSizePixels;
      const alpha = shapedValue * radialFalloff(normalizedRadius);
      const pixelOffset = (pixelY * TEXTURE_SIZE_PIXELS + pixelX) * 4;
      imageData.data[pixelOffset] = 255;
      imageData.data[pixelOffset + 1] = 255;
      imageData.data[pixelOffset + 2] = 255;
      imageData.data[pixelOffset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(imageData, 0, 0);
  sharedNebulaCloudTexture = new CanvasTexture(canvas);
  return sharedNebulaCloudTexture;
}
