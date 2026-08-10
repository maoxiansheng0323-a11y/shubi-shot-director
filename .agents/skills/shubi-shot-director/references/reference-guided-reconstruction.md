# Reference-guided reconstruction

Use this workflow only when the user explicitly supplies one or a few visual
references and asks for an editable graybox reconstruction. The references are
evidence for Host Codex, not runtime input and not persistent scene data.

## Keep the boundary

Host Codex inspects the references, resolves ambiguity, and authors the
structured `IntentReport` and `SceneSpec` or `ScenePatch`. The Director remains
model-free and receives only generic structured data.

Do not put source wording, image content, image paths, project names, aliases,
profile data, or private metadata in an envelope, saved scene, export, log,
fixture, or repository file. Do not pass a reference image to the runtime.

Use generic IDs and labels for every persisted item. Keep a private working
note in Host context only; do not save it beside the scene.

## Compile observations first

Before authoring a scene, make a short Host-only evidence table. Separate each
item into `certain`, `inferred`, or `unresolved`.

1. Shared spatial facts: region count and rough footprints; floor and ceiling
   relationship; structural walls; doors, windows, openings, corridors, and
   visible connected regions.
2. Scale anchors: familiar cues such as a person, door, bed, desk, counter, or
   cabinet. Record ranges, not false exact dimensions.
3. Occupied volumes: the major furniture blocks, their wall adjacency, and the
   access or circulation space they imply.
4. Functional clusters: work surface and seat; sleeping or living zone;
   entrance drop zone; storage or service cluster; secondary clutter masses.
5. Contradictions: when images cannot represent one literal space, select and
   record a reconstruction hypothesis or keep separate scene states. Do not
   turn a perspective cheat into certain geometry.

The observations are semantic inputs for Host Codex only. They are not a
second scene format and must not be submitted to the Director.

## Author the smallest editable scene

Start with the existing v6 authoring model:

- use `spatialLayout` regions, boundaries, openings, connections, and
  memberships for topology;
- use ordinary `box`, `cylinder`, `plane`, and `capsule` props for occupied
  volumes;
- assemble readable furniture from a few independent low-detail parts, such as
  a bed base, mattress, and headboard, or a desk top, storage support, and
  chair;
- represent compositionally meaningful small objects as generic occupied
  masses rather than omitting the density;
- use world-space transforms and give every visible prop and camera the needed
  region membership.

For the current v6 scene model, use `parentId: null` for reconstruction props.
Do not use parent IDs as an assembly-transform mechanism: renderer, bounds,
composition, and editor projections currently consume the child transform in
world space. Independent primitive parts remain editable and sufficient for a
small room reconstruction.

Do not add a prefab system, mesh import, DCC architecture, automatic camera
selection, image understanding in the runtime, or a new persistent capability
until an actual reconstruction cannot be represented cleanly. When such a
blocker is demonstrated, report the smallest generic missing capability with
the failed evidence before changing the schema or runtime.

## Submit and revise

For a new reconstruction, author a complete v6 create envelope with
`allowPartial: false`. Its `IntentReport` must cover topology, the major
occupied volumes, and each functional cluster using generic evidence. Do not
copy hidden measurements from a public fixture; derive the structured scene
from the Host-only observations.

For a revision, snapshot first and author one smallest Patch against its exact
`sceneId` and `baseRevision`. Preserve workflow locks with `preserveLock: true`.
Use only allowlisted domain operations. A change to one functional cluster is
not permission to rewrite unrelated furniture or camera state.

## Review and export

Inspect the connected Overview first. Check floor footprints, wall continuity,
opening cuts, region connections, and the amount of occupied space. Inspect
the affected Local preview next so memberships, neighboring regions, and major
furniture/opening relationships are readable. Finally inspect the real Shot
Preview at the active manual camera.

Run `pose inspect --json` when actors are present, then run `composition
inspect --json`. Composition checks are conservative proxies; they do not
prove furniture usability or lived-in density. Review those properties in the
browser.

The user, not an automatic candidate system, selects the useful downstream
16:9 viewpoint. A manual browser camera adjustment is a normal revision. Once
the current preview is synchronized, export it through the browser-backed path:

```text
node scripts/director.mjs export png --file <output.png> --width 1920 --height 1080
```

Verify the returned scene ID, revision, PNG dimensions, SHA-256, and warnings.
Never substitute a software image or stale preview for this export.

## Acceptance checklist

For a public generic acceptance, use a generic small lived-in interior with an
entrance or opening relationship, a sleeping or living zone, a work surface
with seat and storage, a major storage or appliance volume, and at least two
secondary density clusters. The public fixture
`examples/reference-guided-reconstruction.scene-submission.json` is a generic
structured output example, not a hidden reference to copy.

For private local validation, keep the references and all visual captures
outside tracked repository files. Confirm that an ordinary viewer can recognize
the layout, that furniture remains functional and editable, that the scene no
longer reads as an empty showroom, and that a user can select a useful 16:9
view without rebuilding the room. Share private review images only in the
authorized review conversation.
