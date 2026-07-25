# Shubi Shot Director repository rules

## Mission

Build Shubi Shot Director: a Codex Skill-driven graybox camera previs tool that converts natural-language shot descriptions into editable 3D scenes and exports perspective reference images.

## Product boundary

This repository ends at graybox previs export.

Do not implement final image generation, art-prompt pipelines, production asset management, visual-novel integration, animation authoring, physics gameplay, or project-specific character systems.

## Open-source cleanliness

- Never introduce private project names, proprietary character data, unpublished artwork, credentials, or machine-specific absolute paths.
- Keep all built-in examples generic.
- Load project-specific aliases only from an explicitly supplied external `project-profile.json`.
- Never copy external profile content into this repository, saved scenes, logs, screenshots, or fixtures.

## Architecture

- `SceneSpec` is the only persistent scene state.
- Host Codex is the sole semantic authority for user language, explicitly supplied external profile aliases, ambiguity decisions, `IntentReport`, complete `SceneSpec`, and incremental `ScenePatch` authoring.
- Use “host semantic compile” for that reasoning step. Use “runtime structured compile” only for deterministic parsing, normalization, intent coverage, constraints, and session mutation; the runtime must never infer language meaning.
- Initial natural-language requests may cause Host Codex to author a complete `SceneSpec` plus create `IntentReport` and submit their structured envelope.
- Every later natural-language edit must cause Host Codex to author one minimal, schema-validated `ScenePatch` plus modify `IntentReport` against the exact current `sceneId` and `baseRevision`.
- The runtime, bridge, and scripts must not accept prompts, raw wording, profiles, aliases, credentials, tokens, models, providers, model endpoints, or non-loopback network routes.
- Host account or KEY mode is outside the Director contract. Never inspect or pass host credentials into Director arguments, files, processes, logs, or artifacts.
- The local `SceneSession` is authoritative. React and Three.js objects are projections of its current revision.
- Editor camera, selection, hover state, panel layout, and live drag drafts are UI state and must not be saved in `SceneSpec`.
- Keep deterministic transforms, constraints, persistence, and export outside model reasoning.
- Do not expose arbitrary JSON-path mutation. Public patches must use the domain operation allowlist.
- Preserve saved-scene compatibility through explicit schema versions and migrations.
- Preserve direct `scene create --file` and `patch apply --file` only for callers that already possess structured data; natural-language work uses host-authored `scene submit --file` and `patch submit --file` envelopes.

## Development behavior

- Work autonomously through ordinary implementation problems.
- Keep the application runnable after each stable checkpoint.
- Run type checking, tests, builds, and real-browser interaction checks in proportion to each change.
- Commit stable milestones to Git.
- Record unresolved issues without blocking unrelated progress.
- Do not switch the primary stack without demonstrated necessity.
- Do not expand this project into a general-purpose 3D engine.

## UX standard

The application is for directors, storyboard artists, and non-specialist creators.

Prefer presets, snapping, semantic controls, clear labels, and natural-language edits over raw 3D-software conventions. A user should reach a useful shot without learning a professional DCC tool.

## Safety

- Bind the local bridge to loopback only.
- Do not expose API keys in browser code, logs, fixtures, screenshots, or commits.
- Do not modify files outside this repository unless the user explicitly supplies an external input path for read-only loading or an output path for an intentional export.
- Do not delete or overwrite user scene files without explicit confirmation.
