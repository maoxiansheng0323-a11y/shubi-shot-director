# Skinned White Mannequin Design

## Goal

Upgrade Shubi Shot Director's visible actor from low-detail revolved primitives
to a refined, Unity-quality white mannequin while preserving the existing
generic graybox scope, SceneSpec v6 compatibility, deterministic fifteen-joint
pose contract, stature editing, limb presence, contact, composition, save/load,
and browser-authored PNG export.

## Approved Direction

The user approved the most conservative implementation after a live source and
license review. The release will ship one audited CC0 mannequin family as a
built-in renderer asset. It will not add arbitrary mesh paths, asset upload,
project profiles, character identities, clothing, textures, facial systems, or
animation authoring.

The initial source candidates are:

- Blender Studio Human Base Meshes v1.4.1, published as a 49 MB CC0 asset
  bundle on the official Blender demo-files page.
- MPFB/MakeHuman bundled assets and generated output, whose official license
  declares the base mesh, rigs, poses, expressions, and exported graphical data
  CC0. MPFB is an offline authoring option, not a runtime dependency.

Only an optimized, source-attributed derivative that passes the repository
license audit may become a committed runtime asset.

## Architecture

### Persistent authority remains unchanged

SceneSpec stays at schema version 6 and remains the sole persistent scene
authority. No scene stores an asset path, mesh payload, bone name, source URL,
or renderer option. Legacy and Blueprint actors continue to resolve through
`resolveActorProjection`.

The resolved actor projection gains a renderer-owned mannequin descriptor that
is derived from the same dimensions, effective limb presence, joint frames,
and actor transform as the existing analytical primitives. The descriptor
contains only stable built-in asset IDs, canonical body-part visibility, and
canonical bone transforms. It never contains a filesystem path.

### Visual and analytical projections share one source

The existing primitives remain the authoritative analytical representation for
contact, composition, selection bounds, software diagnostics, and compatibility
exports. The browser renderer may draw a skinned mannequin only when the
built-in asset is available and the actor state is supported. Both outputs are
computed from the same resolved projection; no consumer reinterprets SceneSpec
or Blueprint data independently.

When the mannequin cannot represent an actor state safely, the renderer uses
the current humanoid primitives. This includes asset-load failure and any
unsupported limb configuration. The fallback is deterministic and visible,
not a silent partial mesh.

### Canonical rig mapping

The shipped GLB uses a stable, minimal deformation skeleton mapped to the
fifteen canonical joints:

`pelvis`, `spine`, `neck`, left/right `upper_arm`, `forearm`, `hand`,
`upper_leg`, `lower_leg`, and `foot`.

Offline helper or twist bones may improve deformation, but they are not public
pose controls. Their transforms are derived deterministically from their parent
canonical joints. Runtime code rejects a loaded asset whose required nodes,
skin, material, or neutral bounds do not match the committed manifest.

### Limb presence

The high-quality mannequin is partitioned into canonical render sections.
Each section is associated with one of the twelve limb-presence keys, while
torso, pelvis, neck, head, and orientation marker remain core sections.
Effective presence continues to resolve through the existing base, variant,
and instance-override hierarchy. If a source mesh cannot provide clean section
boundaries and caps, that state uses the analytical fallback rather than
showing torn or floating geometry.

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
3. Use a reproducible Blender script or equivalent deterministic conversion to
   select the source mesh, normalize meters and orientation, bind or remap the
   canonical rig, partition supported limb sections, apply transforms, remove
   unused data, and export GLB 2.0.
4. Optimize with glTF Transform when it changes neither skeleton identity nor
   visual bounds. Prefer Meshopt only when the current runtime loads it without
   an additional remote decoder.
5. Validate the final GLB structure, node names, skin, section names, material
   count, triangle count, bounds, byte size, SHA-256, and absence of embedded
   private metadata.
6. Commit only the optimized runtime GLB, its small manifest, license/provenance
   record, and the reproducible conversion script. Do not commit the source
   archive, DCC cache, or downloaded toolchain.

## Runtime Behavior

- All-present legacy and Blueprint actors render the refined mannequin when the
  asset and manifest validate.
- Height continues to resolve from `body.heightM` or Blueprint
  `heightScale`; entity transform scale is not repurposed.
- The existing `build` and resolved shoulder/pelvis dimensions influence the
  mannequin through bounded renderer deformation or the closest audited mesh
  variant. Slot names and labels never infer body type.
- Canonical joint patches update the mannequin in the same committed revision
  as the analytical projection.
- Missing or invalid assets fail closed to the current primitive mannequin and
  produce one generic browser diagnostic without blocking scene editing.
- PNG export continues to require the connected browser Shot Preview and
  captures exactly the visible renderer result.

## Testing

### Automated

- Manifest parsing rejects missing assets, hash mismatches, missing bones,
  unexpected remote URLs, and unsupported material counts.
- Rig mapping covers all fifteen canonical joints and deterministic helper-bone
  transforms.
- Height, Blueprint scaling, neutral pose, wrist/ankle corrections, complete
  action poses, and actor transforms do not mutate SceneSpec or snapshot hashes.
- Limb section mapping is complete where supported; unsupported states select
  the analytical fallback.
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
fingers, clothing, hair, arbitrary GLB import, user-authored rigging, animation,
physics, or production asset management.
