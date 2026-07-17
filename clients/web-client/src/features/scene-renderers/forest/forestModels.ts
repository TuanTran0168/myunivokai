import {
  Box3,
  BufferGeometry,
  Color,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3
} from "three";

// The nature-1 asset catalog: every modelKey the backend config can emit maps
// to self-hosted, draco-compressed CC0/CC-BY GLB files under
// public/assets/nature/models (sources and licenses in
// public/assets/nature/ATTRIBUTION.md). Models are normalized at load time —
// uniform-scaled to targetHeight with the foot centered at the origin — so
// catalog entries never need hand-tuned offsets.

export const NATURE_MODEL_BASE_PATH = "/assets/nature/models/";

export type ForestModelDefinition = {
  fileName: string;
  /** World-space height the normalized model is scaled to. */
  targetHeight: number;
  /**
   * ONLY for files that pack several complete stand-alone models (e.g.
   * Quaternius' "Birch Trees" set): each top-level subtree becomes its own
   * variant. Never set it for single-model files — a normal tree's bark and
   * leaves are sibling meshes, and splitting them apart renders bare trunks
   * next to floating canopies.
   */
  splitIntoVariants?: boolean;
};

export const TREE_MODEL_CATALOG: Record<string, ForestModelDefinition[]> = {
  "tree-birch": [{ fileName: "tree-birch-1.glb", targetHeight: 7.5, splitIntoVariants: true }],
  "tree-oak": [
    { fileName: "tree-oak-1.glb", targetHeight: 6.5 },
    { fileName: "tree-oak-2.glb", targetHeight: 6.0 }
  ],
  "tree-pine": [
    { fileName: "tree-pine-1.glb", targetHeight: 8.5 },
    { fileName: "tree-pine-2.glb", targetHeight: 7.8 }
  ],
  // Only the Quaternius snow pine — the CC-BY "Snow Tree" clashed with the
  // pack's art style (owner: style coherence beats variety).
  "tree-pine-snow": [{ fileName: "tree-pine-snow-1.glb", targetHeight: 8.0 }],
  "tree-dead": [
    { fileName: "tree-dead-1.glb", targetHeight: 5.5 },
    { fileName: "tree-dead-2.glb", targetHeight: 5.0 }
  ],
  // Blossom = the oak silhouettes wearing the pink foliage anchor: the two
  // downloaded CC-BY cherry models read chunky/off-style next to Quaternius.
  "tree-blossom": [
    { fileName: "tree-oak-1.glb", targetHeight: 6.0 },
    { fileName: "tree-oak-2.glb", targetHeight: 5.6 }
  ]
};

export const ROCK_MODEL_DEFINITIONS: ForestModelDefinition[] = [
  { fileName: "rock-mossy-1.glb", targetHeight: 1.0 },
  { fileName: "rock-mossy-2.glb", targetHeight: 0.9 },
  { fileName: "rock-mossy-3.glb", targetHeight: 1.1 }
];

export const GRASS_MODEL_DEFINITIONS: ForestModelDefinition[] = [
  { fileName: "grass-1.glb", targetHeight: 0.45 },
  { fileName: "grass-tall-1.glb", targetHeight: 0.65 }
];

// Understory decoration; scattered between the trees for ground richness.
export const DECOR_MODEL_DEFINITIONS: ForestModelDefinition[] = [
  { fileName: "bush-1.glb", targetHeight: 1.1 },
  { fileName: "bush-flowers-1.glb", targetHeight: 1.0 },
  { fileName: "fern-1.glb", targetHeight: 0.7 },
  { fileName: "flower-group-1.glb", targetHeight: 0.55 },
  { fileName: "flower-single-1.glb", targetHeight: 0.5 },
  { fileName: "mushroom-1.glb", targetHeight: 0.35 },
  { fileName: "stump-moss-1.glb", targetHeight: 0.55 }
];

export type AnimalModelDefinition = ForestModelDefinition & {
  /** Animation clip preferred for wandering; empty for static models. */
  walkClipName: string;
};

export const ANIMAL_MODEL_CATALOG: Record<string, AnimalModelDefinition> = {
  "animal-deer": { fileName: "animal-deer.glb", targetHeight: 1.7, walkClipName: "Walk" },
  "animal-fox": { fileName: "animal-fox.glb", targetHeight: 0.8, walkClipName: "Walk" },
  "animal-wolf": { fileName: "animal-wolf.glb", targetHeight: 1.1, walkClipName: "Walk" },
  "animal-boar": { fileName: "animal-boar.glb", targetHeight: 0.9, walkClipName: "" },
  "animal-rabbit": { fileName: "animal-rabbit.glb", targetHeight: 0.45, walkClipName: "" },
  // Schema 1.1 additions ("đa dạng động vật hơn").
  "animal-stag": { fileName: "animal-stag.glb", targetHeight: 2.0, walkClipName: "Walk" },
  "animal-bear": { fileName: "animal-bear.glb", targetHeight: 1.5, walkClipName: "" },
  "animal-squirrel": { fileName: "animal-squirrel.glb", targetHeight: 0.35, walkClipName: "" }
};

// Hover/detail display names for the interactive wildlife layer.
export const ANIMAL_DISPLAY_NAMES: Record<string, string> = {
  "animal-deer": "Deer",
  "animal-fox": "Fox",
  "animal-wolf": "Wolf",
  "animal-boar": "Boar",
  "animal-rabbit": "Rabbit",
  "animal-stag": "Stag",
  "animal-bear": "Bear",
  "animal-squirrel": "Squirrel"
};

export const BIRD_MODEL_DEFINITION: ForestModelDefinition = { fileName: "bird-forest.glb", targetHeight: 0.35 };

// Poly Haven CC0 pure-sky HDRIs (1k .hdr), self-hosted — image-based
// environment lighting keyed by the config's lighting.hdriKey.
export const NATURE_HDRI_BASE_PATH = "/assets/nature/hdri/";
export const HDRI_FILES_BY_KEY: Record<string, string> = {
  "nature-hdri-day": "nature-hdri-day.hdr",
  "nature-hdri-golden-hour": "nature-hdri-golden-hour.hdr",
  "nature-hdri-dusk": "nature-hdri-dusk.hdr"
};

export function natureHdriUrlForKey(hdriKey?: string): string {
  const fileName = HDRI_FILES_BY_KEY[hdriKey ?? ""] ?? HDRI_FILES_BY_KEY["nature-hdri-day"];
  return NATURE_HDRI_BASE_PATH + fileName;
}

export const LANDMARK_MODEL_CATALOG: Record<string, ForestModelDefinition> = {
  heartTree: { fileName: "landmark-heart-tree.glb", targetHeight: 9.0 },
  // A tall mossy rock reads as a menhir; the flat "Stone Block" cube read as
  // a floating black box against the sky.
  standingStone: { fileName: "rock-mossy-2.glb", targetHeight: 2.8 },
  fallenLog: { fileName: "landmark-fallen-log.glb", targetHeight: 0.9 },
  lanternShrine: { fileName: "landmark-lantern-shrine.glb", targetHeight: 2.0 },
  flowerPatch: { fileName: "flower-group-1.glb", targetHeight: 0.6 }
};

export function natureModelUrl(definition: ForestModelDefinition): string {
  return NATURE_MODEL_BASE_PATH + definition.fileName;
}

// Foliage materials get their texture dropped and are re-colored per instance
// with the seasonal palette (a multiplied tint over a green texture would
// turn autumn orange into mud). Flowers keep their original colorful look.
const FOLIAGE_MATERIAL_NAME_PATTERN = /leaf|leaves|grass|foliage|^green$/i;

export type InstancedModelPart = {
  geometry: BufferGeometry;
  material: Material;
  /** Foliage parts expect a per-instance color (seasonal tint). */
  isFoliage: boolean;
};

export type InstancedModelVariant = {
  parts: InstancedModelPart[];
};

function isFoliageMaterial(material: Material): boolean {
  return FOLIAGE_MATERIAL_NAME_PATTERN.test(material.name ?? "");
}

function collectMeshesInWorldSpace(root: Object3D): Mesh[] {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) {
      meshes.push(object as Mesh);
    }
  });
  return meshes;
}

// One shared white-based material per foliage part so instanceColor carries
// the whole color; created once per extraction, reused across instances.
function foliageReplacementMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color("#FFFFFF"), roughness: 0.9, metalness: 0 });
}

function buildVariantFromMeshes(meshes: Mesh[], targetHeight: number): InstancedModelVariant | null {
  if (meshes.length === 0) {
    return null;
  }
  const unionBox = new Box3();
  const workingBox = new Box3();
  const bakedGeometries: { geometry: BufferGeometry; material: Material }[] = [];
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    bakedGeometries.push({ geometry, material });
    workingBox.setFromBufferAttribute(geometry.getAttribute("position") as never);
    unionBox.union(workingBox);
  }
  const size = unionBox.getSize(new Vector3());
  const height = Math.max(size.y, 0.0001);
  const uniformScale = targetHeight / height;
  const center = unionBox.getCenter(new Vector3());
  // Foot at y=0, centered in XZ, scaled to targetHeight.
  const normalizeMatrix = new Matrix4()
    .makeScale(uniformScale, uniformScale, uniformScale)
    .multiply(new Matrix4().makeTranslation(-center.x, -unionBox.min.y, -center.z));

  const parts: InstancedModelPart[] = bakedGeometries.map(({ geometry, material }) => {
    geometry.applyMatrix4(normalizeMatrix);
    geometry.computeBoundingSphere();
    const foliage = isFoliageMaterial(material);
    return {
      geometry,
      material: foliage ? foliageReplacementMaterial() : material,
      isFoliage: foliage
    };
  });
  return { parts };
}

/**
 * Extracts instancing-ready variants from a loaded GLB scene. By default the
 * WHOLE scene is one variant — a single tree's bark and leaves are sibling
 * meshes, and splitting siblings apart renders bare trunks next to floating
 * canopies (the bug behind the first broken-forest screenshots). Only files
 * flagged splitIntoVariants (multi-model sets like "Birch Trees") split, and
 * only at a level whose children are grouping nodes, never at raw meshes.
 */
export function extractInstancedModelVariants(
  sceneRoot: Object3D,
  targetHeight: number,
  splitIntoVariants = false
): InstancedModelVariant[] {
  sceneRoot.updateMatrixWorld(true);
  if (splitIntoVariants) {
    let splitLevel: Object3D = sceneRoot;
    while (splitLevel.children.length === 1) {
      splitLevel = splitLevel.children[0];
    }
    const childrenAreGroupingNodes =
      splitLevel.children.length > 1 && splitLevel.children.every((child) => !(child as Mesh).isMesh);
    if (childrenAreGroupingNodes) {
      const childVariants = splitLevel.children
        .map((child) => buildVariantFromMeshes(collectMeshesInWorldSpace(child), targetHeight))
        .filter((variant): variant is InstancedModelVariant => variant !== null);
      if (childVariants.length > 1) {
        return childVariants;
      }
    }
  }
  const wholeVariant = buildVariantFromMeshes(collectMeshesInWorldSpace(sceneRoot), targetHeight);
  return wholeVariant ? [wholeVariant] : [];
}

/**
 * Normalization transform for a non-instanced model (animals, landmarks):
 * scale so the model stands targetHeight tall with its feet at y=0.
 */
export function normalizationForObject(object: Object3D, targetHeight: number): { scale: number; footOffsetY: number } {
  const boundingBox = new Box3().setFromObject(object);
  const height = Math.max(boundingBox.max.y - boundingBox.min.y, 0.0001);
  const scale = targetHeight / height;
  return { scale, footOffsetY: -boundingBox.min.y * scale };
}

export type StaticInstanceTransform = {
  position: Vector3;
  yawRadians: number;
  scale: number;
  /** Applied to foliage parts only; ignored by textured parts. */
  foliageColor?: Color;
};

/**
 * Builds the InstancedMesh set for one model variant with fixed transforms
 * (rocks, grass, understory decoration — anything that never animates).
 */
export function buildStaticInstancedMeshes(
  variant: InstancedModelVariant,
  transforms: StaticInstanceTransform[],
  options?: { castShadow?: boolean; receiveShadow?: boolean }
): InstancedMesh[] {
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scaleVector = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  return variant.parts.map((part) => {
    const mesh = new InstancedMesh(part.geometry, part.material, transforms.length);
    transforms.forEach((transform, instanceIndex) => {
      rotation.setFromAxisAngle(yAxis, transform.yawRadians);
      scaleVector.setScalar(transform.scale);
      matrix.compose(transform.position, rotation, scaleVector);
      mesh.setMatrixAt(instanceIndex, matrix);
      if (part.isFoliage && transform.foliageColor) {
        mesh.setColorAt(instanceIndex, transform.foliageColor);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = options?.castShadow ?? true;
    mesh.receiveShadow = options?.receiveShadow ?? false;
    return mesh;
  });
}
