import { SRGBColorSpace, type Texture, type WebGLRenderer } from "three";

/**
 * Texture sharpness defaults every scene texture should get.
 *
 * - colorSpace: three's TextureLoader leaves textures in NoColorSpace, so our
 *   sRGB-encoded JPGs were being sampled as if linear — washed-out, low
 *   contrast. Color maps must be tagged SRGBColorSpace (data maps — normal,
 *   roughness, alpha — must NOT be).
 * - anisotropy: the default of 1 collapses grazing-angle surfaces (Saturn's
 *   ring, planet limbs, the skybox band) into blurry mips; max anisotropy is
 *   essentially free on desktop GPUs.
 *
 * Safe to call repeatedly on useLoader-cached textures (idempotent).
 */
export function applyColorTextureQuality(texture: Texture, gl: WebGLRenderer): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = gl.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  return texture;
}

/** Same anisotropy treatment for NON-color (data) maps: normal, roughness, alpha. */
export function applyDataTextureQuality(texture: Texture, gl: WebGLRenderer): Texture {
  texture.anisotropy = gl.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  return texture;
}
