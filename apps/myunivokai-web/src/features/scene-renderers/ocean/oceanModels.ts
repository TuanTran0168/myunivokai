import {
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  SphereGeometry,
  TorusGeometry,
  Vector2
} from "three";
import { mergeBufferGeometries } from "three-stdlib";

/**
 * The ocean-1 asset catalogue.
 *
 * Every model key ocean-service can emit resolves HERE, to geometry built in
 * the browser, rather than to a downloaded GLB the way the nature-1 catalogue
 * does. That was a deliberate decision, not a shortcut:
 *
 *   - There is no agent-downloadable CC0 anglerfish, giant squid or gulper eel,
 *     and the rare-feature species list is FROZEN the moment the first world
 *     ships (species are picked by floor(roll x len)). Shipping a species the
 *     renderer cannot draw is the one mistake in this family that cannot be
 *     undone cheaply.
 *   - The whole family costs zero bytes of asset download and needs no HDRI,
 *     against the forest's 33 GLB + 3 HDRI.
 *
 * Swapping any key to a self-hosted GLB later is a purely frontend change: it
 * alters no stored config and re-renders every world that already exists.
 *
 * Geometry is built once per key and cached — these are shared across hundreds
 * of instanced draws, so building one per instance would be the single most
 * expensive thing in the scene.
 */

const geometryCache = new Map<string, BufferGeometry>();

function cached(key: string, build: () => BufferGeometry): BufferGeometry {
  const existing = geometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = build();
  geometryCache.set(key, geometry);
  return geometry;
}

function translated(geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  return geometry.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
}

function rotatedZ(geometry: BufferGeometry, radians: number): BufferGeometry {
  return geometry.applyMatrix4(new Matrix4().makeRotationZ(radians));
}

function scaled(geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  return geometry.applyMatrix4(new Matrix4().makeScale(x, y, z));
}

// --- Flora -------------------------------------------------------------------
// Every flora geometry stands on the origin with its foot at y = 0, so the
// scatter can drop it straight onto the seafloor sampler's height.

function buildKelpStrand(): BufferGeometry {
  // A stipe with blades: tall, thin, and top-heavy so the sway shader has
  // something worth bending.
  const parts: BufferGeometry[] = [translated(new CylinderGeometry(0.035, 0.06, 4.2, 5), 0, 2.1, 0)];
  for (let blade = 0; blade < 7; blade += 1) {
    const height = 0.7 + blade * 0.5;
    const side = blade % 2 === 0 ? 1 : -1;
    parts.push(
      translated(
        rotatedZ(scaled(new SphereGeometry(0.24, 6, 4), 1.6, 0.32, 0.5), side * 0.5),
        side * 0.28,
        height,
        0
      )
    );
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

function buildSeagrassTuft(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let blade = 0; blade < 9; blade += 1) {
    const angle = (blade / 9) * Math.PI * 2;
    const lean = 0.18 + (blade % 3) * 0.07;
    const height = 0.9 + (blade % 4) * 0.22;
    const strand = translated(scaled(new CylinderGeometry(0.012, 0.03, height, 3), 1, 1, 2.4), 0, height / 2, 0);
    parts.push(strand.applyMatrix4(new Matrix4().makeRotationY(angle)).applyMatrix4(new Matrix4().makeRotationX(lean)));
  }
  return mergeBufferGeometries(parts, false) ?? new CylinderGeometry(0.02, 0.03, 1, 3);
}

function buildStaghornCoral(): BufferGeometry {
  const parts: BufferGeometry[] = [translated(new CylinderGeometry(0.09, 0.16, 0.5, 6), 0, 0.25, 0)];
  for (let branch = 0; branch < 6; branch += 1) {
    const angle = (branch / 6) * Math.PI * 2;
    const arm = translated(new CylinderGeometry(0.045, 0.085, 0.85, 5), 0, 0.42, 0)
      .applyMatrix4(new Matrix4().makeRotationZ(0.55))
      .applyMatrix4(new Matrix4().makeRotationY(angle));
    parts.push(translated(arm, 0, 0.45, 0));
    const tip = translated(new CylinderGeometry(0.028, 0.05, 0.5, 5), 0, 0.25, 0)
      .applyMatrix4(new Matrix4().makeRotationZ(0.9))
      .applyMatrix4(new Matrix4().makeRotationY(angle + 0.4));
    parts.push(translated(tip, 0, 1.0, 0));
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

function buildBrainCoral(): BufferGeometry {
  // A squashed dome with concentric ridges — the reef's boulder.
  const parts: BufferGeometry[] = [scaled(new SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 1, 0.65, 1)];
  for (let ring = 1; ring <= 3; ring += 1) {
    const radius = 0.5 - ring * 0.12;
    parts.push(
      translated(
        scaled(new TorusGeometry(radius, 0.035, 5, 20), 1, 1, 0.7).applyMatrix4(
          new Matrix4().makeRotationX(Math.PI / 2)
        ),
        0,
        0.1 + ring * 0.07,
        0
      )
    );
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

function buildSoftCoral(): BufferGeometry {
  // Deep-water soft coral: a fan of fine branches, no rigid skeleton.
  const parts: BufferGeometry[] = [translated(new CylinderGeometry(0.05, 0.1, 0.35, 5), 0, 0.17, 0)];
  for (let branch = 0; branch < 11; branch += 1) {
    const spread = (branch / 10 - 0.5) * 1.5;
    const height = 1.0 - Math.abs(branch / 10 - 0.5) * 0.9;
    parts.push(
      translated(
        rotatedZ(translated(new CylinderGeometry(0.014, 0.03, height, 4), 0, height / 2, 0), spread),
        Math.sin(spread) * 0.1,
        0.32,
        0
      )
    );
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

function buildAnemone(): BufferGeometry {
  const parts: BufferGeometry[] = [translated(scaled(new SphereGeometry(0.22, 8, 6), 1, 0.7, 1), 0, 0.14, 0)];
  for (let tentacle = 0; tentacle < 14; tentacle += 1) {
    const angle = (tentacle / 14) * Math.PI * 2;
    const lean = 0.6 + (tentacle % 3) * 0.15;
    const arm = translated(new CapsuleGeometry(0.028, 0.4, 3, 5), 0, 0.24, 0)
      .applyMatrix4(new Matrix4().makeRotationZ(lean))
      .applyMatrix4(new Matrix4().makeRotationY(angle));
    parts.push(translated(arm, 0, 0.22, 0));
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

function buildTubeworm(): BufferGeometry {
  // Vent tubeworms: white chitin tubes with a red plume. The plume is what a
  // vent field reads as from a distance.
  const parts: BufferGeometry[] = [];
  for (let tube = 0; tube < 5; tube += 1) {
    const angle = (tube / 5) * Math.PI * 2;
    const height = 1.1 + (tube % 3) * 0.45;
    const offset = 0.14 + (tube % 2) * 0.09;
    const stalk = translated(new CylinderGeometry(0.05, 0.07, height, 6), 0, height / 2, 0);
    const plume = translated(scaled(new SphereGeometry(0.12, 6, 5), 1, 1.5, 1), 0, height + 0.1, 0);
    parts.push(
      translated(stalk, Math.cos(angle) * offset, 0, Math.sin(angle) * offset),
      translated(plume, Math.cos(angle) * offset, 0, Math.sin(angle) * offset)
    );
  }
  return mergeBufferGeometries(parts, false) ?? new CylinderGeometry(0.05, 0.07, 1.2, 6);
}

function buildGlassSponge(): BufferGeometry {
  // A hollow lattice vase. Lathe rather than a cylinder because the flare is
  // the whole silhouette.
  const profile = [
    new Vector2(0.1, 0),
    new Vector2(0.16, 0.25),
    new Vector2(0.2, 0.6),
    new Vector2(0.3, 1.0),
    new Vector2(0.42, 1.35),
    new Vector2(0.4, 1.4)
  ];
  return new LatheGeometry(profile, 12);
}

function buildSeaPen(): BufferGeometry {
  const parts: BufferGeometry[] = [translated(new CylinderGeometry(0.04, 0.07, 1.5, 5), 0, 0.75, 0)];
  for (let barb = 0; barb < 12; barb += 1) {
    const height = 0.6 + (barb / 12) * 0.85;
    const side = barb % 2 === 0 ? 1 : -1;
    parts.push(
      translated(
        rotatedZ(scaled(new SphereGeometry(0.09, 5, 4), 1.8, 0.5, 0.6), side * 0.9),
        side * 0.13,
        height,
        0
      )
    );
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

const FLORA_BUILDERS: Record<string, () => BufferGeometry> = {
  "flora-kelp-giant": buildKelpStrand,
  "flora-seagrass": buildSeagrassTuft,
  "flora-coral-staghorn": buildStaghornCoral,
  "flora-coral-brain": buildBrainCoral,
  "flora-coral-soft": buildSoftCoral,
  "flora-anemone": buildAnemone,
  "flora-tubeworm": buildTubeworm,
  "flora-glass-sponge": buildGlassSponge,
  "flora-sea-pen": buildSeaPen
};

export function floraGeometryForKey(modelKey: string): BufferGeometry {
  const build = FLORA_BUILDERS[modelKey] ?? buildSeagrassTuft;
  return cached(`flora:${modelKey}`, build);
}

/** How tall each flora key stands at scale 1, so the scatter can size it. */
export const FLORA_TARGET_HEIGHTS: Record<string, number> = {
  "flora-kelp-giant": 4.6,
  "flora-seagrass": 1.2,
  "flora-coral-staghorn": 1.5,
  "flora-coral-brain": 0.6,
  "flora-coral-soft": 1.3,
  "flora-anemone": 0.7,
  "flora-tubeworm": 1.7,
  "flora-glass-sponge": 1.4,
  "flora-sea-pen": 1.5
};

/**
 * Whether a species should sway with the current. Rigid skeletons (brain coral,
 * glass sponge) do not — a boulder bending in the surge is the single tell that
 * would make the whole reef read as cloth.
 */
export const FLORA_SWAYS: Record<string, boolean> = {
  "flora-kelp-giant": true,
  "flora-seagrass": true,
  "flora-coral-staghorn": false,
  "flora-coral-brain": false,
  "flora-coral-soft": true,
  "flora-anemone": true,
  "flora-tubeworm": true,
  "flora-glass-sponge": false,
  "flora-sea-pen": true
};

/** Base colours before the depth tint is applied. */
export const FLORA_BASE_COLORS: Record<string, string> = {
  "flora-kelp-giant": "#4E7C3A",
  "flora-seagrass": "#6BA85A",
  "flora-coral-staghorn": "#E8916B",
  "flora-coral-brain": "#D4A05C",
  "flora-coral-soft": "#D46A8C",
  "flora-anemone": "#E2557E",
  "flora-tubeworm": "#C9433F",
  "flora-glass-sponge": "#D8E6EA",
  "flora-sea-pen": "#B96FA8"
};

// --- Fauna -------------------------------------------------------------------
// Fish geometries point along +X, centred on the origin, so a lookAt on the
// swim direction orients them without a per-species offset.

function buildFishBody(length: number, height: number, width: number, tailSpan: number): BufferGeometry {
  const body = scaled(new SphereGeometry(0.5, 10, 7), length, height, width);
  const tail = translated(
    rotatedZ(scaled(new ConeGeometry(0.5, 1, 4), tailSpan, 0.4, width * 0.5), Math.PI / 2),
    -length * 0.55,
    0,
    0
  );
  return mergeBufferGeometries([body, tail], false) ?? body;
}

const FISH_BUILDERS: Record<string, () => BufferGeometry> = {
  "fish-reef-school": () => buildFishBody(0.42, 0.26, 0.13, 0.3),
  "fish-silverside": () => buildFishBody(0.5, 0.16, 0.09, 0.26),
  "fish-barracuda": () => buildFishBody(1.05, 0.16, 0.13, 0.3),
  "fish-ray": () => {
    // A ray is a wing, not a torpedo: wide and flat with a whip tail.
    const disc = scaled(new SphereGeometry(0.5, 12, 6), 0.75, 0.12, 1.5);
    const tail = translated(scaled(new ConeGeometry(0.06, 1.4, 5), 1, 1, 1).applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2)), -0.85, 0, 0);
    return mergeBufferGeometries([disc, tail], false) ?? disc;
  },
  // Deep-sea fish are small and stubby; the hatchetfish is famously
  // laterally compressed, which is what its silhouette has to say.
  "fish-lanternfish": () => buildFishBody(0.3, 0.16, 0.08, 0.22),
  "fish-hatchetfish": () => buildFishBody(0.22, 0.3, 0.05, 0.16)
};

export function fishGeometryForKey(modelKey: string): BufferGeometry {
  const build = FISH_BUILDERS[modelKey] ?? FISH_BUILDERS["fish-reef-school"];
  return cached(`fish:${modelKey}`, build);
}

export const FISH_BASE_COLORS: Record<string, string> = {
  "fish-reef-school": "#F2B24C",
  "fish-silverside": "#CFE3EE",
  "fish-barracuda": "#8FA3AE",
  "fish-ray": "#6E7C88",
  "fish-lanternfish": "#3C4A63",
  "fish-hatchetfish": "#B9C6D4"
};

/** Which fish carry photophores, and how brightly. Zero for the sunlit ones. */
export const FISH_EMISSIVE_STRENGTH: Record<string, number> = {
  "fish-reef-school": 0,
  "fish-silverside": 0,
  "fish-barracuda": 0,
  "fish-ray": 0,
  "fish-lanternfish": 0.9,
  "fish-hatchetfish": 0.55
};

function buildJellyBell(bellRadius: number, tentacleCount: number, tentacleLength: number): BufferGeometry {
  const bell = scaled(new SphereGeometry(bellRadius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 1, 1.15, 1);
  const parts: BufferGeometry[] = [bell];
  for (let tentacle = 0; tentacle < tentacleCount; tentacle += 1) {
    const angle = (tentacle / tentacleCount) * Math.PI * 2;
    const radius = bellRadius * 0.78;
    parts.push(
      translated(
        new CylinderGeometry(0.008, 0.016, tentacleLength, 3),
        Math.cos(angle) * radius,
        -tentacleLength / 2,
        Math.sin(angle) * radius
      )
    );
  }
  return mergeBufferGeometries(parts, false) ?? bell;
}

const DRIFTER_BUILDERS: Record<string, () => BufferGeometry> = {
  "drifter-moon-jelly": () => buildJellyBell(0.42, 12, 1.1),
  "drifter-comb-jelly": () => buildJellyBell(0.2, 8, 0.5),
  // A siphonophore is a colony: a chain of bells, which is why it is the one
  // drifter that reads as long rather than round.
  "drifter-siphonophore": () => {
    const parts: BufferGeometry[] = [];
    for (let segment = 0; segment < 9; segment += 1) {
      parts.push(translated(scaled(new IcosahedronGeometry(0.13, 0), 1, 0.8, 1), 0, -segment * 0.28, 0));
    }
    parts.push(translated(new CylinderGeometry(0.01, 0.01, 2.6, 3), 0, -1.3, 0));
    return mergeBufferGeometries(parts, false) ?? new SphereGeometry(0.15, 6, 5);
  }
};

export function drifterGeometryForKey(modelKey: string): BufferGeometry {
  const build = DRIFTER_BUILDERS[modelKey] ?? DRIFTER_BUILDERS["drifter-moon-jelly"];
  return cached(`drifter:${modelKey}`, build);
}

function buildWhaleBody(length: number, girth: number, flukeSpan: number, hasDorsal: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [scaled(new SphereGeometry(0.5, 16, 10), length, girth, girth * 0.8)];
  // Pectoral fins — a humpback's are a third of its body length and are the
  // reason its silhouette is unmistakable at fog distance.
  for (const side of [-1, 1]) {
    parts.push(
      translated(
        scaled(new SphereGeometry(0.5, 8, 5), length * 0.28, girth * 0.06, girth * 0.14).applyMatrix4(
          new Matrix4().makeRotationY(side * 0.5)
        ),
        -length * 0.05,
        -girth * 0.1,
        side * girth * 0.42
      )
    );
  }
  parts.push(
    translated(scaled(new SphereGeometry(0.5, 8, 5), length * 0.16, girth * 0.05, flukeSpan), -length * 0.52, 0, 0)
  );
  if (hasDorsal) {
    parts.push(
      translated(
        rotatedZ(scaled(new ConeGeometry(0.5, 1, 4), girth * 0.12, girth * 0.35, girth * 0.05), 0),
        -length * 0.1,
        girth * 0.5,
        0
      )
    );
  }
  return mergeBufferGeometries(parts, false) ?? parts[0];
}

const GIANT_BUILDERS: Record<string, () => BufferGeometry> = {
  "giant-humpback": () => buildWhaleBody(11, 2.6, 3.4, true),
  "giant-blue-whale": () => buildWhaleBody(16, 2.8, 4.2, true),
  "giant-sperm-whale": () => buildWhaleBody(12, 3.0, 3.0, false),
  "giant-whale-shark": () => buildWhaleBody(9, 2.2, 2.8, true),
  "giant-manta": () => {
    const disc = scaled(new SphereGeometry(0.5, 16, 8), 5.2, 0.6, 9.0);
    const tail = translated(
      scaled(new ConeGeometry(0.12, 5, 5), 1, 1, 1).applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2)),
      -4.4,
      0,
      0
    );
    for (const side of [-1, 1]) {
      // Cephalic lobes — the two horns that make a manta a manta.
      disc.applyMatrix4(new Matrix4().makeTranslation(0, 0, 0));
      void side;
    }
    return mergeBufferGeometries([disc, tail], false) ?? disc;
  }
};

export function giantGeometryForKey(modelKey: string): BufferGeometry {
  const build = GIANT_BUILDERS[modelKey] ?? GIANT_BUILDERS["giant-humpback"];
  return cached(`giant:${modelKey}`, build);
}

export const GIANT_BASE_COLORS: Record<string, string> = {
  "giant-humpback": "#38434F",
  "giant-blue-whale": "#4A5D74",
  "giant-sperm-whale": "#4A453F",
  "giant-whale-shark": "#425160",
  "giant-manta": "#2E3A46"
};

// --- The abyssal visitors ----------------------------------------------------
// The three species of the ocean-abyss-visitor lottery. Their order in
// contracts_rarity.go is frozen forever; these are what that order resolves to.

const ABYSS_VISITOR_BUILDERS: Record<string, () => BufferGeometry> = {
  anglerfish: () => {
    const body = scaled(new SphereGeometry(0.5, 12, 8), 1.5, 1.1, 0.9);
    const jaw = translated(
      rotatedZ(scaled(new ConeGeometry(0.5, 1, 6), 0.55, 0.7, 0.5), -Math.PI / 2),
      0.75,
      -0.1,
      0
    );
    // The illicium: a stalk over the head carrying the lure. Drawn as geometry
    // rather than as a sprite so it casts and receives like the rest of it.
    const stalk = translated(rotatedZ(new CylinderGeometry(0.025, 0.035, 1.1, 4), -0.5), 0.5, 0.75, 0);
    return mergeBufferGeometries([body, jaw, stalk], false) ?? body;
  },
  "giant-squid": () => {
    const mantle = translated(scaled(new ConeGeometry(0.5, 1, 10), 1.1, 3.2, 1.1), 0, 0.6, 0);
    const parts: BufferGeometry[] = [mantle, translated(scaled(new SphereGeometry(0.42, 10, 7), 1, 0.8, 1), 0, -1.0, 0)];
    for (let arm = 0; arm < 8; arm += 1) {
      const angle = (arm / 8) * Math.PI * 2;
      const length = arm < 2 ? 4.2 : 2.4;
      parts.push(
        translated(
          new CylinderGeometry(0.035, 0.08, length, 4),
          Math.cos(angle) * 0.24,
          -1.2 - length / 2,
          Math.sin(angle) * 0.24
        )
      );
    }
    return mergeBufferGeometries(parts, false) ?? mantle;
  },
  "gulper-eel": () => {
    const jaw = translated(rotatedZ(scaled(new ConeGeometry(0.5, 1, 8), 1.5, 1.6, 1.2), -Math.PI / 2), 0.8, 0, 0);
    const parts: BufferGeometry[] = [jaw];
    for (let segment = 0; segment < 10; segment += 1) {
      const taper = 0.3 * (1 - segment / 11);
      parts.push(translated(new SphereGeometry(Math.max(0.03, taper), 6, 5), -segment * 0.45, 0, 0));
    }
    return mergeBufferGeometries(parts, false) ?? jaw;
  }
};

export function abyssVisitorGeometryForKey(speciesKey: string): BufferGeometry {
  const build = ABYSS_VISITOR_BUILDERS[speciesKey] ?? ABYSS_VISITOR_BUILDERS.anglerfish;
  return cached(`abyss-visitor:${speciesKey}`, build);
}

export const ABYSS_VISITOR_BASE_COLORS: Record<string, string> = {
  anglerfish: "#1B2230",
  "giant-squid": "#7A3A46",
  "gulper-eel": "#20242E"
};

// --- Landmarks ---------------------------------------------------------------

const LANDMARK_BUILDERS: Record<string, () => BufferGeometry> = {
  kelpCathedral: () => {
    // The hero: a ring of kelp columns tall enough to arch overhead. This is
    // the ocean's heart tree, and like it, it survives every zone — in the
    // abyss the renderer simply tints it dead-pale.
    const parts: BufferGeometry[] = [];
    for (let column = 0; column < 7; column += 1) {
      const angle = (column / 7) * Math.PI * 2;
      const height = 5.5 + (column % 3) * 1.1;
      parts.push(
        translated(
          new CylinderGeometry(0.1, 0.18, height, 6),
          Math.cos(angle) * 1.5,
          height / 2,
          Math.sin(angle) * 1.5
        )
      );
    }
    parts.push(translated(scaled(new TorusGeometry(1.5, 0.14, 6, 20), 1, 1, 1).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2)), 0, 5.6, 0));
    return mergeBufferGeometries(parts, false) ?? new CylinderGeometry(0.15, 0.2, 5, 6);
  },
  sunkenRelic: () => {
    // A toppled column and its plinth: unmistakably made, unmistakably old.
    const plinth = translated(new CylinderGeometry(0.95, 1.1, 0.5, 8), 0, 0.25, 0);
    const column = translated(rotatedZ(new CylinderGeometry(0.34, 0.38, 3.6, 8), 1.15), 1.4, 0.85, 0);
    const capital = translated(rotatedZ(new CylinderGeometry(0.5, 0.5, 0.35, 8), 1.15), 2.85, 1.5, 0);
    return mergeBufferGeometries([plinth, column, capital], false) ?? plinth;
  },
  hydrothermalVent: () => {
    // A black smoker: a chimney whose plume is drawn separately as particles.
    const parts: BufferGeometry[] = [translated(new CylinderGeometry(0.28, 0.85, 3.2, 7), 0, 1.6, 0)];
    for (let spur = 0; spur < 3; spur += 1) {
      const angle = (spur / 3) * Math.PI * 2;
      parts.push(
        translated(
          new CylinderGeometry(0.14, 0.3, 1.4, 6),
          Math.cos(angle) * 0.55,
          0.7,
          Math.sin(angle) * 0.55
        )
      );
    }
    return mergeBufferGeometries(parts, false) ?? parts[0];
  },
  coralGarden: () => {
    const parts: BufferGeometry[] = [];
    for (let head = 0; head < 5; head += 1) {
      const angle = (head / 5) * Math.PI * 2;
      const radius = 0.7 + (head % 2) * 0.5;
      parts.push(
        translated(
          scaled(new DodecahedronGeometry(0.5 + (head % 3) * 0.15, 0), 1, 0.8, 1),
          Math.cos(angle) * radius,
          0.45,
          Math.sin(angle) * radius
        )
      );
    }
    return mergeBufferGeometries(parts, false) ?? new DodecahedronGeometry(0.6, 0);
  },
  abyssalTrench: () => {
    // A cleft in the floor, read as two facing walls. It is the one landmark
    // that goes DOWN, which is what makes it legible as a trench.
    const left = translated(scaled(new IcosahedronGeometry(1.6, 1), 1.1, 0.9, 0.5), 0, 0.4, -1.35);
    const right = translated(scaled(new IcosahedronGeometry(1.6, 1), 1.1, 0.9, 0.5), 0, 0.4, 1.35);
    return mergeBufferGeometries([left, right], false) ?? left;
  },
  whaleFall: () => {
    // A whale's skeleton on the floor: a spine with ribs. An entire ecosystem
    // runs on one of these for decades, which is why it is a landmark and not
    // a prop.
    const parts: BufferGeometry[] = [
      translated(rotatedZ(new CylinderGeometry(0.13, 0.13, 5.4, 6), Math.PI / 2), 0, 0.4, 0),
      translated(scaled(new SphereGeometry(0.45, 8, 6), 1.5, 0.8, 0.8), 2.6, 0.45, 0)
    ];
    for (let rib = 0; rib < 9; rib += 1) {
      const x = -2.1 + rib * 0.52;
      for (const side of [-1, 1]) {
        parts.push(
          translated(
            new TorusGeometry(0.62, 0.05, 4, 12, Math.PI * 0.6).applyMatrix4(
              new Matrix4().makeRotationY(Math.PI / 2)
            ),
            x,
            0.42,
            side * 0.05
          )
        );
      }
    }
    return mergeBufferGeometries(parts, false) ?? parts[0];
  }
};

export function landmarkGeometryForKind(kind: string): BufferGeometry {
  const build = LANDMARK_BUILDERS[kind] ?? LANDMARK_BUILDERS.kelpCathedral;
  return cached(`landmark:${kind}`, build);
}

export const LANDMARK_BASE_COLORS: Record<string, string> = {
  kelpCathedral: "#3F6B37",
  sunkenRelic: "#9AA79B",
  hydrothermalVent: "#2B2622",
  coralGarden: "#D97F5C",
  abyssalTrench: "#2C3440",
  whaleFall: "#D9D3C4"
};

/** Rock geometry for the seafloor scatter, one shape reused at many scales. */
export function seafloorRockGeometry(): BufferGeometry {
  return cached("rock:basalt", () => scaled(new DodecahedronGeometry(0.6, 0), 1, 0.72, 1.15));
}
