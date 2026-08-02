import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Renders the Myunivokai mark to transparent PNGs.
 *
 * The SVGs beside the outputs are the masters and are what the browser actually
 * loads; these rasters exist for the surfaces that cannot take vector art. Rather
 * than pull in a rasteriser — this repo has neither sharp nor ImageMagick, and a
 * brand mark is not worth a native dependency in a production install — the mark
 * is drawn analytically here and written through the PNG encoder below, which
 * needs nothing but node:zlib.
 *
 * Run: node scripts/build-brand-mark.mjs
 */

// --- PNG container -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let remainder = 0xffffffff;
  for (const byte of bytes) {
    remainder = CRC_TABLE[(remainder ^ byte) & 0xff] ^ (remainder >>> 8);
  }
  return (remainder ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typed.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typed), 8 + data.length);
  return chunk;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Compression, filter and interlace methods all have exactly one valid value.

  const stride = size * 4;
  // Every scanline carries filter type 0. Filtering would compress better, but a
  // few hundred bytes on a logo is not worth the arithmetic.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// --- The mark ----------------------------------------------------------------
// Authored against a 512 grid and scaled, so these read as the SVG's numbers.

const DESIGN_SIZE = 512;
const CENTRE = 256;
const ORBIT_TILT_DEGREES = -28;
/** Where the satellite sits on the un-tilted ellipse, so it cannot drift off it. */
const SATELLITE_ANGLE_DEGREES = 150;

/**
 * Two cuts of one mark, matching public/logo.svg and src/app/icon.svg.
 *
 * The tab icon is not the logo shrunk. At 16px the full mark's bead is under a
 * pixel across and its ring is a hairline, so that cut drops the bead, fattens
 * the ring and grows the core until the silhouette still reads.
 */
const MARK_VARIANTS = {
  logo: { orbitRadiusX: 216, orbitRadiusY: 104, orbitStroke: 36, coreRadius: 128, satelliteRadius: 30 },
  icon: { orbitRadiusX: 212, orbitRadiusY: 92, orbitStroke: 50, coreRadius: 140, satelliteRadius: 0 }
};

/** Brass, from globals.css: --paper, --brass lightened, --brass, --brass-deep. */
const HIGHLIGHT = [242, 238, 230];
const BRASS_LIGHT = [228, 207, 156];
const BRASS = [201, 163, 91];
const BRASS_DEEP = [168, 132, 63];

const SAMPLES_PER_AXIS = 4;

function mixColor(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount
  ];
}

function rampColor(stops, position) {
  const clamped = Math.min(1, Math.max(0, position));
  const span = 1 / (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(clamped / span));
  return mixColor(stops[index], stops[index + 1], (clamped - index * span) / span);
}

/**
 * Signed distance to the ellipse, to first order: the implicit function divided
 * by its own gradient. Exact enough for a stroke this narrow against a curve this
 * gentle, and the supersampling below is what actually smooths the edge.
 */
function orbitAt(variant, x, y) {
  const tilt = (-ORBIT_TILT_DEGREES * Math.PI) / 180;
  const offsetX = x - CENTRE;
  const offsetY = y - CENTRE;
  const localX = offsetX * Math.cos(tilt) - offsetY * Math.sin(tilt);
  const localY = offsetX * Math.sin(tilt) + offsetY * Math.cos(tilt);
  const radiusXSquared = variant.orbitRadiusX * variant.orbitRadiusX;
  const radiusYSquared = variant.orbitRadiusY * variant.orbitRadiusY;
  const implicit = (localX * localX) / radiusXSquared + (localY * localY) / radiusYSquared - 1;
  const gradient = Math.hypot((2 * localX) / radiusXSquared, (2 * localY) / radiusYSquared);
  return {
    distance: gradient > 0 ? implicit / gradient : Infinity,
    // Local +Y tilts toward the lower edge of the frame, which is the arc nearest
    // the viewer. Drawing that half OVER the core is the whole difference between
    // a ring around a sphere and a disc behind a circle.
    isNearSide: localY > 0
  };
}

function rotatedSatellite(variant) {
  const orbitAngle = (SATELLITE_ANGLE_DEGREES * Math.PI) / 180;
  const tilt = (ORBIT_TILT_DEGREES * Math.PI) / 180;
  const offsetX = variant.orbitRadiusX * Math.cos(orbitAngle);
  const offsetY = variant.orbitRadiusY * Math.sin(orbitAngle);
  return {
    x: CENTRE + offsetX * Math.cos(tilt) - offsetY * Math.sin(tilt),
    y: CENTRE + offsetX * Math.sin(tilt) + offsetY * Math.cos(tilt)
  };
}

function orbitColor(x, y) {
  const along = (x + y) / (DESIGN_SIZE * 2);
  return rampColor([BRASS_LIGHT, BRASS, BRASS_DEEP], along);
}

/** Topmost element covering this design-space point, or null. */
function colorAt(variant, satellite, x, y) {
  if (variant.satelliteRadius > 0 && Math.hypot(x - satellite.x, y - satellite.y) <= variant.satelliteRadius) {
    return BRASS_LIGHT;
  }
  const orbit = orbitAt(variant, x, y);
  const onOrbit = Math.abs(orbit.distance) <= variant.orbitStroke / 2;
  if (onOrbit && orbit.isNearSide) {
    return orbitColor(x, y);
  }
  if (Math.hypot(x - CENTRE, y - CENTRE) <= variant.coreRadius) {
    // Lit from the upper left, like every other raised surface in the interface.
    const lighting = (x - CENTRE + (y - CENTRE)) / (variant.coreRadius * 2) + 0.5;
    return rampColor([HIGHLIGHT, BRASS_LIGHT, BRASS], lighting);
  }
  return onOrbit ? orbitColor(x, y) : null;
}

function renderMark(variant, size) {
  const satellite = rotatedSatellite(variant);
  const rgba = new Uint8Array(size * size * 4);
  const scale = DESIGN_SIZE / size;
  const step = 1 / SAMPLES_PER_AXIS;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sampleY = 0; sampleY < SAMPLES_PER_AXIS; sampleY += 1) {
        for (let sampleX = 0; sampleX < SAMPLES_PER_AXIS; sampleX += 1) {
          const color = colorAt(
            variant,
            satellite,
            (pixelX + (sampleX + 0.5) * step) * scale,
            (pixelY + (sampleY + 0.5) * step) * scale
          );
          if (color) {
            red += color[0];
            green += color[1];
            blue += color[2];
            covered += 1;
          }
        }
      }
      const offset = (pixelY * size + pixelX) * 4;
      if (covered > 0) {
        // Straight alpha, not premultiplied: the colour is the average of the
        // samples that hit something, and coverage becomes the alpha on its own.
        rgba[offset] = Math.round(red / covered);
        rgba[offset + 1] = Math.round(green / covered);
        rgba[offset + 2] = Math.round(blue / covered);
        rgba[offset + 3] = Math.round((covered / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS)) * 255);
      }
    }
  }

  return encodePng(size, rgba);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = [
  [join(projectRoot, "public", "logo.png"), MARK_VARIANTS.logo, 512],
  // Fallback for the browsers that still will not take an SVG in rel="icon".
  [join(projectRoot, "src", "app", "icon1.png"), MARK_VARIANTS.icon, 64]
];

for (const [path, variant, size] of outputs) {
  writeFileSync(path, renderMark(variant, size));
  console.log(`${path} ${size}x${size}`);
}
