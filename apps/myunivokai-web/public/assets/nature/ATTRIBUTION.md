# Nature asset catalog (nature-1) — sources and licenses

All 3D models under `models/` were downloaded from [Poly Pizza](https://poly.pizza)
and are self-hosted here. Files were optimized (Draco geometry compression,
textures resized to 512px WebP) with gltf-transform; contents are otherwise
unmodified. CC0 requires no attribution; CC-BY credits are listed as required.

## CC0 (public domain) — by [Quaternius](https://poly.pizza/u/Quaternius)

| File | Source |
| --- | --- |
| tree-birch-1.glb | <https://poly.pizza/m/R7qMWzb7nk> |
| tree-oak-1.glb | <https://poly.pizza/m/QVOop92WmG> |
| tree-oak-2.glb | <https://poly.pizza/m/aVOxaHRPWe> |
| tree-pine-1.glb | <https://poly.pizza/m/rfnxJv0Rqa> |
| tree-pine-2.glb | <https://poly.pizza/m/igSu0cPoBz> |
| tree-pine-snow-1.glb | <https://poly.pizza/m/17vQv2X5rh> |
| tree-dead-1.glb | <https://poly.pizza/m/n8FhMgMldD> |
| tree-dead-2.glb | <https://poly.pizza/m/MlmK5488ou> |
| rock-mossy-1.glb | <https://poly.pizza/m/KZdEP3uUpa> |
| rock-mossy-2.glb | <https://poly.pizza/m/s1OJ3bBzqc> |
| rock-mossy-3.glb | <https://poly.pizza/m/JQxF95498B> |
| grass-1.glb | <https://poly.pizza/m/vUJjrRsFp4> |
| grass-tall-1.glb | <https://poly.pizza/m/JSIYtscPmP> |
| flower-group-1.glb | <https://poly.pizza/m/hfPzQAedOe> |
| flower-single-1.glb | <https://poly.pizza/m/rHBoS64rRL> |
| bush-1.glb | <https://poly.pizza/m/EoTERLq3z2> |
| bush-flowers-1.glb | <https://poly.pizza/m/U1ymDy8tbY> |
| fern-1.glb | <https://poly.pizza/m/jqcanvH7D6> |
| mushroom-1.glb | <https://poly.pizza/m/aOW08oSrd4> |
| stump-moss-1.glb | <https://poly.pizza/m/nFvEbUX6LE> |
| animal-deer.glb | <https://poly.pizza/m/T6Cs7tmMHJ> |
| animal-fox.glb | <https://poly.pizza/m/Bc97C66HKi> |
| animal-wolf.glb | <https://poly.pizza/m/P1gU3Qkr9r> |
| animal-stag.glb | <https://poly.pizza/m/tQdzbZ1Cmw> |
| bird-armabee.glb | <https://poly.pizza/m/42djT5zJnx> |
| landmark-heart-tree.glb | <https://poly.pizza/m/9aWlx82xUf> |
| landmark-fallen-log.glb | <https://poly.pizza/m/nwsYvcI0bC> |

## CC0 (public domain) — other creators

| File | Creator | Source |
| --- | --- | --- |
| landmark-lantern-shrine.glb | [Kay Lousberg](https://poly.pizza/u/Kay%20Lousberg) | <https://poly.pizza/m/ZSQ65S4lEu> |

## CC-BY 3.0 (attribution required)

Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

| File | Credit | Source |
| --- | --- | --- |
| animal-boar.glb | "Boar" by Poly by Google via Poly Pizza | <https://poly.pizza/m/57fSWum6F1P> |
| animal-rabbit.glb | "Rabbit" by madtrollstudio via Poly Pizza | <https://poly.pizza/m/lEJ3d1gMLC> |
| animal-bear.glb | "Bear" by madtrollstudio via Poly Pizza | <https://poly.pizza/m/kLLBpmcw0w> |
| animal-squirrel.glb | "Squirrel" by Poly by Google via Poly Pizza | <https://poly.pizza/m/caxos24uWC9> |
| bird-hawk.glb (rigged flap animation; also reused tinted as the special-bird crosser) | "Hawk Lp Rigged" by Sherkiz via Poly Pizza | <https://poly.pizza/m/RkN6MEbP6g> |

## HDRIs — Poly Haven, CC0

1k pure-sky `.hdr` environments under `hdri/`, from [Poly Haven](https://polyhaven.com) (CC0):

| File | Source asset |
| --- | --- |
| nature-hdri-day.hdr | `kloofendal_48d_partly_cloudy_puresky` |
| nature-hdri-golden-hour.hdr | `industrial_sunset_puresky` |
| nature-hdri-dusk.hdr | `evening_road_01_puresky` |

## PBR textures — Poly Haven, CC0

1k tiling PBR maps under `textures/`, from [Poly Haven](https://polyhaven.com) (CC0).
Used as the forest ground's surface RELIEF only (normal + roughness); the ground
albedo stays vertex-colored and season-driven, so the maps add unevenness without
overriding the grass/leaf-litter/snow color logic.

| File | Source asset | Channel used |
| --- | --- | --- |
| forest-floor-normal-1k.jpg | `forest_floor` (nor_gl) | normal map |
| forest-floor-arm-1k.jpg | `forest_floor` (arm) | roughness (green channel) |

## Experimental — Sketchfab CC-BY 4.0 (under `models/experimental/`, NOT yet wired)

Baked whole-scene meshes downloaded from Sketchfab for visual evaluation only.
They are self-hosted and optimized but are **not** modular instanceable assets,
so they are not referenced by the forest renderer/catalog yet. Licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/);
credit is required if any of these ships in a build.

Modifications: optimized with `@gltf-transform/cli optimize` (Draco geometry
compression, mesh simplification, WebP textures capped at 1024px).

| File | Credit | Source |
| --- | --- | --- |
| dirt-road-through-forest.glb | "[UPDATE] Dirt Road Through Forest" by 99.Miles via Sketchfab | <https://sketchfab.com/3d-models/update-dirt-road-through-forest-c4676cdf7715484382400ff63faffd45> |
| wetland-shoal-river.glb | "Wetland, shoal and river" by Metazeon via Sketchfab | <https://sketchfab.com/3d-models/wetland-shoal-and-river-898699b35ff149188c0ed94723b96d69> |
