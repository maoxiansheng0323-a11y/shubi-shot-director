# Refined White Mannequin Design

## Goal

Upgrade Shubi Shot Director's visible actor from low-detail revolved primitives
to a refined, Unity-quality articulated white mannequin while preserving the existing
generic graybox scope, SceneSpec v6 compatibility, deterministic fifteen-joint
pose contract, stature editing, limb presence, contact, composition, save/load,
and browser-authored PNG export.

## Approved Direction

The user approved the most conservative implementation after a live source and
license review. The release will ship one audited CC0 segmented mannequin as a
built-in renderer asset. It will not add arbitrary mesh paths, asset upload,
project profiles, character identities, clothing, textures, facial systems, or
animation authoring.

The initial source candidates are:

- Blender Studio Human Base Meshes v1.4.1, published as a 49 MB CC0 asset
  bundle on the official Blender demo-files page.
- MPFB/MakeHuman bundled assets and generated output, whose official license
  declares the base mesh, rigs, poses, expressions, and exported graphical data
  CC0. MPFB is an offline authoring option, not a runtime dependency.

Live inspection of the Blender Studio bundle found separate realistic primitive
body objects for the torso, pelvis, head, neck, shoulders, upper/lower arms,
hands and fingers, upper/lower legs, feet, and toes. The female source contains
50 objects and 4,604 base polygons; the male source contains 49 objects and
4,504 base polygons. Every source part uses subdivision level 2 and the shared
parts have matching base topology. There is no armature. This structure maps
more safely to the Director's existing articulated projection than a newly
invented skinning pass.

Only an optimized, source-attributed segmented derivative that passes the
repository license audit may become a committed runtime asset.

## Architecture

### Persistent authority remains unchanged

SceneSpec stays at schema version 6 and remains the sole persistent scene
authority. No scene stores an asset path, mesh payload, bone name, source URL,
or renderer option. Legacy and Blueprint actors continue to resolve through
`resolveActorProjection`.

The browser renderer gains a built-in mannequin mesh catalog derived from the
same dimensions, effective limb presence, joint frames, and actor transform as
the existing analytical primitives. The catalog contains only stable built-in
mesh IDs and canonical primitive mappings. It never contains a filesystem path.

### Visual and analytical projections share one source

The existing primitives remain the authoritative analytical representation for
contact, composition, selection bounds, software diagnostics, and compatibility
exports. The browser renderer may replace supported primitive geometry with a
refined built-in mesh only when the asset manifest validates. The mesh receives
the exact primitive frame, center, and resolved dimensions already used by the
analytical renderer. No consumer reinterprets SceneSpec or Blueprint data
independently.

When the mannequin cannot represent an actor state safely, the renderer uses
the current humanoid primitives. This includes asset-load failure or a missing
required mesh. The fallback is deterministic and visible,
not a silent partial mesh.

### Canonical section mapping

The shipped GLB contains normalized mesh nodes for the stable primitive IDs:

`pelvis`, `torso`, `neck`, `head`, left/right `upper_arm`, `forearm`, `hand`,
`upper_leg`, `lower_leg`, and `foot`.

Each node is centered, oriented to the Director's local axes, normalized to a
unit bounding box, and assigned one white material. Arm meshes use proximal
Y=0 and distal Y=-1; leg meshes use the same convention; torso uses Y=0 through
Y=1; pelvis, neck, and head retain their analytical center conventions. Runtime
code rejects a loaded asset whose required nodes, material, or neutral bounds
do not match the committed manifest.

The fifteen canonical joint quaternions continue to produce the primitive
frames. No public bone names, helper bones, inverse kinematics, or skin weights
are added.

### Limb presence

The high-quality mannequin is already partitioned into canonical render sections.
Each section is associated with one of the twelve limb-presence keys, while
torso, pelvis, neck, head, and orientation marker remain core sections.
Effective presence continues to resolve through the existing base, variant,
and instance-override hierarchy. The source's separate shoulder, limb, hand,
finger, foot, and toe objects allow the converter to join complete terminal
sections without cutting a continuous body mesh.

### Material and lighting

The mannequin uses one neutral matte-white physically based material with no
skin texture, identity detail, clothing, hair, or project-specific markings.
Smooth normals, restrained roughness, ambient/hemisphere fill, filtered key
light shadows, and contact-readable shading provide the refined result. Actor
selection adds a subtle cool tint without replacing the base material.

## Asset Pipeline

1. Download the official source into ignored `.shubi-shot/research/` state.
2. Record source URL, source version, license URL, download SHA-256, and selected
   source-object names in a committed provenance document.
3. Use a reproducible Blender script to select the realistic primitive female
   and male collections, omit sex-specific breast geometry, pair their shared
   topology, average the normalized shapes, group fingers with hands and toes
   with feet, apply one subdivision level, normalize canonical axes and bounds,
   remove unused data, and export GLB 2.0.
4. Optimize with glTF Transform only when it changes neither node identity nor
   visual bounds. Prefer an uncompressed sub-2 MB GLB when compression would
   require a remote decoder or another runtime dependency.
5. Validate the final GLB structure, node names, section names, material
   count, triangle count, bounds, byte size, SHA-256, and absence of embedded
   private metadata.
6. Commit only the optimized runtime GLB, its small manifest, license/provenance
   record, and the reproducible conversion script. Do not commit the source
   archive, DCC cache, or downloaded toolchain.

## Runtime Behavior

- Legacy and Blueprint actors render every available refined section when the
  asset and manifest validate, including incomplete limb chains.
- Height continues to resolve from `body.heightM` or Blueprint
  `heightScale`; entity transform scale is not repurposed.
- The existing `build` and resolved shoulder/pelvis dimensions influence the
  mannequin through bounded renderer deformation or the closest audited mesh
  variant. Slot names and labels never infer body type.
- Canonical joint patches update the mannequin sections in the same committed
  revision as the analytical projection.
- Missing or invalid assets fail closed to the current procedural mannequin and
  produce one generic browser diagnostic without blocking scene editing.
- PNG export continues to require the connected browser Shot Preview and
  captures exactly the visible renderer result.

## Testing

### Automated

- Manifest parsing rejects missing assets, hash mismatches, missing mesh nodes,
  unexpected remote URLs, and unsupported material counts.
- Mesh mapping covers all sixteen refined primitive IDs and their resolved
  primitive frames.
- Height, Blueprint scaling, neutral pose, wrist/ankle corrections, complete
  action poses, and actor transforms do not mutate SceneSpec or snapshot hashes.
- Limb section mapping is complete for every canonical limb state.
- Loader failures preserve a usable scene and do not generate unhandled promise
  rejections.
- Public audit recognizes the committed CC0 provenance and continues to reject
  private markers, paths, credentials, and unapproved dependency licenses.

### Browser acceptance

The release gate uses generic legacy and Blueprint scenes and captures front,
three-quarter, bent-arm, walking, stature-change, and fallback views. It checks
that the canvas is nonblank, the model is fully framed, deformation is readable,
shadows do not staircase materially, no body part floats, selection remains
usable, and Shot Preview export returns the exact scene ID, revision, dimensions,
hash, and warning list.

## Release Boundary

The next release is v0.8.0 because it changes the visible actor rendering
capability while keeping all structured schemas compatible. Release notes,
README, capability text, Skill guidance, dependency-license audit, and public
snapshot instructions must describe the built-in mannequin and its fallback.

The release does not claim final-character quality, facial performance,
finger or toe articulation, clothing, hair, arbitrary GLB import, user-authored
rigging, animation, physics, or production asset management.
