# Three.js and 3D asset references

> **Document status:** Reference catalog
> **Last link review:** 2026-07-22

This catalog collects places to find models, environments and textures suitable
for Three.js/React Three Fiber. In this project, "Three.js compatible" normally
means a self-hosted `.glb` or glTF 2.0 asset that has been inspected, optimized
and tested in the real scene. A marketplace label alone is not enough.

## Preferred download sources

Use these in order unless a scene has a specific art-direction requirement.

| Priority | Source | Typical use | License rule | Project note |
| --- | --- | --- | --- | --- |
| 1 | [Quaternius](https://quaternius.com/) · [license FAQ](https://quaternius.com/faq.html) | Coherent low-poly nature, animals, characters, city and space kits | Site states its models are CC0 | Best first stop for a consistent stylized scene; conversion to GLB may be needed depending on the pack |
| 1 | [Kenney 3D assets](https://kenney.nl/assets/category:3D) · [license FAQ](https://kenney.nl/support) | Lightweight modular game assets and prototypes | Asset pages are CC0 according to Kenney; retain the included license file | Good for web budgets and consistent packs |
| 1 | [Poly Haven](https://polyhaven.com/) · [license](https://polyhaven.com/license) | High-quality models, HDRIs and PBR textures | All assets are CC0 | Prefer lower resolutions and optimize for browser delivery; current forest HDRIs come from here |
| 1 | [ambientCG](https://ambientcg.com/) | PBR materials, HDRIs and some models | Site publishes its assets as CC0 | Useful when Poly Haven does not cover a material; verify the downloaded package and web texture budget |
| 2 | [Poly Pizza](https://poly.pizza/) | Searchable low-poly GLTF/OBJ models | Mixed Creative Commons/public-domain catalog; check each model for CC0 or CC-BY and preserve creator/license data | Current nature pipeline uses it; do not assume every result is CC0 |
| 2 | [pmndrs/assets](https://github.com/pmndrs/assets) | Small web-ready GLBs, HDRIs and textures for R3F | Repository is CC0 | Assets are already optimized and self-contained, but still copy/self-host intentionally rather than creating an uncontrolled runtime dependency |
| 2 | [Smithsonian Open Access](https://www.si.edu/OpenAccess) · [FAQ](https://www.si.edu/openaccess/faq) | Scanned cultural, natural-history and space objects | Use only items marked CC0; downloadable formats include glTF/GLB | Often high-detail scans, so simplify and resize aggressively before browser use |

CC0 is preferred. CC-BY is acceptable only when `ATTRIBUTION.md` records the
asset title, creator, source URL, exact license and any required license link.

## Conditional source: Sketchfab

- Browse [Sketchfab](https://sketchfab.com/) for visual quality and models that
  explicitly allow download.
- Check the exact model license and [Sketchfab license terms](https://sketchfab.com/licenses).
- Programmatic downloads use the [Download API](https://sketchfab.com/developers/download-api)
  and require an authenticated user. A public model page or `isDownloadable`
  flag does not make anonymous CI download reliable.
- Never commit an OAuth/API token. The owner can download a permitted GLB while
  logged in and place it in the repository for optimization and integration.
- Never redistribute the raw asset when its license forbids stand-alone
  redistribution.

These Sketchfab pages were previously selected as visual-quality references;
they are not approved production assets:

- Trees: [Quasarus tree collection](https://sketchfab.com/quasarus/collections/trees-54bacbe6470547ca85c8c09c30f43b5f)
- Forest scenes: [Lava Forest](https://sketchfab.com/3d-models/lava-forest-world-of-flame-florals-2c991c7e151143da8a6a4ec3a4b03bf8), [Pixel Forest Environment](https://sketchfab.com/3d-models/pixel-forest-environment-ac8b262a12bc4adf88ee40a0d2c939f2), [Dirt Road Through Forest](https://sketchfab.com/3d-models/update-dirt-road-through-forest-c4676cdf7715484382400ff63faffd45), [Forest in the Mountains](https://sketchfab.com/3d-models/the-landscape-is-a-forest-in-the-mountains-27b7e06431f244ef84e28bada7560c98)
- Birds and wildlife: [Phoenix](https://sketchfab.com/3d-models/phoenix-bird-844ba0cf144a413ea92c779f18912042), [Spix's Macaw](https://sketchfab.com/3d-models/spixs-macaw-ararinha-azul-3858b6f1d48a48108142d97f9b67bd9d), [Fire Bird](https://sketchfab.com/3d-models/fire-bird-8fbb5c7672b947e68f649141e93a0adf), [Realistic Animals Pack](https://sketchfab.com/3d-models/realistic-animals-pack-d982cb29aa1b402ab9a50d3372683076)

## Test and reference models

| Source | Correct use |
| --- | --- |
| [Khronos glTF Sample Assets](https://github.khronos.org/glTF-Assets/) · [repository](https://github.com/KhronosGroup/glTF-Sample-Assets) | Test GLTFLoader, materials, animations and extensions. Each model has its own license/credit entry; do not assume the collection has one asset license. |
| [three.js GLTFLoader example](https://threejs.org/examples/webgl_loader_gltf) | Confirm how an asset behaves in the official Three.js renderer. It is a technical reference, not a production asset catalog. |

## Inspection and optimization tools

| Tool | Purpose |
| --- | --- |
| [glTF Report](https://gltf.report/) | Drag-and-drop inspection of hierarchy, meshes, materials, animations and extensions |
| [glTF Transform CLI](https://gltf-transform.dev/cli) | Inspect, validate, prune, resize and compress GLB/glTF assets |
| [Three.js GLTFLoader docs](https://threejs.org/docs/pages/GLTFLoader.html) | Supported glTF extensions and loader integration |
| [Three.js DRACOLoader docs](https://threejs.org/docs/pages/DRACOLoader.html) | Draco decoder configuration and trade-offs |
| [Three.js loading guide](https://threejs.org/manual/en/loading-3d-models.html) | Official loading and troubleshooting workflow |

## Admission checklist for this repository

Before an external asset becomes production data:

1. Record the original page, creator, exact asset-level license and download
   date. Save a local license file when supplied.
2. Reject unclear licenses, editorial-only assets, non-commercial restrictions
   and recognizable third-party brands unless explicitly approved.
3. Prefer GLB. Convert other source formats offline; never load a marketplace
   URL at runtime.
4. Inspect hierarchy, dimensions, origin, animation clips, material maps,
   extensions, polygon count, draw calls and texture memory.
5. Optimize with the repository's documented glTF Transform pipeline, then
   re-check appearance and animation. Preserve the `.glb` extension and verify
   the binary header.
6. Store the asset under the owning app's `public/assets/` tree and add it to a
   typed catalog rather than hardcoding a URL in a component.
7. Update the owning asset `ATTRIBUTION.md`, including CC0 assets for provenance
   even when attribution is optional.
8. Test desktop and mobile performance in the actual scene. A model that loads
   successfully is not automatically within the scene budget.

The forest-specific implementation rules remain in
[forest-render-mechanism.md](../fe/forest-render-mechanism.md). The renderer and
scene-selection contract remains in
[threejs-scene-architecture.md](../fe/threejs-scene-architecture.md).
