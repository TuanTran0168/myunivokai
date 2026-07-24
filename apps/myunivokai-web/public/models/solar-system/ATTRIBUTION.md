# Model Attribution

Spacecraft and asteroid models in this folder are from
[NASA 3D Resources](https://science.nasa.gov/3d-resources/)
(GitHub mirror: nasa/NASA-3D-Resources). NASA content is generally not
subject to copyright in the United States and may be used for commercial
purposes without explicit permission; it must not be used to imply NASA
endorsement, and the NASA insignia is protected. Credit: NASA.

- `hubble.glb` — Hubble Space Telescope (model "A")
- `jwst.glb` — James Webb Space Telescope (model "B")
- `cassini.glb` — Cassini-Huygens (model "A")
- `voyager.glb` — Voyager probe (model "B")
- `bennu.glb` — Asteroid 101955 Bennu radar shape model ("1999 RQ36")

Adaptations: re-encoded from NASA's Draco GLBs to meshopt
(EXT_meshopt_compression) with WebP textures capped at 1024px via
`@gltf-transform/cli optimize` for web delivery.

## Sketchfab CC-BY 4.0 (attribution required)

Licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Credit must remain wherever this ships.

- `black-hole.glb` — "Black Hole" by Nestaeric via Sketchfab —
  <https://sketchfab.com/3d-models/black-hole-e410da98b1e5445eae2acafaaa53587d>
  Wired as the seed-gated "black-hole" rare feature (see
  `src/features/scene-renderers/solar-system/DistantBlackHole.tsx`).

Modifications: converted spec-gloss → metal-rough (`@gltf-transform/cli
metalrough`) for modern three.js, then optimized (EXT_meshopt_compression,
WebP textures capped at 1024px).
