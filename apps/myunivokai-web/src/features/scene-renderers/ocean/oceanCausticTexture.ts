import { CanvasTexture, RepeatWrapping } from "three";

/**
 * A runtime-generated caustic pattern: the bright web the water surface
 * projects onto a seabed.
 *
 * Built here rather than reusing the shared light-shaft texture for two
 * reasons. The shaft texture is a vertical gradient, which reads as a soft blob
 * when laid flat. And the caustic layers SCROLL, which means mutating
 * `texture.offset` — a shared singleton would have two layers fighting over one
 * offset, so each layer gets its own instance.
 *
 * The pattern itself is the interference of three sine gratings at different
 * angles, thresholded hard. Real caustics are the envelope of refracted rays
 * and look like a cellular web; three crossing gratings produce the same
 * cell structure for a fraction of the work, and at the scale these are
 * projected nobody can tell the difference.
 */

const TEXTURE_SIZE_PIXELS = 256;
const GRATING_ANGLES_RADIANS = [0.0, 1.05, 2.1];
const GRATING_FREQUENCY = 5;
const RIDGE_SHARPNESS = 6;

export function createCausticTexture(): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE_PIXELS;
  canvas.height = TEXTURE_SIZE_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const image = context.createImageData(TEXTURE_SIZE_PIXELS, TEXTURE_SIZE_PIXELS);
  for (let y = 0; y < TEXTURE_SIZE_PIXELS; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE_PIXELS; x += 1) {
      // Normalised to [0, 2π) so the pattern tiles seamlessly: the gratings
      // complete a whole number of cycles across the texture.
      const u = (x / TEXTURE_SIZE_PIXELS) * Math.PI * 2;
      const v = (y / TEXTURE_SIZE_PIXELS) * Math.PI * 2;
      let sum = 0;
      for (const angle of GRATING_ANGLES_RADIANS) {
        sum += Math.sin((u * Math.cos(angle) + v * Math.sin(angle)) * GRATING_FREQUENCY);
      }
      const normalized = (sum / GRATING_ANGLES_RADIANS.length + 1) / 2;
      // Raising to a power keeps only the crests, which is what turns a smooth
      // interference field into a web of bright lines.
      const intensity = Math.pow(normalized, RIDGE_SHARPNESS);
      const offset = (y * TEXTURE_SIZE_PIXELS + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(Math.min(1, intensity) * 255);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}
