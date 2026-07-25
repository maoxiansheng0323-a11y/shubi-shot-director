# IntentReport v1 and submission envelopes

Author `IntentReport` only in Host Codex. Keep it generic and ephemeral. Never add source wording, aliases, profile paths or contents, project identifiers, credentials, model settings, or free-form explanation fields.

## Contents

- [Exact v1 report shape](#exact-v1-report-shape)
- [Exact enums](#exact-enums)
- [Exact evidence union](#exact-evidence-union)
- [Policy and coverage](#policy-rules)
- [Patch-operation evidence](#patch-operation-evidence-mapping)
- [Generic scene submission](#generic-scene-submission-pattern)
- [Generic patch submission](#generic-patch-submission-pattern)

## Exact v1 report shape

The object is strict; extra keys fail validation.

| Field | Exact v1 type |
| --- | --- |
| `schemaVersion` | literal `1` |
| `operation` | `"create"` or `"modify"` |
| `allowPartial` | boolean |
| `recognizedConstraints` | up to 128 strict constraint objects with unique `id` values |
| `unsupportedConstraints` | up to 128 strict issue objects |
| `unresolvedRelations` | up to 128 strict issue objects |
| `warnings` | up to 128 strict warning objects |
| `canApplySafely` | boolean |

A constraint is exactly:

```text
{
  id: GenericId,
  kind: IntentConstraintKindV1,
  required: boolean,
  targets: GenericId[],
  evidence: IntentEvidenceV1[]
}
```

`targets` contains at most 32 unique IDs. `evidence` contains at most 64 entries. Generic IDs are 3-64 characters and match `^[a-z][a-z0-9_-]*$`.

An issue or warning is exactly `{ code, targetIds? }`. Optional `targetIds` follows the same generic-ID rules. There is no message, description, prompt, path, alias, or arbitrary metadata field.

## Exact enums

Constraint kinds:

```text
environment
entity-presence
entity-removal
actor-slot
pose
relationship
contact
position
rotation
scale
visibility
camera-height
camera-angle
camera-target
focal-length
framing
output
composition-safety
```

Issue codes:

```text
UNSUPPORTED_CONSTRAINT
UNRESOLVED_RELATION
UNAPPLIED_CONSTRAINT
```

Warning codes:

```text
PARTIAL_APPLICATION
APPROXIMATE_PLACEMENT
```

Warnings are informational. They do not override policy or evidence requirements.

## Exact evidence union

Use only these strict shapes:

```text
{ type: "entity", entityId: GenericId }
{ type: "entity-property", entityId: GenericId, path: EntityEvidencePathV1 }
{ type: "scene-property", path: SceneEvidencePathV1 }
{ type: "scene-constraint", constraintId: GenericId }
{ type: "patch-operation", operationIndex: integer from 0 through 127 }
```

Entity property paths and compatible constraint kinds:

| Path | Compatible kinds |
| --- | --- |
| `entity.kind` | `environment`, `entity-presence`, `entity-removal` |
| `entity.parentId` | `relationship` |
| `entity.transform.positionM` | `position`, `relationship`, `camera-height` |
| `entity.transform.rotation` | `rotation`, `relationship`, `camera-angle`, `camera-target` |
| `entity.transform.scale` | `scale` |
| `entity.visible` | `visibility` |
| `entity.locked` | none in v1 coverage; do not use it as evidence |
| `actor.slot` | `actor-slot` |
| `actor.pose` | `pose`, `relationship` |
| `camera.heightM` | `camera-height` |
| `camera.lens.focalLengthMm` | `focal-length` |
| `camera.lens.sensorWidthMm` | `focal-length` |

Actor-only paths require an actor. Camera-only paths require a camera. Rotation is primary `camera-target` evidence only when the entity is a camera.

Scene property paths and compatible kinds:

| Path | Compatible kinds |
| --- | --- |
| `scene.activeCameraId` | `composition-safety` |
| `scene.output` | `output` |
| `scene.compositionGoals` | `framing`, `composition-safety` |
| `scene.compositionGoals.framing` | `framing`, `composition-safety` |
| `scene.compositionGoals.captionZone` | `composition-safety` |
| `scene.compositionGoals.sideUiZone` | `composition-safety` |
| `scene.compositionGoals.criticalEntityIds` | `composition-safety` |

The referenced optional composition property must exist. `scene.activeCameraId` covers the active camera. Framing and critical-entity evidence covers their declared entity IDs.

`scene-constraint` evidence accepts:

- `ground-contact` for `contact` or `relationship`;
- `keep-visible` for `camera-target` or `composition-safety`.

## Policy rules

Apply policy before coverage:

1. Reject `canApplySafely: false` with `UNSUPPORTED_DESCRIPTION`.
2. Reject an operation mismatch between envelope and report with `INTENT_REPORT_INVALID`.
3. Reject create reports with `allowPartial: true` using `INTENT_REPORT_INVALID`.
4. When `allowPartial` is false, reject any non-empty unsupported or unresolved array with `UNSUPPORTED_DESCRIPTION`.
5. Allow a partial modification only when the user explicitly accepted it. Keep `canApplySafely: true` only for the safe applied subset, declare every unapplied item with an issue code, and keep valid evidence for all applied required constraints.

For create, always use `allowPartial: false`, `canApplySafely: true`, and empty unsupported and unresolved arrays.

## Target validation

- Empty targets are valid only for `output` and `composition-safety`.
- `actor-slot` and `pose` targets must all be actors.
- `camera-height`, `camera-angle`, and `focal-length` targets must all be cameras.
- `camera-target` must include at least one camera.
- `environment` targets must all be environments.
- `entity-removal` is modify-only and every target must be absent after the Patch.
- `relationship` requires at least two targets.
- `contact` accepts one or two targets, exactly one actor, and an optional environment or prop surface.
- `framing` targets must all be actors or props.
- Every other target must resolve to an entity visible to the coverage context.

Create coverage sees the submitted scene. Modify coverage sees the after scene plus the before scene. Entity presence resolves after; entity removal resolves before; other modify evidence prefers after and may use before when the entity no longer exists.

## Required coverage

For every recognized constraint:

1. Validate target kinds.
2. Require at least one evidence entry when `required` is true.
3. Reject any evidence entry that is incompatible, missing, out of range, or attached to the wrong declared target.
4. Require every entity or entity-property evidence ID to appear in `targets`.
5. When evidence reports target IDs, require it to intersect declared targets.
6. For a required constraint, require at least one primary evidence item and coverage of every declared target.

An optional constraint may omit evidence, but any evidence it includes must still be valid. A bare `entity` item is primary only for `environment`, `entity-presence`, or `entity-removal`.

## Patch-operation evidence mapping

The referenced operation index must exist in the submitted Patch. It provides primary evidence only for these compatible kinds:

| Patch operation | Compatible kinds |
| --- | --- |
| `entity.add` | `entity-presence`, `position`, `rotation`, `scale`, `visibility`, `relationship`; plus `environment` for environments, `actor-slot` and `pose` for actors, and `camera-height`, `camera-angle`, `camera-target`, `focal-length` for cameras |
| `entity.remove` | `entity-removal` when the entity existed before |
| `entity.transform.set` | `position`, `rotation`, `scale`, `relationship`; plus `camera-height`, `camera-angle`, `camera-target` for cameras |
| `entity.transform.translate` | `position`, `relationship`; plus `camera-height` for cameras |
| `entity.transform.rotate` | `rotation`, `relationship`; plus `camera-angle`, `camera-target` for cameras |
| `entity.flags.set` | `visibility` |
| `entity.preset.parameters.set` | `environment` for an environment |
| `actor.pose.set` | `pose`, `relationship` for an actor |
| `camera.lens.set` | `focal-length` for a camera |
| `camera.look-at` | `camera-angle`, `camera-target` for a camera; an entity-anchor target also covers the subject entity |
| `constraint.set` or compatible `constraint.remove` | `contact` or `relationship` for ground contact; `camera-target` or `composition-safety` for keep-visible |
| `scene.active-camera.set` | `composition-safety` for a valid camera |
| `scene.output.set` | `output` |
| `scene.composition-goals.set` | `framing`, `composition-safety` |
| `scene.title.set` | no IntentReport kind in v1 |

## Generic scene-submission pattern

This is a complete generic envelope shape. Replace values only with schema-valid generic data derived in the host.

```json
{
  "intentReport": {
    "schemaVersion": 1,
    "operation": "create",
    "allowPartial": false,
    "recognizedConstraints": [
      {
        "id": "intent_output_1",
        "kind": "output",
        "required": true,
        "targets": [],
        "evidence": [
          {
            "type": "scene-property",
            "path": "scene.output"
          }
        ]
      }
    ],
    "unsupportedConstraints": [],
    "unresolvedRelations": [],
    "warnings": [],
    "canApplySafely": true
  },
  "scene": {
    "schemaVersion": 1,
    "sceneId": "scene_generic_1",
    "revision": 0,
    "title": "Generic camera study",
    "coordinateSystem": {
      "handedness": "right",
      "upAxis": "+Y",
      "cameraForwardAxis": "-Z",
      "lengthUnit": "meter"
    },
    "activeCameraId": "camera_generic_1",
    "output": {
      "aspect": { "width": 16, "height": 9 },
      "resolutionPx": { "width": 1920, "height": 1080 }
    },
    "entities": [
      {
        "id": "environment_generic_1",
        "label": "Generic graybox room",
        "parentId": null,
        "kind": "environment",
        "transform": {
          "positionM": [0, 0, 0],
          "rotation": [0, 0, 0, 1],
          "scale": [1, 1, 1]
        },
        "visible": true,
        "locked": true,
        "preset": {
          "registry": "builtin",
          "id": "room.small-v1",
          "version": 1,
          "parameters": {
            "widthM": 5,
            "depthM": 4,
            "heightM": 2.8,
            "wallThicknessM": 0.08
          }
        },
        "color": "#7d8794"
      },
      {
        "id": "camera_generic_1",
        "label": "Generic shot camera",
        "parentId": null,
        "kind": "camera",
        "transform": {
          "positionM": [0, 1.6, 4],
          "rotation": [0, 0, 0, 1],
          "scale": [1, 1, 1]
        },
        "visible": true,
        "locked": false,
        "lens": {
          "projection": "perspective",
          "focalLengthMm": 45,
          "sensorWidthMm": 36,
          "nearM": 0.05,
          "farM": 200
        }
      }
    ],
    "constraints": []
  }
}
```

## Generic patch-submission pattern

Take `sceneId` and `baseRevision` from the immediately preceding snapshot.

```json
{
  "intentReport": {
    "schemaVersion": 1,
    "operation": "modify",
    "allowPartial": false,
    "recognizedConstraints": [
      {
        "id": "intent_focal_length_1",
        "kind": "focal-length",
        "required": true,
        "targets": ["camera_generic_1"],
        "evidence": [
          {
            "type": "patch-operation",
            "operationIndex": 0
          }
        ]
      }
    ],
    "unsupportedConstraints": [],
    "unresolvedRelations": [],
    "warnings": [],
    "canApplySafely": true
  },
  "patch": {
    "schemaVersion": 1,
    "patchId": "patch_generic_1",
    "sceneId": "scene_generic_1",
    "baseRevision": 3,
    "source": "natural-language",
    "operations": [
      {
        "op": "camera.lens.set",
        "entityId": "camera_generic_1",
        "value": {
          "projection": "perspective",
          "focalLengthMm": 55,
          "sensorWidthMm": 36,
          "nearM": 0.05,
          "farM": 200
        }
      }
    ]
  }
}
```
