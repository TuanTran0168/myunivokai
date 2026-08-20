/**
 * Procedural creature bodies.
 *
 * # Why these exist when the repository owns twelve GLBs
 *
 * The rig used to be GLB-only: every school was created with a one-vertex
 * placeholder and `visible = false`, and became visible when its `.glb`
 * resolved. Two consequences, both of them visible in every frame:
 *
 *   - **A species with no GLB can never appear.** Four of the prototype's
 *     fourteen have no model file, because the prototype builds them from
 *     maths — and those four are the MASS schools: silversides (1400), anthias
 *     (340), lanternfish (300), anglerfish (4). Add the jellyfish layer (110)
 *     and 2154 of 2550 animals were simply absent. That is the whole reason the
 *     app's water column read as empty next to the prototype's.
 *   - **A failed or slow fetch is an empty ocean.** Nothing degrades; the
 *     animals are either all there or not there at all.
 *
 * The prototype's own arrangement is the opposite, and it is the right one:
 * build a procedural body ALWAYS, then adopt a real GLB over it when one
 * arrives. Procedural is the floor, the model is the upgrade, and the frame is
 * never empty while waiting. Its loader even reports
 * `__oceanModelsLoaded = "unavailable"` and carries on looking correct when the
 * catalogue is missing entirely.
 *
 * # The design rule these shapes follow
 *
 * Silhouette first — the Abzu lesson. Pick the two or three features that
 * identify a species and drop everything else: a dolphin is a melon head and
 * HORIZONTAL flukes, a shark is a pointed snout and a heterocercal tail whose
 * upper lobe is longer, a lanternfish is a blunt head and rows of photophores.
 * Get those right at 20 m and nobody looks for scales.
 *
 * Every body is built about +Z with the head at +Z, and carries an `along`
 * attribute running 0 at the snout to 1 at the tail — which is what lets the
 * swim shader taper a travelling wave along the body. That is the same contract
 * `normaliseModel` gives an adopted GLB, so the two are interchangeable.
 */
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

/**
 * A fusiform half-width profile: zero at the snout, shoulder forward of centre,
 * pinched to a peduncle at the tail.
 *
 * `shoulder` and `taper` are the two exponents; the normalising constant pins
 * the peak to 1 so `halfWidth` means what it says rather than being a number
 * that has to be re-tuned every time an exponent moves.
 */
export function fusiform(
  shoulder: number,
  taper: number,
  halfWidth: number,
): (t: number) => number {
  const peak = shoulder / (shoulder + taper);
  const norm = 1 / (Math.pow(peak, shoulder) * Math.pow(1 - peak, taper));
  return (t) =>
    Math.pow(Math.max(0, t), shoulder) * Math.pow(Math.max(0, 1 - t), taper) * norm * halfWidth;
}

type Fin = {
  plane: "vertical" | "horizontal";
  root: number;
  tip: number;
  /** Vertical fins only: the far corner, which is what makes a tail forked. */
  tip2?: number;
  z0: number;
  z1: number;
  z2?: number;
  z3?: number;
  /** Where along the body this fin sits, so the wave reaches it in phase. */
  along: number;
};

type BodyOptions = {
  profile: (t: number) => number;
  widthRatio: number;
  heightRatio: number;
  lengthSegments?: number;
  radialSegments?: number;
  fins?: Fin[];
};

/** A body of revolution about +Z, head at +Z, with fins as double-sided quads. */
function bodyGeometry(options: BodyOptions): BufferGeometry {
  const lengthSegments = options.lengthSegments ?? 15;
  const radialSegments = options.radialSegments ?? 10;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const normal = new Vector3();

  for (let s = 0; s <= lengthSegments; s += 1) {
    const t = s / lengthSegments;
    const z = 0.5 - t;
    const radius = Math.max(0.01, options.profile(t));
    for (let r = 0; r <= radialSegments; r += 1) {
      const angle = (r / radialSegments) * Math.PI * 2;
      const x = Math.cos(angle) * radius * options.widthRatio;
      const y = Math.sin(angle) * radius * options.heightRatio;
      positions.push(x, y, z);
      // The 0.18 in z biases the normal forward so a body of revolution does not
      // shade as a cylinder cut off at both ends.
      normal.set(x, y, 0.18).normalize();
      normals.push(normal.x, normal.y, normal.z);
      along.push(t);
      // u wraps exactly once around the revolve (angle / 2pi), v runs head to
      // tail — the same cylindrical parameterisation createSandTextures already
      // bakes noise on, chosen for the same reason: a wrap-safe u is what makes
      // a tileable skin texture possible at all. sin(angle) = -1 is the belly
      // (y most negative — see the vBelly countershading this shares the sign
      // convention with), which is u = 0.75 here.
      uvs.push(r / radialSegments, t);
    }
  }
  for (let s = 0; s < lengthSegments; s += 1) {
    for (let r = 0; r < radialSegments; r += 1) {
      const a = s * (radialSegments + 1) + r;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // Fins are flat quads wound BOTH ways: a fin is a membrane, and a fish seen
  // from its other side with back-face culling on loses its tail.
  //
  // u = 0.5 for every fin vertex — a fixed strip down the middle of the skin
  // texture's u range, deliberately away from the belly seam at u = 0.75. A
  // fin is not skin and does not need real texture space; it only needs to
  // sample somewhere that is not one of the lanternfish's photophore rows.
  const quad = (
    corners: readonly [number, number, number][],
    alongValue: number,
    faceNormal: readonly [number, number, number],
  ) => {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(faceNormal[0], faceNormal[1], faceNormal[2]);
      along.push(alongValue);
      uvs.push(0.5, alongValue);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  for (const fin of options.fins ?? []) {
    if (fin.plane === "vertical") {
      quad(
        [
          [0, fin.root, fin.z0],
          [0, fin.tip, fin.z1],
          [0, fin.tip2 ?? fin.tip, fin.z2 ?? fin.z1],
          [0, fin.root, fin.z3 ?? fin.z0],
        ],
        fin.along,
        [1, 0, 0],
      );
    } else {
      // Horizontal: cetacean flukes and pectorals. A vertical tail is the one
      // mistake that turns a dolphin back into a fish.
      quad(
        [
          [fin.root, 0, fin.z0],
          [fin.tip, 0, fin.z1],
          [-fin.tip, 0, fin.z1],
          [-fin.root, 0, fin.z0],
        ],
        fin.along,
        [0, 1, 0],
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** A batoid disc: span across X, chord along Z, thin in Y. */
function wingGeometry(halfSpan: number, chord: number): BufferGeometry {
  const spanSegments = 24;
  const chordSegments = 14;
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= spanSegments; i += 1) {
    const u = (i / spanSegments) * 2 - 1;
    const absU = Math.abs(u);
    // Swept leading edge and a tapering trailing edge: the manta outline.
    const chordScale = Math.pow(1 - Math.pow(absU, 2.1), 0.62);
    const sweep = -Math.pow(absU, 1.7) * 0.3;
    for (let j = 0; j <= chordSegments; j += 1) {
      const v = j / chordSegments;
      const z = 0.5 - v;
      const thickness = (1 - Math.pow(absU, 0.8)) * Math.sin(Math.PI * v) * 0.075;
      positions.push(u * halfSpan, thickness, (z * chordScale + sweep) * chord);
      normals.push(0, 1, 0);
      along.push(v);
    }
  }
  for (let i = 0; i < spanSegments; i += 1) {
    for (let j = 0; j < chordSegments; j += 1) {
      const a = i * (chordSegments + 1) + j;
      const b = a + chordSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  // The whip tail is most of what says "ray" at silhouette scale.
  const base = positions.length / 3;
  const tailLength = chord * 1.5;
  const tailSegments = 6;
  for (let k = 0; k <= tailSegments; k += 1) {
    const t = k / tailSegments;
    const width = (1 - t) * chord * 0.05 + 0.004;
    const z = -chord * 0.5 - t * tailLength;
    positions.push(-width, 0, z, width, 0, z);
    normals.push(0, 1, 0, 0, 1, 0);
    along.push(1, 1);
  }
  for (let k = 0; k < tailSegments; k += 1) {
    const a = base + k * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    indices.push(a + 2, a + 1, a, a + 2, a + 3, a + 1);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("along", new Float32BufferAttribute(along, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The seven silhouettes fourteen species are drawn from.
 *
 * Sharing is deliberate rather than a saving: a lionfish, a butterflyfish, a
 * turbot and a blobfish are all "a fish" at silhouette scale, and what
 * distinguishes them in frame is size, colour, depth band and how they MOVE —
 * which is the `SwimStyle`, not the mesh. Nine of the fourteen also have a real
 * GLB that replaces the shared shape as soon as it loads.
 */
export type BodyArchetype =
  | "reefFish"
  | "shark"
  | "dolphin"
  | "whale"
  | "manta"
  | "anglerfish"
  | "lanternfish"
  | "viperfish"
  | "dragonfish"
  | "fangtooth"
  | "gulperEel"
  | "hatchetfish"
  | "ribbon"
  | "isopod";

const BUILDERS: Record<BodyArchetype, () => BufferGeometry> = {
  // Jacks and herring: the schooling default. The posterior 30-50% undulates.
  reefFish: () =>
    bodyGeometry({
      profile: fusiform(0.62, 1.25, 0.3),
      widthRatio: 0.34,
      heightRatio: 1.25,
      fins: [
        { plane: "vertical", root: 0, tip: 0.42, tip2: -0.42, z0: -0.5, z1: -0.72, z2: -0.72, z3: -0.5, along: 1 },
        { plane: "vertical", root: 0.06, tip: 0.34, tip2: 0.05, z0: 0.1, z1: -0.16, z2: -0.26, z3: -0.26, along: 0.5 },
      ],
    }),
  // Thunniform: rigid forebody, all the work at the peduncle. Pointed snout,
  // tall first dorsal, and a heterocercal tail whose upper lobe is longer —
  // that asymmetry is the shark tell.
  shark: () =>
    bodyGeometry({
      lengthSegments: 19,
      profile: fusiform(0.5, 1.55, 0.17),
      widthRatio: 0.66,
      heightRatio: 1,
      fins: [
        { plane: "vertical", root: 0, tip: 0.52, tip2: -0.26, z0: -0.46, z1: -0.78, z2: -0.66, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.4, tip2: 0.06, z0: 0.12, z1: -0.06, z2: -0.22, z3: -0.22, along: 0.45 },
        { plane: "horizontal", root: 0.09, tip: 0.44, z0: 0.16, z1: -0.02, along: 0.4 },
      ],
    }),
  // A cetacean. Blunt melon, curved dorsal, and flukes that are HORIZONTAL.
  dolphin: () =>
    bodyGeometry({
      lengthSegments: 19,
      profile: (t) => fusiform(0.44, 1.5, 0.165)(t) * (1 - 0.18 * t) + 0.008,
      widthRatio: 0.78,
      heightRatio: 0.92,
      fins: [
        { plane: "horizontal", root: 0.03, tip: 0.4, z0: -0.44, z1: -0.62, along: 1 },
        { plane: "vertical", root: 0.06, tip: 0.3, tip2: 0.05, z0: 0.06, z1: -0.1, z2: -0.24, z3: -0.24, along: 0.5 },
        { plane: "horizontal", root: 0.1, tip: 0.34, z0: 0.18, z1: 0.02, along: 0.4 },
      ],
    }),
  // A rorqual. Everything about it is scale: the beat is slow because beat
  // frequency falls with size, and the pectoral flippers are enormous — which is
  // the humpback silhouette in one feature.
  whale: () =>
    bodyGeometry({
      lengthSegments: 22,
      profile: (t) => fusiform(0.5, 1.25, 0.15)(t) * (1 - 0.1 * t) + 0.006,
      widthRatio: 0.82,
      heightRatio: 1,
      fins: [
        { plane: "horizontal", root: 0.02, tip: 0.3, z0: -0.46, z1: -0.6, along: 1 },
        { plane: "vertical", root: 0.04, tip: 0.13, tip2: 0.04, z0: -0.12, z1: -0.22, z2: -0.3, z3: -0.3, along: 0.6 },
        { plane: "horizontal", root: 0.06, tip: 0.46, z0: 0.24, z1: -0.06, along: 0.3 },
      ],
    }),
  manta: () => wingGeometry(0.5, 0.55),
  // Sit-and-wait ambush. The esca — a sac of glowing bacteria on the illicium —
  // is the entire animal at 2000 m, and it is the reason the abyss can have a
  // light source that is also a character.
  anglerfish: () =>
    bodyGeometry({
      lengthSegments: 13,
      profile: fusiform(0.34, 1.9, 0.42),
      widthRatio: 0.8,
      heightRatio: 1,
      fins: [
        { plane: "vertical", root: 0, tip: 0.22, tip2: -0.22, z0: -0.42, z1: -0.58, z2: -0.58, z3: -0.42, along: 1 },
        // The illicium, arching forward over the head.
        { plane: "vertical", root: 0.1, tip: 0.62, tip2: 0.58, z0: 0.24, z1: 0.52, z2: 0.6, z3: 0.3, along: 0.1 },
      ],
    }),
  // Myctophid. Blunt head, forked tail, and photophores in species-specific rows
  // along the belly. The most abundant vertebrate on Earth, and the reason the
  // twilight zone is not empty.
  lanternfish: () =>
    bodyGeometry({
      lengthSegments: 13,
      profile: fusiform(0.7, 1.35, 0.27),
      widthRatio: 0.42,
      heightRatio: 1.1,
      fins: [
        { plane: "vertical", root: 0, tip: 0.4, tip2: -0.4, z0: -0.46, z1: -0.7, z2: -0.7, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.1, z2: -0.2, z3: -0.2, along: 0.5 },
      ],
    }),
  // A deep-water ambush predator built almost entirely of jaw: an oversized
  // gape and needle teeth on a slim body, the forked tail and second dorsal
  // shared with lanternfish, plus a single dorsal-lure fin reusing the
  // anglerfish illicium's own trick — thinner, since a viperfish's lure is a
  // filament, not a rod.
  viperfish: () =>
    bodyGeometry({
      lengthSegments: 17,
      profile: fusiform(0.55, 1.7, 0.22),
      widthRatio: 0.3,
      heightRatio: 0.95,
      fins: [
        { plane: "vertical", root: 0, tip: 0.4, tip2: -0.4, z0: -0.46, z1: -0.7, z2: -0.7, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.1, z2: -0.2, z3: -0.2, along: 0.5 },
        { plane: "vertical", root: 0.04, tip: 0.5, tip2: 0.46, z0: 0.3, z1: 0.42, z2: 0.48, z3: 0.34, along: 0.08 },
      ],
    }),
  // The same ambush silhouette as the viperfish, with the lure moved to a
  // barbel hanging FROM THE CHIN rather than a rod over the head — the quad
  // builder makes no sign assumption on a fin's tip, so a negative tip simply
  // hangs the blade downward instead of raising it.
  dragonfish: () =>
    bodyGeometry({
      lengthSegments: 17,
      profile: fusiform(0.5, 1.6, 0.2),
      widthRatio: 0.28,
      heightRatio: 0.9,
      fins: [
        { plane: "vertical", root: 0, tip: 0.4, tip2: -0.4, z0: -0.46, z1: -0.7, z2: -0.7, z3: -0.46, along: 1 },
        { plane: "vertical", root: 0.05, tip: 0.26, tip2: 0.05, z0: 0.02, z1: -0.1, z2: -0.2, z3: -0.2, along: 0.5 },
        { plane: "vertical", root: 0.03, tip: -0.55, tip2: -0.5, z0: 0.32, z1: -0.05, z2: -0.15, z3: 0.28, along: 0.06 },
      ],
    }),
  // Almost all head — the profile peaks at t ~ 0.09, a short stubby body with
  // no lure and only a small tail. No other archetype here is this front-heavy.
  fangtooth: () =>
    bodyGeometry({
      lengthSegments: 11,
      profile: fusiform(0.22, 2.3, 0.5),
      widthRatio: 0.6,
      heightRatio: 0.85,
      fins: [{ plane: "vertical", root: 0, tip: 0.3, tip2: -0.3, z0: -0.4, z1: -0.5, z2: -0.5, z3: -0.4, along: 1 }],
    }),
  // The gape sits almost exactly at the nose (peak at t ~ 0.036) and tapers
  // into a long thin whip — more length segments than any other archetype so
  // the travelling wave has room to look smooth over that much body.
  gulperEel: () =>
    bodyGeometry({
      lengthSegments: 24,
      radialSegments: 8,
      profile: fusiform(0.12, 3.2, 0.46),
      widthRatio: 0.5,
      heightRatio: 0.9,
      fins: [{ plane: "vertical", root: 0, tip: 0.18, tip2: -0.18, z0: -0.44, z1: -0.5, z2: -0.5, z3: -0.44, along: 1 }],
    }),
  // The "hatchet blade" silhouette: taller than any other archetype here
  // (heightRatio 1.9, against reefFish's 1.25), carrying the same ventral
  // photophore rows as the lanternfish.
  hatchetfish: () =>
    bodyGeometry({
      lengthSegments: 11,
      profile: fusiform(0.58, 1.9, 0.34),
      widthRatio: 0.22,
      heightRatio: 1.9,
      fins: [{ plane: "vertical", root: 0, tip: 0.3, tip2: -0.3, z0: -0.42, z1: -0.62, z2: -0.62, z3: -0.42, along: 1 }],
    }),
  // The giant oarfish: extreme lateral compression (widthRatio 0.08 — the
  // whole point) and a continuous "mane" dorsal crest running nearly the full
  // body, tallest near the head and settling to a low ridge by the tail —
  // built as a run of small picket fins rather than one or two hand-placed
  // ones, since no single quad can carry a continuously-varying crest height.
  // No caudal fin: a real oarfish has none.
  ribbon: () => {
    const maneFins: Fin[] = [];
    const picketCount = 16;
    for (let i = 0; i < picketCount; i += 1) {
      const along = i / (picketCount - 1);
      const z = 0.5 - along;
      const crestHeight = 0.35 * Math.exp(-along * 2.2) + 0.04;
      const halfWidth = 0.04;
      maneFins.push({
        plane: "vertical",
        root: 0,
        tip: crestHeight,
        tip2: crestHeight,
        z0: z + halfWidth,
        z1: z + halfWidth,
        z2: z - halfWidth,
        z3: z - halfWidth,
        along,
      });
    }
    return bodyGeometry({
      lengthSegments: 28,
      radialSegments: 8,
      profile: fusiform(0.35, 1.15, 0.5),
      widthRatio: 0.08,
      heightRatio: 0.9,
      fins: maneFins,
    });
  },
  // A deliberately cheap stand-in for the giant isopod: a real segmented,
  // flattened carapace is not a body of revolution at all, and building one
  // properly is a much larger job than one rare, non-schooling creature
  // justifies here. A SYMMETRIC profile — equal shoulder/taper, unlike every
  // fish archetype above which pinches to a point only at the tail — gives a
  // body blunt at both ends instead of tapering to a fish-like tail, flattened
  // top-to-bottom (heightRatio 0.45) rather than side-to-side. No fins: an
  // isopod has none large enough to read at this scale.
  isopod: () =>
    bodyGeometry({
      lengthSegments: 9,
      profile: fusiform(1.0, 1.0, 0.55),
      widthRatio: 0.85,
      heightRatio: 0.45,
    }),
};

const cache = new Map<BodyArchetype, BufferGeometry>();

/**
 * One geometry per archetype, cloned per school.
 *
 * Cached because fourteen schools draw from seven shapes, and cloned because
 * `normaliseModel` and the adopt path both mutate what they are handed.
 */
export function bodyForArchetype(archetype: BodyArchetype): BufferGeometry {
  const existing = cache.get(archetype);
  if (existing) return existing.clone();
  const built = BUILDERS[archetype]();
  cache.set(archetype, built);
  return built.clone();
}
