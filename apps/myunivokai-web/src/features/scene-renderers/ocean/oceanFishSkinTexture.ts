/**
 * Baked skin textures for the fauna species that have no CC0 GLB: silversides,
 * anthias and the lanternfish (see oceanRigFauna.ts's OCEAN_RIG_SPECIES —
 * every other species adopts a real model and this texture is never applied
 * to it). A flat MeshStandardMaterial colour reads as a toy; this is the same
 * "bake a CanvasTexture from seeded noise" technique createSandTextures
 * already uses for the seabed, one step smaller in scope.
 *
 * The body of revolution in oceanRigBodies.ts parameterises itself as
 * u = angle / 2π (wraps once around the body), v = head-to-tail (does not
 * wrap). u = 0.75 is the belly — sin(angle) is most negative there, the same
 * point the swim shader's vBelly countershading already brightens. Any noise
 * baked across this UV has to wrap in u the same way createSandTextures'
 * seabed noise wraps: a plain non-wrapping field draws a visible seam down
 * the fish's back where u = 0 meets u = 1.
 */
import { CanvasTexture, NoColorSpace, RepeatWrapping } from "three";

export type FishSkinBake = {
  /** Grey scale-mottle multiplier on material.color. Applied to every species this module covers. */
  map: CanvasTexture;
  /**
   * Photophore dots, black everywhere else. Only species with
   * `photophores: true` get one — everything else is null, and the caller
   * leaves the school's existing uniform emissive alone.
   */
  emissiveMap: CanvasTexture | null;
  dispose: () => void;
};

const MAP_WIDTH = 128;
const MAP_HEIGHT = 64;

/** Hashed on a lattice that wraps at `periodU` so u = 0 and u = 1 agree exactly. */
function wrappedHash(ix: number, iy: number, periodU: number): number {
  const wx = ((ix % periodU) + periodU) % periodU;
  let h = Math.imul(wx, 374761393) + Math.imul(iy, 668265263) + Math.imul(periodU, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noiseAt(x: number, y: number, periodU: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = wrappedHash(ix, iy, periodU);
  const b = wrappedHash(ix + 1, iy, periodU);
  const c = wrappedHash(ix, iy + 1, periodU);
  const d = wrappedHash(ix + 1, iy + 1, periodU);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

/** Two octaves at periods that both divide MAP_WIDTH, so both wrap cleanly. */
function scaleMottle(u: number, v: number): number {
  const cellsA = 8;
  const cellsB = 16;
  return noiseAt(u * cellsA, v * cellsA * 2, cellsA) * 0.65 + noiseAt(u * cellsB, v * cellsB * 2, cellsB) * 0.35;
}

/**
 * A deterministic pseudo-random float in [0, 1) from a string, used only to
 * jitter photophore spacing so a row does not read as a printed ruler. Not the
 * shared randomFromSeed generator: that produces a 1D sequence, and every call
 * here needs the SAME jitter for the same (row, slot) every time this bakes,
 * not the next value off a stream.
 */
function jitterFor(seed: string, row: number, slot: number): number {
  let hash = 2166136261 ^ row * 131 ^ slot * 17;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

export type FishSkinOptions = {
  seed: string;
  /**
   * Photophore rows either side of the belly seam (u = 0.75), the real
   * anatomy of a myctophid: paired ventral photophore rows running most of
   * the body's length. Nothing else in this rig's species table asks for
   * this, so it stays an opt-in rather than a field every species carries.
   */
  photophores?: boolean;
};

export function createFishSkinBake(options: FishSkinOptions): FishSkinBake {
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = MAP_WIDTH;
  albedoCanvas.height = MAP_HEIGHT;
  const albedoContext = albedoCanvas.getContext("2d");
  if (!albedoContext) {
    throw new Error("ocean rig: 2D canvas unavailable for the fish skin texture");
  }
  // Grey, not the species' own colour: this map is a MULTIPLIER on
  // material.color, not a replacement for it. Baking the colour in here would
  // mean either doubling it (material.color stays the species colour) or
  // erasing it everywhere else that colour is read — the near-field emissive
  // copy in oceanRig.ts (`emissive.copy(material.color)`) is exactly such a
  // reader, and anthias is both near-field and one of the three species this
  // bake applies to.
  const albedoImage = albedoContext.createImageData(MAP_WIDTH, MAP_HEIGHT);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const v = y / MAP_HEIGHT;
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const u = x / MAP_WIDTH;
      // Mottling only, never a net brightness shift: the swim shader's own
      // vBelly countershading already carries the dorsal/ventral gradient, and
      // stacking a second one here would double it.
      const shade = Math.min(255, Math.round((0.86 + scaleMottle(u, v) * 0.28) * 255));
      const offset = (y * MAP_WIDTH + x) * 4;
      albedoImage.data[offset] = shade;
      albedoImage.data[offset + 1] = shade;
      albedoImage.data[offset + 2] = shade;
      albedoImage.data[offset + 3] = 255;
    }
  }
  albedoContext.putImageData(albedoImage, 0, 0);
  const map = new CanvasTexture(albedoCanvas);
  // NoColorSpace, not SRGBColorSpace: these bytes are a linear multiplier
  // (0.86-1.14), authored as one channel replicated three ways, not sRGB
  // colour data. Tagging it sRGB would run it through gamma decode before the
  // multiply and skew every value toward the low end of the range — the same
  // shape of mistake round 3 of this family's work made with additive
  // shaders, just on a baked texture instead of a live one.
  map.colorSpace = NoColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;

  let emissiveMap: CanvasTexture | null = null;
  if (options.photophores) {
    const emissiveCanvas = document.createElement("canvas");
    emissiveCanvas.width = MAP_WIDTH;
    emissiveCanvas.height = MAP_HEIGHT;
    const emissiveContext = emissiveCanvas.getContext("2d");
    if (!emissiveContext) {
      throw new Error("ocean rig: 2D canvas unavailable for the photophore texture");
    }
    emissiveContext.fillStyle = "#000000";
    emissiveContext.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    emissiveContext.fillStyle = "#FFFFFF";
    // Paired rows straddling the belly seam (u = 0.75), the two most obvious
    // ventral photophore lines a myctophid actually carries. Spaced along v
    // from just behind the head to just short of the tail, jittered per slot
    // so twelve dots do not read as a printed scale.
    const rowsU = [0.68, 0.82];
    const dotsPerRow = 11;
    for (let row = 0; row < rowsU.length; row += 1) {
      for (let slot = 0; slot < dotsPerRow; slot += 1) {
        const baseV = 0.12 + (slot / (dotsPerRow - 1)) * 0.72;
        const jitterV = (jitterFor(options.seed, row, slot) - 0.5) * 0.03;
        const centerX = rowsU[row] * MAP_WIDTH;
        const centerY = (baseV + jitterV) * MAP_HEIGHT;
        const radius = MAP_HEIGHT * 0.028;
        const gradient = emissiveContext.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, "#FFFFFF");
        gradient.addColorStop(0.55, "#FFFFFF");
        gradient.addColorStop(1, "#00000000");
        emissiveContext.fillStyle = gradient;
        emissiveContext.beginPath();
        emissiveContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
        emissiveContext.fill();
        // u wraps: a dot near u = 0/1 would otherwise clip at the canvas edge.
        // Neither row sits there (0.68/0.82 are both mid-canvas), so this is
        // future-proofing rather than a bug fix for the rows actually used.
        if (centerX < radius) {
          emissiveContext.beginPath();
          emissiveContext.arc(centerX + MAP_WIDTH, centerY, radius, 0, Math.PI * 2);
          emissiveContext.fill();
        } else if (centerX > MAP_WIDTH - radius) {
          emissiveContext.beginPath();
          emissiveContext.arc(centerX - MAP_WIDTH, centerY, radius, 0, Math.PI * 2);
          emissiveContext.fill();
        }
      }
    }
    emissiveMap = new CanvasTexture(emissiveCanvas);
    // Emissive intensity is linear light multiplied straight in; encoding it
    // sRGB here would be the identical mistake round 3 of this family's work
    // made with additive shader layers, just baked instead of live.
    emissiveMap.colorSpace = NoColorSpace;
    emissiveMap.wrapS = RepeatWrapping;
    emissiveMap.wrapT = RepeatWrapping;
  }

  return {
    map,
    emissiveMap,
    dispose: () => {
      map.dispose();
      emissiveMap?.dispose();
    },
  };
}
