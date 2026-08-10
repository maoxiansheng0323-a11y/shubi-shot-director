# Semantic still-shot solving

Use this route for supported still shots when the request describes visual relationships, actor support/contact, and composition in human camera language. Host Codex authors a strict transient `ShotIntentPlan`; the runtime deterministically materializes scene relationships, delegates actor pose/contact goals to StaticBlocking, searches camera parameters, ranks diverse candidates, and waits for browser render-space verification. Only an explicitly accepted verified candidate enters `SceneSession` as ordinary `SceneSpec`.

The runtime remains structured-only and model-free. Never put source wording, prompts, aliases, external profiles, project data, providers, credentials, or arbitrary metadata in a shot plan.

## Generated structural contracts

Read these generated files before authoring:

- `generated/shot-intent-plan.schema.json`
- `generated/shot-intent-patch.schema.json`
- `generated/shot-solve-submission.schema.json`
- `generated/render-space-evidence.schema.json` for diagnostics only; Host Codex never authors browser evidence

`ShotIntentPlan` schema version 1 separates:

- `hardConstraints`: requirements that reject a candidate when unsatisfied;
- `softPreferences`: weighted tendencies used only for deterministic ranking.

Supported hard goal families are spatial relationship, facing, surface placement, inside-region containment, actor blocking, required visibility/body parts, framing, caption/side-UI safe area, foreground/background depth ordering, and camera clearance. Supported soft families are camera height, view angle, screen placement, lens tendency, headroom, look room, environment context, and face readability.

Use broad semantic ranges and tendencies. Do not author the final actor translation, bespoke joint quaternions, final camera position, focal length, or camera quaternion for a solver-supported result. The base SceneSpec still declares generic entity geometry and identity, and it remains schema-valid, but the solver owns the supported final blocking and camera solution.

## Initial solve

1. Author a complete generic base SceneSpec with the requested entities, environment or connected layout, one declared camera ID, output, and canonical actor data. Placeholder transforms must be schema-valid; do not treat them as the requested final solution.
2. Author a v6 create `IntentReport`. Every hard constraint ID in the plan must appear in `recognizedConstraints` with compatible final-SceneSpec evidence. Keep `allowPartial: false`, empty unsupported/unresolved arrays, and `canApplySafely: true`.
3. Author the strict plan with `operation: "create"`, explicit `cameraId`, one to eight `primaryTargetIds`, one to 128 hard constraints, zero to 64 soft preferences, and `candidateCount` from one to five (normally three).
4. Write `{ "intentReport": ..., "scene": ..., "plan": ... }` to an ignored transient file and run:

   ```text
   node scripts/director.mjs shot solve --file <shot-solve-submission.json>
   ```

5. Keep the loopback UI open. The candidate strip renders every candidate through a real Three.js Shot Preview and submits an entity/actor-part ID-mask verification pass. Run `shot candidates` until at least one candidate reports `renderStatus: "pass"`.
6. Let the user compare the visible candidates. Accept only a verified candidate:

   ```text
   node scripts/director.mjs shot accept --candidate <candidate-id>
   ```

7. Acceptance is one authoritative replace revision. Candidate state is transient and is cleared after acceptance. Run `snapshot`, `pose inspect --json`, `composition inspect --json`, and the final export checks.

## High-level revision

Before acceptance, author one minimal `ShotIntentPatch` against the exact `solveId` and `baseGeneration`. Use only:

- `hard-constraint.set`
- `hard-constraint.remove`
- `soft-preference.set`
- `soft-preference.remove`

Then run:

```text
node scripts/director.mjs shot revise --file <shot-intent-patch.json>
```

The runtime invalidates prior render evidence, re-solves the affected semantic plan deterministically, and returns a new generation. A stale generation or changed authoritative SceneSession fails closed. Do not preserve an old candidate by copying its numeric camera or actor transforms into the patch.

After acceptance, a new high-level correction starts from a fresh authoritative snapshot and a new solve submission with `operation: "modify"`. Ordinary ScenePatch and direct editor controls remain available as manual refinement, recovery, or expert override.

## Candidate pipeline and failure rules

Every candidate passes:

```text
strict semantic validation
-> deterministic relationship solve
-> StaticBlocking materialization
-> pose/contact diagnostics
-> bounded camera search
-> composition/topology/collision diagnostics
-> browser ID-mask render evidence
-> final score
```

Contradictory relationships fail with `SHOT_CONSTRAINT_CONTRADICTION`. Unavailable targets/regions, unsupported surface placement, or unsolvable containment fail explicitly. `SHOT_CAMERA_NO_VALID_CANDIDATE` means every bounded camera sample violated a hard constraint. Candidate acceptance also fails on missing render evidence, failed render evidence, a stale generation, or a changed SceneSession.

Render-space verification derives actual visible pixel counts, isolated silhouette counts, visible ratios, screen-space bounds, clipping, required actor-part visibility, safe-area overlap, and entity depth from the browser scene. It is deterministic renderer evidence, not model screenshot interpretation.

## Supported boundary

This solver is bounded still-shot previs. It is not animation, physics, navigation, ragdoll, a generic IK framework, a DCC, a game engine, a final image generator, or an arbitrary mesh system. When a required meaning is outside the generated schemas, report the generic unsupported capability instead of authoring guessed low-level values.
