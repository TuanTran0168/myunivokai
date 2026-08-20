/**
 * Animals: real meshes, one draw call per species, and locomotion that is a
 * property of the animal rather than of the artist.
 *
 * The design is the one Abzû used and the one this family's plan has been
 * arguing for: a static mesh, instanced, deformed in the VERTEX SHADER by a
 * swim cycle. No skeletons, no per-instance clones. The shader's entire contract
 * with its geometry is one float attribute — `along`, 0 at the nose and 1 at the
 * tail — so any mesh that can be put in the same local frame inherits the whole
 * locomotion model for free. That is what makes it asset-independent.
 *
 * Three things about the shipped GLBs, each of which cost a round to find:
 *
 *   1. Every model is split into two to five SUB-MESHES, one per material —
 *      body, fins, eyes, mouth. Loading the first one and stopping renders the
 *      shark's underside in one flat grey with no fins and no eye. They are
 *      merged here, with each part's colour carried as a vertex colour.
 *   2. Counter-shading is written in absolute units against a body about 0.34
 *      deep. A real model is whatever the artist made it, so the belly
 *      coordinate is rescaled per model or the animal renders in one flat tone.
 *   3. Which end is the head must be DECLARED and then CHECKED. Two heuristics
 *      were tried and both failed silently — a dolphin's dorsal fin is deeper
 *      than its rostrum, and summing cross-sections lets tessellation vote. The
 *      check that works is the EYE: ten of the twelve models carry a separate
 *      near-black material for it, and an eye is on the head by definition.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { bodyForArchetype, type BodyArchetype } from "./oceanRigBodies";
import { createFishSkinBake } from "./oceanFishSkinTexture";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { randomFromSeed } from "@/lib/scene";
import { OCEAN_MODEL_BASE_PATH } from "./oceanFaunaModels";

/**
 * Species differ by HOW MUCH OF THE BODY undulates, not by how fast. That is
 * the whole taxonomy of fish locomotion in one number, and it is why an eel and
 * a tuna read as different animals from a silhouette alone.
 */
export const GLSL_UNDULATION = /* glsl */ `
  float bodyLateralOffset(float alongBody, float onset, float waves,
                          float amplitude, float beatHertz, float elapsed, float phase) {
    float span = max(1e-4, 1.0 - onset);
    float envelope = max(0.0, (alongBody - onset) / span);
    float p = beatHertz * elapsed * 6.2831853 - alongBody * waves * 6.2831853 + phase;
    return envelope * envelope * amplitude * sin(p);
  }
`;

export type SwimStyle = {
  /** Fraction of the body that stays rigid. 0.88 is a swordfish, 0.55 an eel. */
  onset: number;
  amplitude: number;
  waves: number;
  /** Tail beats per second. */
  beat: number;
  /** Cetaceans oscillate vertically: their flukes are horizontal. */
  vertical?: boolean;
  /** Rays fly. The wave runs across the SPAN and the body axis holds still. */
  mobuliform?: boolean;
  /** Half the wingspan in body lengths, for the mobuliform envelope. */
  span?: number;
};

/**
 * A bait ball: leaders cluster onto one shared, slowly-drifting axis instead
 * of scattering around the whole ring, and members spiral that axis instead
 * of riding a fixed offset in the leader's frame. See createSchool.
 */
export type VortexStyle = {
  /** Metres from the shared axis at the cone's widest point. */
  radius: number;
  /** Full rotations per second the swirl completes around the axis. */
  spinHertz: number;
  /** How sharply the cone tapers top/bottom; 1 is a true cone, higher is more cylindrical. */
  taper: number;
};

export type FaunaSpecies = {
  key: string;
  /**
   * File under OCEAN_MODEL_BASE_PATH, when this species has one.
   *
   * Optional, and that is the point. Four of the fourteen animals here have no
   * model on disk — silversides, anthias, lanternfish and anglerfish — and they
   * happen to be the mass schools that make an ocean look inhabited. While a
   * file was mandatory those four could not exist, which cost the rig 2154 of
   * its 2550 animals. Every species now renders from `body` immediately and only
   * UPGRADES to a GLB if one is named here and loads.
   */
  file?: string;
  /** The procedural silhouette this species is drawn from until a GLB arrives. */
  body: BodyArchetype;
  /**
   * The animal's own colour, used by the procedural body.
   *
   * An adopted GLB brings its own vertex colours and overrides this — but until
   * one does, and forever for the four species that have no model, this is the
   * only colour the animal has.
   */
  color: string;
  swim: SwimStyle;
  /** Which bounding-box axis is the body, and which end the head is on. */
  bodyAxis: "long" | "second";
  head: 1 | -1;
  /** Shallowest depth in metres this animal is drawn at. */
  minDepthMetres: number;
  /** Deepest. */
  maxDepthMetres: number;
  /** Only drawn when the seabed is in frame. */
  needsSeafloor?: boolean;
  /** Only drawn when the surface is in frame. */
  needsSurface?: boolean;
  count: number;
  leaders: number;
  /** Metres of body length. */
  size: number;
  spread: number;
  pathRadius: number;
  heightBase: number;
  heightRange: number;
  speedScale?: number;
  /** Big animals ride a wide ring so they never pass through the lens. */
  tightRing?: boolean;
  surfacing?: boolean;
  /**
   * Keeps its own colour instead of surrendering it to the water.
   *
   * Not a cheat: at 2-4 m the water has taken almost nothing out of the return
   * path, so a reef fish genuinely does still read orange. This is the one place
   * saturated colour is allowed to live underwater, and without it the reef has
   * no warm note anywhere in frame.
   */
  nearField?: boolean;
  label: string;
  /**
   * Paired ventral photophore rows, baked into an emissive texture instead of
   * the flat whole-body glow every species with no GLB used to get. Real
   * myctophid anatomy, and the reason a lanternfish reads as "a dark fish
   * wearing lights" rather than as a uniformly pale flake. See
   * oceanFishSkinTexture.ts.
   */
  photophores?: boolean;
  /** Rides a rotating bait-ball instead of a flat ring. See VortexStyle. */
  vortex?: VortexStyle;
  /** A threat: fleesPredators schools bias away from its leaders' positions. */
  predator?: boolean;
  /** Biases its leaders away from the nearest predator school's leaders. */
  fleesPredators?: boolean;
  /** Metres at which alarm reaches its maximum. Default: max(16, pathRadius*0.9). */
  fleeRadiusMetres?: number;
  /** Flash-expansion strength: members fan outward as alarm rises. 0 (default) is leader-swerve only. */
  fleeFanOut?: number;
  /** Cruise-speed multiplier while alarmed — the startled dash, on top of speedScale. */
  burstSpeedScale?: number;
  /** Periodically detours a leader toward the camera, then eases back to its ring. */
  approachesCamera?: boolean;
  /** How close the detour brings it, in metres. Default 6. */
  approachDistanceMetres?: number;
  /** Seconds per approach-and-retreat cycle. Default 34 (off the dolphin's 26s breathing cycle). */
  approachCycleSeconds?: number;
};

/**
 * Who lives where, and how they move. Zones are real: a goblin shark has been
 * filmed between 900 and 1300 m, a lionfish is a reef ambusher, and a manta is
 * an epipelagic filter feeder. Nothing here is a mood.
 */
export const OCEAN_RIG_SPECIES: readonly FaunaSpecies[] = [
  {
    key: "butterflyfish",
    color: "#F0C24A",
    nearField: true,
    body: "reefFish",
    file: "fauna-butterfly-fish.glb",
    label: "butterflyfish",
    swim: { onset: 0.74, amplitude: 0.05, waves: 0.9, beat: 3.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 60,
    needsSeafloor: true,
    count: 130,
    leaders: 6,
    size: 0.34,
    spread: 3.4,
    pathRadius: 16,
    heightBase: -6,
    heightRange: 5,
    // An unhurried reef grazer — same baseline every other unset species used
    // to share, now distinguished from the livelier small schoolers below.
    speedScale: 0.8,
  },
  {
    key: "lionfish",
    color: "#B8642F",
    nearField: true,
    body: "reefFish",
    file: "fauna-lionfish.glb",
    label: "lionfish",
    // Lionfish hover on their pectorals, so the body wave is nearly nothing.
    swim: { onset: 0.8, amplitude: 0.035, waves: 0.5, beat: 1.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 70,
    needsSeafloor: true,
    count: 9,
    leaders: 9,
    size: 0.52,
    spread: 1,
    pathRadius: 15,
    heightBase: -6,
    heightRange: 4,
    speedScale: 0.22,
    tightRing: true,
  },
  {
    key: "turbot",
    color: "#8C7F5C",
    body: "reefFish",
    file: "fauna-turbot.glb",
    label: "turbot",
    // A flatfish on sand does not swim; the motion is a ripple down the margin.
    swim: { onset: 0.35, amplitude: 0.025, waves: 1.6, beat: 0.9 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 400,
    needsSeafloor: true,
    count: 14,
    leaders: 14,
    size: 0.7,
    spread: 1,
    pathRadius: 26,
    heightBase: -1.2,
    heightRange: 1.4,
    speedScale: 0.04,
    tightRing: true,
  },
  {
    key: "shark",
    color: "#8794A0",
    body: "shark",
    file: "fauna-shark.glb",
    label: "reef shark",
    // Thunniform: rigid forebody, all the work at the peduncle.
    swim: { onset: 0.82, amplitude: 0.07, waves: 0.5, beat: 1.5 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 400,
    count: 6,
    leaders: 6,
    size: 3.4,
    spread: 1,
    pathRadius: 68,
    heightBase: -4,
    heightRange: 11,
    tightRing: true,
    // A reef shark cruises, it doesn't hurry — slower than the default every
    // unset species used to share.
    speedScale: 0.8,
    // The one predator whose leaders' positions prey schools react to.
    predator: true,
    // Occasionally breaks its ring to close on the lens, then eases back —
    // the "swims close, then peels away" the flat orbit could never do alone.
    approachesCamera: true,
  },
  {
    key: "swordfish",
    color: "#5A6470",
    body: "shark",
    file: "fauna-swordfish.glb",
    label: "swordfish",
    swim: { onset: 0.88, amplitude: 0.045, waves: 0.4, beat: 2.4 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 250,
    count: 5,
    leaders: 5,
    size: 2.6,
    spread: 1,
    pathRadius: 64,
    heightBase: -7,
    heightRange: 11,
    speedScale: 1.5,
    tightRing: true,
    // The open-water counterpart to the reef shark: also a threat prey reacts to.
    predator: true,
  },
  {
    key: "manta",
    color: "#39424C",
    body: "manta",
    file: "fauna-manta-ray.glb",
    label: "manta",
    // Mobuliform: dorsoventral pectoral flapping, thrust peaking near 1 Hz and
    // efficiency near 0.8. The body axis barely moves — bending a manta along
    // its length is the one tell that turns it into a swimming carpet.
    swim: { onset: 0, amplitude: 0.34, waves: 0.4, beat: 0.42, mobuliform: true, span: 0.37 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 220,
    count: 3,
    leaders: 3,
    size: 4.2,
    spread: 1,
    pathRadius: 76,
    heightBase: -6,
    heightRange: 11,
    speedScale: 0.55,
    tightRing: true,
  },
  {
    key: "dolphin",
    color: "#A9B9C4",
    body: "dolphin",
    file: "fauna-dolphin.glb",
    label: "dolphin pod",
    swim: { onset: 0.74, amplitude: 0.075, waves: 0.45, beat: 1.25, vertical: true },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    needsSurface: true,
    count: 11,
    leaders: 3,
    size: 2.6,
    spread: 6.5,
    pathRadius: 58,
    heightBase: -4,
    heightRange: 8,
    tightRing: true,
    surfacing: true,
    speedScale: 1.1,
  },
  {
    key: "whale",
    color: "#5D6E7A",
    body: "whale",
    file: "fauna-whale.glb",
    label: "whale",
    // Beat frequency falls with size: a calf beats four to seven times as often
    // as its mother at the same speed.
    swim: { onset: 0.62, amplitude: 0.045, waves: 0.4, beat: 0.28, vertical: true },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 320,
    count: 1,
    leaders: 1,
    size: 13,
    spread: 1,
    pathRadius: 118,
    heightBase: -9,
    heightRange: 10,
    speedScale: 0.3,
    tightRing: true,
  },
  {
    key: "goblinShark",
    color: "#6A6F78",
    body: "shark",
    file: "fauna-goblin-shark.glb",
    label: "goblin shark",
    swim: { onset: 0.55, amplitude: 0.1, waves: 0.75, beat: 0.85 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 700,
    maxDepthMetres: 4000,
    count: 2,
    leaders: 2,
    size: 3.1,
    spread: 1,
    pathRadius: 44,
    heightBase: -6,
    heightRange: 9,
    speedScale: 0.3,
    tightRing: true,
    // Shares the twilight/abyss with lanternfish — a threat there too.
    predator: true,
  },
  {
    key: "blobfish",
    color: "#A88079",
    body: "reefFish",
    file: "fauna-blobfish.glb",
    label: "blobfish",
    // At depth it is an ordinary-looking fish; it is only a blob at the surface,
    // where decompression has ruined it.
    swim: { onset: 0.6, amplitude: 0.02, waves: 0.5, beat: 0.45 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 550,
    maxDepthMetres: 4000,
    needsSeafloor: true,
    count: 7,
    leaders: 7,
    size: 0.62,
    spread: 1,
    pathRadius: 20,
    heightBase: -4,
    heightRange: 3,
    speedScale: 0.05,
    tightRing: true,
  },
  // ---- the four the rig never had ----------------------------------------
  // No GLB exists for any of these, which is exactly why they were missing: while
  // a model file was mandatory they could not be declared at all. They are also
  // the four that carry the population — 2044 of the rig's animals — so their
  // absence is the single largest visual difference from the prototype.
  {
    key: "silversides",
    color: "#DCEEF5",
    body: "reefFish",
    label: "silversides",
    // The schooling default: the posterior 30-50% of the body undulates.
    swim: { onset: 0.6, amplitude: 0.08, waves: 0.7, beat: 2.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    needsSeafloor: true,
    // The largest school in the rig by an order of magnitude. A reef without one
    // is a diorama: this is the shimmering cloud that makes the water feel
    // occupied, and it is one InstancedMesh.
    count: 1400,
    leaders: 9,
    size: 0.3,
    spread: 8,
    pathRadius: 19,
    heightBase: -6,
    heightRange: 15,
    // A lively flicker, not the same baseline every unset species used to share.
    speedScale: 1.35,
    // A real bait ball: the mass clusters onto one drifting axis and spirals it,
    // instead of scattering loosely around the whole ring.
    vortex: { radius: 5, spinHertz: 0.12, taper: 1.4 },
    fleesPredators: true,
    fleeFanOut: 0.5,
    burstSpeedScale: 1.6,
  },
  {
    key: "anthias",
    color: "#FF7A33",
    nearField: true,
    body: "reefFish",
    label: "anthias",
    swim: { onset: 0.6, amplitude: 0.08, waves: 0.7, beat: 2.8 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 0,
    maxDepthMetres: 90,
    needsSeafloor: true,
    // Tight, close and orange. On a reef this is the only saturated warm colour
    // the water has not taken, which is why it rides the smallest path radius in
    // the rig: near-field colour only survives at near-field distance.
    count: 340,
    leaders: 5,
    size: 0.24,
    spread: 3.2,
    pathRadius: 13,
    heightBase: -7,
    heightRange: 6,
    speedScale: 1.25,
    fleesPredators: true,
    fleeFanOut: 0.5,
    burstSpeedScale: 1.5,
  },
  {
    key: "lanternfish",
    color: "#1E2A33",
    body: "lanternfish",
    label: "lanternfish",
    photophores: true,
    swim: { onset: 0.35, amplitude: 0.09, waves: 0.9, beat: 2.2 },
    bodyAxis: "long",
    head: 1,
    // Myctophids are THE mesopelagic fish and the most abundant vertebrate on
    // Earth. They are the entire reason the twilight zone is not an empty box —
    // which is precisely what it rendered as without them.
    minDepthMetres: 70,
    maxDepthMetres: 4000,
    count: 300,
    leaders: 9,
    size: 0.3,
    spread: 7.5,
    pathRadius: 30,
    heightBase: -8,
    heightRange: 22,
    speedScale: 1.2,
    fleesPredators: true,
    burstSpeedScale: 1.4,
  },
  {
    key: "anglerfish",
    color: "#161C22",
    body: "anglerfish",
    // Quaternius via Poly Pizza — the same pack the other twelve GLBs came
    // from, found on a later pass than the one that shipped the procedural
    // body. It keeps the illicium and its glowing esca (see the `anglerfish`
    // body factory's own comment on why that detail is the point) and adds
    // the bulbous eyes and teeth a 13-segment procedural silhouette cannot.
    // The procedural body is still what renders before this loads.
    file: "fauna-anglerfish.glb",
    label: "anglerfish",
    swim: { onset: 0.5, amplitude: 0.05, waves: 0.6, beat: 0.7 },
    bodyAxis: "long",
    head: 1,
    minDepthMetres: 480,
    maxDepthMetres: 11000,
    // Four, moving almost not at all. A sit-and-wait ambush predator that swam
    // laps would be a different animal, and the esca is the point: a light source
    // in the abyss that is also a character.
    count: 4,
    leaders: 4,
    size: 0.85,
    spread: 1,
    pathRadius: 17,
    heightBase: -4,
    heightRange: 8,
    speedScale: 0.06,
    tightRing: true,
  },
];

type MergedPart = { geometry: BufferGeometry; color: Color };

function mergeParts(parts: MergedPart[]): BufferGeometry {
  let total = 0;
  for (const part of parts) total += part.geometry.getAttribute("position").count;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  let cursor = 0;
  for (const part of parts) {
    const p = part.geometry.getAttribute("position");
    const n = part.geometry.getAttribute("normal");
    for (let i = 0; i < p.count; i += 1) {
      const o = (cursor + i) * 3;
      position[o] = p.getX(i);
      position[o + 1] = p.getY(i);
      position[o + 2] = p.getZ(i);
      if (n) {
        normal[o] = n.getX(i);
        normal[o + 1] = n.getY(i);
        normal[o + 2] = n.getZ(i);
      }
      color[o] = part.color.r;
      color[o + 1] = part.color.g;
      color[o + 2] = part.color.b;
    }
    cursor += p.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(position, 3));
  merged.setAttribute("normal", new BufferAttribute(normal, 3));
  merged.setAttribute("color", new BufferAttribute(color, 3));
  return merged;
}

export type NormalisedModel = {
  geometry: BufferGeometry;
  /** 0.17 / half-height: what the counter-shading gradient has to be scaled by. */
  bellyScale: number;
  triangles: number;
  /** True when the eye or the cross-section agrees with the declaration. */
  orientationAgrees: boolean;
};

/**
 * Put a loaded model into the frame every species entry was authored against:
 * one unit long, centred, nose at +Z, with `along` running 0 at the nose to 1 at
 * the tail — which is the direction the undulation envelope grows in.
 */
export function normaliseModel(source: BufferGeometry, species: FaunaSpecies): NormalisedModel {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  for (const name of ["uv", "uv1", "uv2", "tangent"]) {
    if (geometry.getAttribute(name)) geometry.deleteAttribute(name);
  }
  geometry.computeBoundingBox();
  const size = new Vector3();
  geometry.boundingBox?.getSize(size);

  const ranked: [("x" | "y" | "z"), number][] = [
    ["x", size.x],
    ["y", size.y],
    ["z", size.z],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const bodyAxis = species.bodyAxis === "second" ? ranked[1]?.[0] : ranked[0]?.[0];
  if (bodyAxis && bodyAxis !== "z") {
    const matrix = new Matrix4();
    if (bodyAxis === "x") matrix.makeRotationY(Math.PI / 2);
    else matrix.makeRotationX(-Math.PI / 2);
    geometry.applyMatrix4(matrix);
    geometry.computeBoundingBox();
    geometry.boundingBox?.getSize(size);
  }

  const centre = new Vector3();
  geometry.boundingBox?.getCenter(centre);
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / size.z, 1 / size.z, 1 / size.z);

  const position = geometry.getAttribute("position");
  const colour = geometry.getAttribute("color");

  // The eye test. Ten of these models carry a separate near-black material for
  // the eyes, byte-identical across the set, and an eye is on the head.
  let eyeAlong = 0;
  let eyeCount = 0;
  if (colour) {
    for (let i = 0; i < colour.count; i += 1) {
      const luma = 0.2126 * colour.getX(i) + 0.7152 * colour.getY(i) + 0.0722 * colour.getZ(i);
      if (luma < 0.03) {
        eyeAlong += position.getZ(i);
        eyeCount += 1;
      }
    }
  }
  // Fallback for the four models with no eye material: a body tapers toward its
  // tail, so the half holding the thicker cross-section is the head half. MEANS,
  // not sums — summing lets tessellation vote, and the shark GLB carries far
  // more vertices in its fins than in its shoulders.
  let frontBulk = 0;
  let backBulk = 0;
  let frontCount = 0;
  let backCount = 0;
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (Math.abs(z) <= 0.06) continue;
    const radius = Math.hypot(position.getX(i), position.getY(i));
    if (z > 0) {
      frontBulk += radius;
      frontCount += 1;
    } else {
      backBulk += radius;
      backCount += 1;
    }
  }
  const measured =
    eyeCount > 24
      ? eyeAlong / eyeCount >= 0
        ? 1
        : -1
      : (frontCount ? frontBulk / frontCount : 0) >= (backCount ? backBulk / backCount : 0)
        ? 1
        : -1;

  if (species.head < 0) geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI));

  const along = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    along[i] = Math.min(1, Math.max(0, 0.5 - position.getZ(i)));
  }
  geometry.setAttribute("along", new BufferAttribute(along, 1));
  // NOT computeVertexNormals: the model's own normals came through the merge
  // already transformed, and recomputing replaces the artist's smoothing with
  // hard facets on every fin.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const halfHeight = box ? Math.max(1e-3, (box.max.y - box.min.y) * 0.5) : 0.17;

  return {
    geometry,
    bellyScale: 0.17 / halfHeight,
    triangles: position.count / 3,
    orientationAgrees: measured === species.head,
  };
}

/**
 * Fetch and normalise this species' GLB, if it has one.
 *
 * Returns null rather than throwing for a species with no model, because having
 * no model is a normal state here, not a failure: the procedural body is already
 * on screen and correct.
 */
export async function loadSpeciesGeometry(species: FaunaSpecies): Promise<NormalisedModel | null> {
  if (!species.file) return null;
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(`${OCEAN_MODEL_BASE_PATH}/${species.file}`);
  gltf.scene.updateMatrixWorld(true);
  const parts: MergedPart[] = [];
  gltf.scene.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    for (const name of ["uv", "uv1", "uv2", "tangent", "skinIndex", "skinWeight", "color"]) {
      if (geometry.getAttribute(name)) geometry.deleteAttribute(name);
    }
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const source =
      material && "color" in material && material.color instanceof Color
        ? material.color
        : new Color(1, 1, 1);
    parts.push({ geometry, color: source.clone() });
  });
  if (!parts.length) throw new Error(`ocean rig: ${species.file} has no meshes`);
  return normaliseModel(mergeParts(parts), species);
}

export type SchoolBounds = { surfaceY: number | null; floorY: number | null };

export type School = {
  species: FaunaSpecies;
  mesh: InstancedMesh;
  material: MeshStandardMaterial;
  bellyUniform: { value: number };
  spanUniform: { value: number };
  adopt: (model: NormalisedModel) => void;
  /**
   * Where the pod cruises relative to its authored height, and how far a breach
   * may pass the waterline. Both move when the viewer crosses the surface: from
   * above, the pod has to sink with the water or eleven dolphins swim in the
   * sky, and a breach becomes the point rather than an accident.
   */
  setSurfacing: (baseOffsetMetres: number, breachMetres: number) => void;
  /**
   * Where a predator school's leaders currently are — the SAME Vector3
   * instances update() mutates every frame, exposed once at construction so
   * reading them costs nothing per frame. Present only when species.predator
   * is true.
   */
  predatorAnchors?: readonly Vector3[];
  /**
   * threats: every predator school's leader positions, built once per frame
   * by the caller (see oceanRig.ts) — O(leaders), never O(members) or
   * O(schools²). cameraPosition: for the small opt-in list of
   * species.approachesCamera species. Both optional so a school with no
   * predators/camera-approach nearby costs nothing extra.
   */
  update: (elapsed: number, bounds: SchoolBounds, threats?: readonly Vector3[], cameraPosition?: Vector3) => void;
  dispose: () => void;
};

type Leader = {
  angle: number;
  radius: number;
  speed: number;
  height: number;
  bob: number;
  breathPhase: number;
  /** Drives the approachesCamera cycle — see FaunaSpecies.approachesCamera. */
  approachPhase: number;
  /** How close the nearest predator is, 0 (calm) to 1 (at the flee radius' edge or closer). */
  alarm: number;
  position: Vector3;
  heading: Vector3;
};

type Member = {
  leader: Leader;
  offset: Vector3;
  scale: number;
  wander: number;
  /** Set only for species.vortex members — see createSchool's member loop. */
  spiralPhase?: number;
  spiralRadius?: number;
};

const FORWARD = new Vector3(0, 0, 1);

/**
 * A school: one InstancedMesh, a handful of leaders on rings, and members that
 * ride in the leader's own frame so the shoal banks together instead of
 * shearing when the leader turns.
 */
export function createSchool(
  species: FaunaSpecies,
  seed: string,
  creatureTime: { value: number },
  visibilityMetres = Number.POSITIVE_INFINITY,
): School {
  // The body the school starts with, and for four species keeps forever. It used
  // to be a single-vertex placeholder with `visible = false`, which meant a
  // species was either upgraded to a GLB or never seen at all.
  const placeholder = bodyForArchetype(species.body);
  const material = new MeshStandardMaterial({
    color: new Color(species.color),
    roughness: 0.44,
    metalness: 0.3,
    side: DoubleSide,
    emissive: new Color("#000000"),
    emissiveIntensity: 0,
  });
  const bellyUniform = { value: 1 };
  const spanUniform = { value: species.swim.span ?? 0.5 };

  // A skin bake only for species with no GLB to adopt — a species with one
  // gets its texture from the model itself the moment `adopt()` runs, and a
  // bake it would discard within a frame or two is wasted canvas work.
  // material.color is left alone: the bake is a grey multiplier, not a
  // colour, so the near-field emissive copy below (which reads
  // material.color) still sees the species' real colour.
  const skinBake = species.file ? null : createFishSkinBake({ seed, photophores: species.photophores });
  if (skinBake) {
    material.map = skinBake.map;
    if (skinBake.emissiveMap) material.emissiveMap = skinBake.emissiveMap;
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCreatureTime = creatureTime;
    shader.uniforms.uOnset = { value: species.swim.onset };
    shader.uniforms.uAmplitude = { value: species.swim.amplitude };
    shader.uniforms.uWaves = { value: species.swim.waves };
    shader.uniforms.uBeat = { value: species.swim.beat };
    shader.uniforms.uSpan = spanUniform;
    shader.uniforms.uBellyScale = bellyUniform;

    const axis = species.swim.mobuliform
      ? `// The wave runs across the SPAN and grows toward the wingtip.
         float span = clamp(abs(position.x) / uSpan, 0.0, 1.0);
         float flap = sin(uCreatureTime * uBeat * 6.2831853 + aPhase - span * uWaves * 6.2831853);
         transformed.y += flap * pow(span, 1.7) * uAmplitude;`
      : species.swim.vertical
        ? "transformed.y += lateral;   // a cetacean oscillates VERTICALLY"
        : "transformed.x += lateral;";

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
          uniform float uCreatureTime; uniform float uOnset; uniform float uAmplitude;
          uniform float uWaves; uniform float uBeat; uniform float uSpan;
          uniform float uBellyScale;
          attribute float along; attribute float aPhase;
          varying float vBelly; varying float vAlong;
          ${GLSL_UNDULATION}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          vBelly = position.y * uBellyScale;
          vAlong = along;
          float lateral = bodyLateralOffset(along, uOnset, uWaves, uAmplitude, uBeat, uCreatureTime, aPhase);
          ${axis}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBelly;\nvarying float vAlong;")
      // Counter-shading: dark back, bright belly. It is why a school reads as a
      // flicker of light rather than a cloud of identical objects.
      .replace(
        "#include <tonemapping_fragment>",
        "gl_FragColor.rgb *= mix(1.7, 0.72, smoothstep(-0.16, 0.16, vBelly));\n#include <tonemapping_fragment>",
      );
  };

  const mesh = new InstancedMesh(placeholder, material, species.count);
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const next = randomFromSeed(`${seed}:${species.key}`);
  const phases = new Float32Array(species.count);
  const leaders: Leader[] = [];
  // THE RING IS CLAMPED TO WHAT THE WATER CAN ACTUALLY SHOW.
  //
  // `pathRadius` is authored in absolute metres — 118 for the whale, 76 for the
  // manta, 68 for the shark — and how far you can see is not. In Jerlov I the
  // sighting range is about 65 m, so at 142 m depth EVERY large animal in the
  // frame sat at or beyond the limit of visibility: the shark arrived at 34% of
  // its contrast and the whale at 4%, which is gone. What was left was three
  // hundred lanternfish 0.3 m long, and a frame whose only visible inhabitants
  // are 0.3 m long has no scale reference at all. It measured as a flat wash —
  // local detail 0.03 against the prototype's 0.10.
  //
  // Clamping to the range is the whole fix, and it is a statement about the
  // medium rather than a tuning choice: an animal further away than the water is
  // clear is not a distant animal, it is an absent one. Near-field species are
  // untouched — every ring under about 60 m already sits inside the budget — so
  // this only pulls in the four that were outside it, and their sizes differ by a
  // factor of four, so they still read as near and far.
  const ringLimit = Math.max(6, visibilityMetres);
  // A bait ball: leaders cluster onto ONE shared, drifting angle/radius
  // instead of scattering independently around the whole ring — see
  // FaunaSpecies.vortex and the member spiral below. Drawn once, before the
  // per-leader loop, so it costs nothing for the species that don't set it.
  const vortexAngle = species.vortex ? next() * Math.PI * 2 : 0;
  const vortexRadius = species.vortex ? Math.min(species.pathRadius, ringLimit) * (0.9 + next() * 0.1) : 0;
  for (let i = 0; i < species.leaders; i += 1) {
    leaders.push({
      angle: species.vortex ? vortexAngle + (next() - 0.5) * 0.2 : next() * Math.PI * 2,
      radius: species.vortex
        ? vortexRadius * (0.96 + next() * 0.08)
        : Math.min(species.pathRadius, ringLimit) *
          (species.tightRing ? 0.9 + next() * 0.25 : 0.35 + next() * 0.75),
      speed: (0.05 + next() * 0.05) * (next() > 0.5 ? 1 : -1) * (species.speedScale ?? 1),
      height: species.heightBase + next() * species.heightRange,
      bob: next() * Math.PI * 2,
      breathPhase: next(),
      approachPhase: next(),
      alarm: 0,
      position: new Vector3(),
      heading: new Vector3(1, 0, 0),
    });
  }
  const members: Member[] = [];
  for (let i = 0; i < species.count; i += 1) {
    const leader = leaders[i % leaders.length];
    if (!leader) break;
    phases[i] = next() * Math.PI * 2;
    // The member's own belt around the vortex axis, tapered from the shared
    // radius by how far up/down the cone it sits — see FaunaSpecies.vortex.
    let spiralPhase: number | undefined;
    let spiralRadius: number | undefined;
    if (species.vortex) {
      const tierFraction = Math.abs(next() - 0.5) * 2;
      spiralPhase = next() * Math.PI * 2;
      spiralRadius = species.vortex.radius * Math.pow(1 - tierFraction, species.vortex.taper) * (0.85 + next() * 0.3);
    }
    members.push({
      leader,
      offset: new Vector3(
        (next() - 0.5) * species.spread,
        (next() - 0.5) * species.spread * 0.45,
        (next() - 0.5) * species.spread,
      ),
      scale: species.size * (0.82 + next() * 0.36),
      wander: next() * Math.PI * 2,
      spiralPhase,
      spiralRadius,
    });
  }
  placeholder.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scaleVector = new Vector3();
  const right = new Vector3();
  let breachHeight = 0;
  let baseOffset = 0;
  let breach = -1.2;

  return {
    species,
    mesh,
    material,
    bellyUniform,
    spanUniform,
    setSurfacing: (baseOffsetMetres, breachMetres) => {
      baseOffset = baseOffsetMetres;
      breach = breachMetres;
    },
    predatorAnchors: species.predator ? leaders.map((leader) => leader.position) : undefined,
    adopt: (model) => {
      model.geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
      bellyUniform.value = model.bellyScale;
      if (species.swim.span) spanUniform.value = species.swim.span;
      // The palette is in the geometry now, so a tint would multiply it twice.
      material.vertexColors = true;
      material.color.setRGB(1, 1, 1);
      material.needsUpdate = true;
      const previous = mesh.geometry;
      mesh.geometry = model.geometry;
      previous.dispose();
    },
    update: (elapsed, bounds, threats, cameraPosition) => {
      // An animal lives BETWEEN the boundaries. The two numbers that decide what
      // is in frame decide where it can be — and this is not cosmetic: without
      // it a manta on a reef swims through the sky, and no frame metric can see
      // that, because every pixel is still in range.
      const clearance = Math.max(0.8, species.size * 0.6);
      const ceiling = bounds.surfaceY === null ? Infinity : bounds.surfaceY - clearance;
      const floorY = bounds.floorY === null ? -Infinity : bounds.floorY + clearance;

      for (const leader of leaders) {
        // Cruise speed carries LAST frame's alarm as a burst multiplier — a
        // one-frame lag, invisible at 60fps, that avoids restructuring this
        // loop around alarm being computed further down in this same pass.
        const speedMultiplier = 1 + leader.alarm * ((species.burstSpeedScale ?? 1) - 1);
        leader.angle += leader.speed * speedMultiplier * 0.016;
        let angle = leader.angle;
        let radius = leader.radius * (1 + Math.sin(leader.angle * 1.7 + leader.bob) * 0.14);
        let height = leader.height + Math.sin(elapsed * 0.24 + leader.bob) * species.heightRange * 0.3;
        height += baseOffset;
        height = Math.min(Math.max(height, floorY), ceiling);
        let climb = 0;
        if (species.surfacing && bounds.surfaceY !== null) {
          // Dolphins surface every 20-40 s in ordinary activity. A pod rising to
          // breathe and sinking back is the most legible behaviour any animal in
          // this scene can perform.
          const cycle = ((elapsed / 26 + leader.breathPhase) % 1 + 1) % 1;
          const ascent = Math.pow(Math.sin(Math.PI * cycle), 3);
          climb = ascent;
          height = height * (1 - ascent) + (bounds.surfaceY + breach) * ascent;
          breachHeight = Math.max(0, breach + clearance) * ascent;
        }
        // A scripted detour toward the camera, then back — reserved for a
        // short opt-in list (species.approachesCamera). This blends the
        // RENDERED angle/radius/height only, never the persistent
        // leader.angle, so once the envelope decays the leader is exactly
        // back on its ordinary ring with no separate "return" phase to author.
        if (species.approachesCamera && cameraPosition) {
          const cycleSeconds = species.approachCycleSeconds ?? 34;
          const cycle = ((elapsed / cycleSeconds + leader.approachPhase) % 1 + 1) % 1;
          const approach = Math.pow(Math.max(0, Math.sin(Math.PI * cycle)), 5);
          if (approach > 0.001) {
            const camAngle = Math.atan2(cameraPosition.z, cameraPosition.x);
            const camDist = Math.max(
              species.approachDistanceMetres ?? 6,
              Math.hypot(cameraPosition.x, cameraPosition.z),
            );
            let deltaAngle = camAngle - angle;
            deltaAngle -= Math.PI * 2 * Math.round(deltaAngle / (Math.PI * 2));
            angle += deltaAngle * approach;
            radius = radius * (1 - approach) + camDist * approach;
            height = height * (1 - approach) + cameraPosition.y * approach;
          }
        }
        leader.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        leader.heading
          .set(-Math.sin(angle) * Math.sign(leader.speed), climb * 0.5, Math.cos(angle) * Math.sign(leader.speed))
          .normalize();

        // Predator proximity: a continuous alarm from nearest-threat distance,
        // not a state machine — calm/alert/flee/calm falls out of the distance
        // curve alone. O(threats) per leader, never O(members) or O(schools²).
        let alarm = 0;
        if (species.fleesPredators && threats && threats.length > 0) {
          let nearestDistSq = Infinity;
          let awayX = 0;
          let awayZ = 0;
          for (const threat of threats) {
            const dx = leader.position.x - threat.x;
            const dz = leader.position.z - threat.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
              awayX = dx;
              awayZ = dz;
            }
          }
          const fleeRadius = species.fleeRadiusMetres ?? Math.max(16, species.pathRadius * 0.9);
          const dist = Math.sqrt(nearestDistSq);
          alarm = Math.min(1, Math.max(0, 1 - dist / fleeRadius));
          if (alarm > 0 && dist > 1e-3) {
            const push = alarm * fleeRadius * 0.6;
            leader.position.x += (awayX / dist) * push;
            leader.position.z += (awayZ / dist) * push;
            leader.heading.x = leader.heading.x * (1 - alarm) + (awayX / dist) * alarm;
            leader.heading.z = leader.heading.z * (1 - alarm) + (awayZ / dist) * alarm;
            leader.heading.normalize();
          }
        }
        leader.alarm = alarm;
      }

      for (let i = 0; i < members.length; i += 1) {
        const member = members[i];
        if (!member) continue;
        const leader = member.leader;
        // A bait ball: members spiral the vortex axis instead of riding a
        // fixed offset in the leader's frame. See FaunaSpecies.vortex.
        if (species.vortex && member.spiralRadius !== undefined) {
          const spiralAngle = (member.spiralPhase ?? 0) + elapsed * species.vortex.spinHertz * Math.PI * 2;
          const cosSpiral = Math.cos(spiralAngle);
          const sinSpiral = Math.sin(spiralAngle);
          position.copy(leader.position);
          position.x += cosSpiral * member.spiralRadius;
          position.z += sinSpiral * member.spiralRadius;
          position.y += member.offset.y;
          position.y = Math.min(position.y, ceiling + breachHeight);
          if (bounds.floorY !== null) position.y = Math.max(position.y, floorY);
          right.set(-sinSpiral, 0, cosSpiral);
          quaternion.setFromUnitVectors(FORWARD, right);
          scaleVector.setScalar(member.scale);
          matrix.compose(position, quaternion, scaleVector);
          mesh.setMatrixAt(i, matrix);
          continue;
        }
        const drift = Math.sin(elapsed * 0.7 + member.wander) * 0.25;
        // Flash-expansion: members fan outward from the leader's line as its
        // alarm rises — see FaunaSpecies.fleeFanOut. 1 (no fan-out) when unset.
        const fan = species.fleeFanOut ? 1 + leader.alarm * species.fleeFanOut : 1;
        position.copy(leader.position);
        right.set(leader.heading.z, 0, -leader.heading.x).normalize();
        position.addScaledVector(right, (member.offset.x + drift) * fan);
        position.y += member.offset.y;
        position.addScaledVector(leader.heading, member.offset.z * fan);
        position.y = Math.min(position.y, ceiling + breachHeight);
        if (bounds.floorY !== null) position.y = Math.max(position.y, floorY);
        quaternion.setFromUnitVectors(FORWARD, leader.heading);
        scaleVector.setScalar(member.scale);
        matrix.compose(position, quaternion, scaleVector);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      skinBake?.dispose();
    },
  };
}

/** Whether this animal can be where the viewer is. */
export function speciesIsPresent(
  species: FaunaSpecies,
  viewerDepthMetres: number,
  seafloorInSight: boolean,
  surfaceInSight: boolean,
): boolean {
  if (viewerDepthMetres < species.minDepthMetres) return false;
  if (viewerDepthMetres > species.maxDepthMetres) return false;
  if (species.needsSeafloor && !seafloorInSight) return false;
  if (species.needsSurface && !surfaceInSight) return false;
  return true;
}
