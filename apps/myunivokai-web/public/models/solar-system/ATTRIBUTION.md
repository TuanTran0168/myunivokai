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
