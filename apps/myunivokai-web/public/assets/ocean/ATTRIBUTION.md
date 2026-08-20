# Ocean asset catalog (ocean-1) — sources and licenses

Everything here is **CC0**, so none of it legally requires credit. It is credited
anyway, because the rule this repository follows is that an asset whose origin
nobody recorded is an asset nobody can replace.

## Why this folder exists at all

The first ocean-1 catalogue had no assets. Every model key resolved to geometry
assembled from three.js primitives in the browser, on the argument that no
agent-downloadable CC0 anglerfish or giant squid exists and that a frozen species
list must not name a species the renderer cannot draw.

The reasoning was sound and the conclusion was wrong, for a reason the search
missed: **Quaternius publishes CC0 marine models with real skeletal swim
animations, and Poly Pizza hosts them already converted to GLB.** That is the
same route the nature-1 catalogue took. `notes/fe/3d-development-limitations.md`
§3 rates primitive assembly "Thấp–TB — không đủ đẹp" and rates a CC0 GLB kit
"TB–Cao"; the ocean shipped the first and looked it.

Animation is the part that could not have been faked. A stiff fish on a circular
rail reads as a prop no matter how good its silhouette is, and these carry
authored `Swimming_Normal` / `Swimming_Fast` / `Swim` clips.

## Models — [Quaternius](https://quaternius.com), CC0, via [Poly Pizza](https://poly.pizza)

Downloaded from Poly Pizza's public CDN (`static.poly.pizza/<uuid>.glb`), which
needs no API key. Contents unmodified.

| File | Model | Animation clips | Source |
| --- | --- | --- | --- |
| fauna-butterfly-fish.glb | Butterfly Fish | Swimming_Normal/Fast/Impulse, Attack, Death, Out_Of_Water | <https://poly.pizza/m/s2MkBeSzGy> |
| fauna-lionfish.glb | Lionfish | same six | <https://poly.pizza/m/czsz9Baw86> |
| fauna-black-lionfish.glb | Black Lion Fish | same six | <https://poly.pizza/m/4k2s68UrSg> |
| fauna-piranha.glb | Piranha | same six | <https://poly.pizza/m/F7bCnF1BFf> |
| fauna-turbot.glb | Turbot | same six | <https://poly.pizza/m/E8NjhhdvSU> |
| fauna-blobfish.glb | Blobfish | same six | <https://poly.pizza/m/7Jh8vsARfN> |
| fauna-swordfish.glb | Swordfish | same six | <https://poly.pizza/m/7hMOlBjln0> |
| fauna-manta-ray.glb | Manta ray | Swim | <https://poly.pizza/m/yzD8b7ZHZm> |
| fauna-shark.glb | Shark | Swim | <https://poly.pizza/m/AyHTK3zUSG> |
| fauna-goblin-shark.glb | Goblin Shark | six-clip Fish_Armature set | <https://poly.pizza/m/JQrBevTzgD> |
| fauna-dolphin.glb | Dolphin | Swim | <https://poly.pizza/m/3LzFgI3GLO> |
| fauna-whale.glb | Whale | Swim | <https://poly.pizza/m/JGFwp6xWgk> |
| fauna-anglerfish.glb | Anglerfish | same six | <https://poly.pizza/m/MRjSlwCjHM> |

59–209 KB each, 1.8 MB for all thirteen — against the forest's 33 GLB. The
ocean still has no HDRI: there is no sky a thousand metres down.

**The anglerfish replaces a goblin-shark stand-in**, not a gap. The line
below used to read "no CC0 anglerfish or gulper eel was found", which was
true of the search that wrote it — this is the same Quaternius pack, found on
a later pass. `gulper-eel` still has no match and keeps the goblin shark's
silhouette.

**Only the swim clips are used.** Attack/Death/Out_Of_Water are authored for a
fishing game and have no meaning in a portrait scene; a fish that plays `Death`
because a clip index shifted is the failure mode worth naming here.

## Not found anywhere: a lanternfish or myctophid model

Searched beyond Poly Pizza and Sketchfab on request — Kenney.nl (2D sprites
only, no 3D fish pack), OpenGameArt.org, several itch.io "deep sea creatures"
packs, and Cults3D (3D-printing STL, wrong format and style entirely). One
real myctophid exists on Sketchfab — a Florida Museum of Natural History
photogrammetry scan — but `isDownloadable: false` and an empty license
(all-rights-reserved by default). No CC0/CC-BY lanternfish exists anywhere
free that this search reached.

## Procedural skin, not a missing asset: silversides, anthias, lanternfish

Three species in `oceanRigFauna.ts`'s `OCEAN_RIG_SPECIES` have no GLB and,
after the search above, are not going to get one soon. Rather than leave them
a flat single-colour `MeshStandardMaterial` — the "toy" read a texture-less
procedural body always has — `oceanFishSkinTexture.ts` bakes a
`CanvasTexture` onto the same cylindrical UV `oceanRigBodies.ts`'s body of
revolution already exposes (u = angle around the body, v = head to tail),
using the identical "hash a wrapped lattice, smoothstep-interpolate" noise
`createSandTextures` already bakes the seabed with — CC0-equivalent in that
it costs no download and needs no licence line, generated at runtime from a
seed.

The lanternfish additionally gets an emissive-only texture: paired photophore
rows either side of the belly seam, real myctophid anatomy, so the existing
"a lanternfish is a dark fish wearing lights" comment in `oceanRig.ts` is
finally true at the pixel level instead of as a uniform whole-body glow.

## Thirteen more species, same reasoning: nothing free exists for any of them

A real search — Poly Pizza (every source it aggregates, not just Quaternius),
Quaternius's full itch.io catalogue, Kenney.nl, several itch.io "deep sea
creatures" packs, OpenGameArt — turned up no free CC0/CC-BY model for
barracuda, orca, clownfish, pufferfish, viperfish, black dragonfish,
fangtooth, gulper/pelican eel, hatchetfish, giant oarfish, or giant isopod.
(Octopus and squid models exist on Poly Pizza, but only as CC0 sushi-ingredient
poses from Quaternius's *Modular Sushi Restaurant Kit* or as CC-BY "Poly by
Google" archive pieces — neither fits a living swim pose under this family's
CC0-only bar, which is why the cephalopods are their own, separate pass.)

Every one of the eleven is `oceanRigBodies.ts` geometry plus, since none has a
GLB, an `oceanFishSkinTexture.ts` bake — nine reuse the existing
`bodyGeometry()`/`fusiform()` machinery with new parameters (four of those,
barracuda/orca/clownfish/pufferfish, reuse an EXISTING archetype outright:
`shark`, `dolphin` and `reefFish` respectively, the same way swordfish already
reuses `shark`). Two needed a genuinely new construction:

- **`ribbon`** (giant oarfish): extreme lateral compression plus a continuous
  "mane" dorsal crest built from sixteen small picket fins instead of the one
  or two hand-placed fins every other archetype uses, since no single quad can
  carry a crest whose height varies continuously from head to tail.
- **`isopod`** (giant isopod): a deliberately cheap approximation. A real
  segmented, flattened carapace is not a body of revolution at all, and
  building one properly is a much larger job than one rare, non-schooling
  creature justifies. A symmetric profile (blunt at both ends, unlike every
  fish archetype here) plus a new periodic dark-banding option in the albedo
  bake (`FishSkinOptions.bands`) suggests the tergite-plate seams instead.

Black dragonfish is the one species here with its own glow colour
(`FaunaSpecies.glowColor`) rather than the teal every other deep species
shares — real *Idiacanthus* bioluminescence is red, which most deep-sea eyes
can't see, making it a private searchlight. Fangtooth is the one species that
opts OUT of the ambient glow wash entirely (`glowColor: null`): it is
confirmed non-bioluminescent, relying on ultra-black, light-trapping skin
instead, which is also why it gets a much rougher, non-metallic material
override (`FaunaSpecies.roughness`/`metalness`) rather than the rig's default
— a light-trap reads as matte, not as polished plastic.

Sea turtle, seahorse, true segmented-carapace isopod, dumbo octopus and giant
Pacific octopus were considered and deliberately deferred: the first two don't
fit a Z-axis body of revolution at all (a shell-and-flippers or a bent,
segmented spine each want their own construction), and the latter three are
cheap follow-ons once the cephalopod tentacle geometry exists, better done
once that pass has proven the pattern out than rushed alongside it.

## Not used: PBR textures — [Poly Haven](https://polyhaven.com), CC0

Six 1k tiling maps were fetched and then **removed without ever being loaded**,
and the reason is worth recording because it is the same lesson as the Sketchfab
entry below.

| Asset | Was for |
| --- | --- |
| `coast_sand_rocks_02` | seabed albedo / normal / roughness |
| `aerial_rocks_02` | rock albedo / normal / roughness |

Both are fetchable again from Poly Haven's public API by those asset IDs — it
needs no key, only a user-agent and referer header — so nothing is lost by their
absence.

They were downloaded to fix a striping artifact on the seabed, on the assumption
that a photographic albedo would break up a pattern the procedural one could not.
It would not have: the stripe was a sum of plane waves laid on a lattice, and what
fixed it was giving the noise a DOMAIN WARP and integer wave numbers so the field
tiles exactly. The prototype these frames are measured against loads zero image
textures for the same reason.

So the seabed's sand and normal maps are generated at runtime from one height
field, at 512², costing no download and no licence to track. Four point nine
megabytes of unreferenced JPEG is not a neutral thing to leave in a repository:
git history is permanent, and an asset nobody loads is an asset the next person
has to work out whether they may delete.

## Not used: Sketchfab

Sketchfab's download endpoint returns **401 without an OAuth token**, for CC0
models as much as for any other, and `isDownloadable` on a public model page does
not change that. It is therefore owner-manual, never agent-automatable. See
`notes/references/threejs-assets.md`. **Never commit a Sketchfab token.**

## Superseded: "still procedural"

Flora (kelp, seagrass, the corals, anemone, tubeworm, glass sponge, sea pen),
landmarks and the three abyssal-visitor species remain browser-built geometry in
`src/features/scene-renderers/ocean/oceanModels.ts`. Flora does not need
skeletal animation — it sways from the current, which is a vertex-shader job —
and the abyssal species have no CC0 source found so far. Swapping any of them to
a GLB later changes no stored config and re-renders every existing world.

## Reused from `public/assets/nature/` — Quaternius, CC0

The section above ("Still procedural") was **wrong about the premise**, and this
records the correction. It concluded that no CC0 coral, kelp or seagrass could be
found and shipped browser-built cylinders and cones instead. An asset audit of
the repository found sixteen usable CC0 GLBs **already committed** for the forest
family. Nothing had to be downloaded; the ocean's budget in
`ocean-service-plan.md` §8 (≤ 16 GLB, ≤ 3 MB) is untouched, and a visitor who has
loaded one forest world already has these cached.

Mapped in `src/features/scene-renderers/ocean/oceanDressingModels.ts` **by
silhouette**, which is the only property of a shape that survives thirty metres
of seawater:

| Ocean key / landmark kind | Nature GLB | Why the silhouette works |
| --- | --- | --- |
| `flora-kelp-giant` | grass-tall-1.glb | a bundle of long blades streaming up |
| `flora-seagrass` | grass-1.glb | the same, at ankle height |
| `flora-coral-staghorn` | tree-dead-1.glb | bare, rigid, repeatedly forking |
| `flora-coral-brain` | rock-mossy-2.glb | a boulder with a folded surface |
| `flora-coral-soft` | fern-1.glb | feathered fronds from a short stalk |
| `flora-anemone` | flower-group-1.glb | a cluster of soft coloured blooms |
| `flora-tubeworm` | flower-single-1.glb | one stalk carrying one head |
| `flora-glass-sponge` | mushroom-1.glb | a stalk carrying a cup |
| `flora-sea-pen` | bush-flowers-1.glb | a plume on the sediment |
| seabed rocks (3 size classes) | rock-mossy-1/2/3.glb | boulders, cobbles, gravel |
| `kelpCathedral` | tree-dead-2.glb | tall bare columns branching into a canopy |
| `sunkenRelic` | landmark-lantern-shrine.glb | the one landmark that must read as MADE |
| `hydrothermalVent` | rock-mossy-3.glb | a chimney, plus its procedural plume |
| `coralGarden` | bush-1.glb | a dense low mound |
| `abyssalTrench` | rock-mossy-1.glb | an outcrop at hero scale |
| `whaleFall` | landmark-fallen-log.glb | a long pale form on the sediment |

**`landmark-heart-tree.glb` was tried for `kelpCathedral` and rejected.** Its
canopy is a literal heart, so at landmark scale it read as one enormous coloured
petal filling a quarter of the frame. A silhouette that already says something
specific cannot be repurposed, however well it is tinted.

Every part is re-materialised for seawater in `dressForSeawater`: non-foliage
materials are **cloned** before tinting (drei caches GLTFs by URL, so mutating one
would reach across and change the forest), tinted toward the water by the depth
curve's own `tintStrength`, and given the seabed's caustics.

## Now genuinely procedural

Jellyfish and other drifters, bioluminescent plankton, marine snow, the water
surface, the god-ray volume and the caustics. The three abyssal-visitor species
still have no CC0 source and keep their built geometry.
