# Intent routing

Perform one semantic `compile` in Host Codex. Do not route language into the Director runtime.

## Create route

1. Interpret the complete request in the host.
2. Resolve only an explicitly supplied external profile in host memory.
3. Identify every required constraint, unsupported capability, and unresolved relation.
4. Author one generic `IntentReport` with `operation: "create"`, `allowPartial: false`, and `canApplySafely: true`.
5. Require empty `unsupportedConstraints` and `unresolvedRelations` arrays.
6. Author one complete generic `SceneSpec` and submit the combined envelope with `scene submit --file`.

Never create a partial scene. If any required meaning is ambiguous or unavailable in the public schema, ask the user only when a decision is necessary; otherwise report a generic unsupported capability and do not submit.

## Modify route

1. Fetch an authoritative snapshot immediately before host interpretation.
2. Interpret the complete follow-up against that snapshot.
3. Author one minimal `ScenePatch` with the same `sceneId` and exact `baseRevision`.
4. Author a matching modify `IntentReport` and submit both with `patch submit --file`.
5. Fetch another snapshot and require the same `sceneId`, exact revision `+1`, and only requested changes.

Default to `allowPartial: false`. Set it to `true` only after the user explicitly accepts a partial modification. List every unapplied item in a structured issue array, keep `canApplySafely: true` only for a safe applied subset, and give every applied required constraint valid generic evidence.

## No semantic fallback

- Do not invoke a local prompt parser or alias resolver.
- Do not simplify or paraphrase the user's language into preset vocabulary for another attempt.
- Do not reconstruct an existing shot with a full SceneSpec to avoid Patch authoring.
- Do not omit an unsupported or unresolved requirement while partial application is disabled.
- Do not put source wording, aliases, paths, or project identifiers in any submission field.

If a structured document fails schema validation, correct the document. If the public schemas cannot represent the meaning, stop with the generic capability diagnosis.
