# Public Release Readiness Design

## Goal

Prepare Shubi Shot Director so an unfamiliar developer can inspect, install,
run, validate, and export a generic graybox shot without receiving private
project data or relying on undocumented machine state. Do not publish a
repository, push a remote, or publish a package.

## Chosen approach

Use the current working architecture and harden the checked-out source tree as
the canonical public snapshot. Keep `package.json` private to prevent
accidental registry publication, add deterministic public-release checks, and
document how to create a new public repository from the verified snapshot when
the user later approves publication.

Two alternatives were rejected:

- Rewriting the existing Git history would remove old machine-specific paths,
  but it would destroy stable internal checkpoints and requires explicit
  destructive-history approval.
- Creating and pushing a new public repository now would violate the requested
  no-publication boundary.

The release procedure therefore must publish a clean snapshot or orphan-rooted
public branch, not the existing internal commit history.

## Scope

### Keep

- Host Codex as the only semantic authority for natural language and external
  project aliases.
- Capability contract v2 and the structured-only runtime boundary.
- `SceneSpec` as the only persistent scene state.
- Atomic `ScenePatch`, revision history, persistence, composition inspection,
  browser editing, and PNG export.
- The browser Shot Preview as the source of the exported perspective image.

### Add or improve

- Public-first README sections for prerequisites, installation, architecture,
  quick start, structured examples, export, verification, privacy, and known
  limits.
- A complete generic scene-submission example that passes the public schemas.
- A deterministic public-release audit covering tracked and untracked source
  candidates, secret shapes, machine paths, private project tokens, unsafe
  tracked artifacts, package metadata, and dependency-license allowlisting.
- Package scripts that let a new developer run the audit and verification
  gates without private tools or credentials.
- Ignore rules for local scenes, exports, runtime state, logs, and reports while
  retaining committed generic examples.

### Exclude

- Model clients, API keys, prompt parsing, provider configuration, or outbound
  model requests.
- Final image generation, production assets, animation, VN integration, or
  project-specific character data.
- CI hosting, package publication, public repository creation, or remote push.
- Broad UI redesign or architecture refactoring unrelated to publication.

## Components and data flow

1. Host Codex authors generic `IntentReport` plus `SceneSpec` or `ScenePatch`.
2. The Skill wrapper submits the structured envelope to the loopback runtime.
3. `SceneSession` validates and mutates one authoritative revision.
4. The browser projects that state into the editor and final Shot Preview.
5. CLI PNG export requests the connected Shot Preview renderer, verifies the
   exact `sceneId` and revision, then writes the returned PNG atomically.
6. Public audit and verification scripts inspect only generic repository data
   and never require a credential, external profile, or non-loopback service.

## Error handling

- Missing browser preview: fail with a stable instruction to open Shot Preview.
- Revision change during export: reject rather than export a stale frame.
- Invalid resolution, PNG, structured envelope, or schema: fail before writing
  an output or mutating session state.
- Existing output file: refuse overwrite unless `--force` is explicit.
- Unsupported language meaning: Host Codex reports the generic unsupported
  capability; the runtime never guesses.
- Public audit finding: return a non-zero exit code with a generic rule and
  repository-relative file path, never file contents or secret values.

## Verification design

- Unit and integration tests cover the preview-export broker, browser client,
  loopback API, structured runtime, privacy boundary, and atomic revision flow.
- A clean-install check uses the lockfile and no credentials.
- The minimal scene-submission example is schema-validated and submitted to a
  fresh runtime.
- A real browser opens the loopback page, confirms the rendered UI and Shot
  Preview, and services a CLI PNG export.
- The exported file is checked for PNG signature, dimensions, non-empty image
  data, returned revision metadata, and SHA-256.
- Final gates are schema generation, typecheck, tests, lint, build, Skill quick
  validation, public audit, and `git diff --check`.

## Completion boundary

Stop when the verified source snapshot is understandable and runnable by an
unfamiliar developer. Do not add speculative CI, packaging, extensibility, or
general-engine features.
