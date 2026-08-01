# Humanoid Actor Silhouette Design

## Goal

Upgrade the shared graybox actor projection from rod-and-block geometry to a
recognizably human articulated mannequin while preserving the existing stature,
joint pose, limb-presence, contact, Blueprint, persistence, and patch contracts.

## Scope

- Give every actor a shaped head, visible neck, shoulder-to-waist chest taper,
  pelvis shell, tapered arms, shaped thighs and calves, compact hands, and
  forward-readable feet.
- Keep the result generic, low-detail, and useful for blocking. It is not a
  final character mesh, anatomy sculpt, clothing system, or gender classifier.
- Let existing body dimensions and Blueprint proportions continue to create
  naturally broader, slimmer, wider-shouldered, or wider-pelvis silhouettes.
- Do not infer body type from an actor slot, label, alias, or project profile.
- Do not copy the external reference images into the repository, fixtures,
  screenshots, logs, or saved scenes.

## Architecture

`resolveActorProjection` remains the one shared geometry outlet for legacy and
Blueprint actors. Two internal, non-persistent primitive kinds are added:

- `profile`: a low-segment surface of revolution with a Y/radius outline and a
  separate depth scale. It expresses chest, pelvis, neck, arms, thighs, calves,
  and the head without changing rig frames or joint endpoints.
- `ellipsoid`: a scaled sphere used for the face marker and hand/foot masses
  where a full profile would add complexity without improving blocking
  readability.

These primitive kinds exist only in the resolved projection. SceneSpec,
ScenePatch, IntentReport, external Actor Blueprint snapshots, and their schema
versions remain unchanged.

## Shape Language

- Head: taller than wide, rounded cranium, narrower jaw, and a restrained front
  orientation marker instead of the current large face sphere.
- Neck: a distinct tapered connector between the torso and head, visually
  subordinate to both and wide enough to avoid a floating-head impression.
- Torso: narrow waist, fuller ribcage, shoulder expansion near the upper third,
  and reduced front-to-back depth relative to width.
- Pelvis: rounded shell with a narrower waist opening and broader hip band;
  enough overlap with torso and hip joints to stay continuous during poses.
- Upper arm and forearm: shoulder/biceps fullness, elbow narrowing, forearm
  fullness, then a clear wrist taper.
- Thigh and calf: broad hip root, knee taper, calf belly, and ankle taper. Joint
  spheres remain visible enough to explain articulation without dominating the
  silhouette.
- Hands and feet: compact ellipsoid masses aligned to the existing wrist and
  ankle frames. Finger and toe articulation remains outside this version.

## Rig and Compatibility Rules

- Preserve all existing rig frames, joint IDs, bone lengths, anchors, mounts,
  limb hierarchy, actor height calculations, and Blueprint snapshot hashes.
- Preserve existing top-level primitive IDs; add only the generic `neck` ID.
- Limb absence removes the matching shaped limb exactly as it removes the
  current capsule. No hidden or zero-scale geometry is introduced.
- Height scaling remains linear. Blueprint instance scaling applies after the
  immutable snapshot proportions are resolved.
- Contact and composition continue to consume `actorVisibleRigBounds`; no
  consumer may reinterpret the new geometry independently.

## Bounds and Export

Visible bounds derive support points from each profile ring or ellipsoid under
the primitive frame plus the actor transform. This keeps floor contact,
framing, collision proxies, and composition checks aligned with the browser
mesh, including rotated joints and non-uniform actor scale.

The diagnostic software PNG renderer draws profile rings and longitudinal
edges, and ellipsoid principal axes. Browser-rendered Shot Preview remains the
only final reference export path.

## Testing and Acceptance

- Projection tests verify human-shaped radius changes, neck presence, tapered
  limbs, retained primitive IDs, linear height scaling, and unchanged Blueprint
  snapshot identity.
- Bounds/contact tests cover rotated profile limbs, missing leg chains, and
  feet/ankles as the support minimum.
- Renderer and software-export tests verify both new primitive kinds are
  consumed instead of silently skipped.
- Real-browser acceptance checks front, three-quarter, and bent-limb views for
  both legacy and Blueprint actors, plus height, missing-limb, pose, undo/redo,
  save/reload, and PNG export regressions.

## Non-goals

- Facial features, fingers, toes, muscles, skin, clothing, hair, IK, skinning,
  deformable meshes, or final-art generation.
- A persistent male/female field. A future explicit silhouette contract may be
  designed if users need direct body-type selection after this shared humanoid
  baseline is tested.
