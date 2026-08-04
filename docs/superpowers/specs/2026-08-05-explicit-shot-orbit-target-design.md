# Explicit Shot Orbit Target Design

**Status:** Approved in conversation on 2026-08-05.

**Scope:** Make right-drag in Shot Preview rotate the active camera freely by
default, and preserve target-orbit behavior only when the user explicitly
chooses a visible actor or prop as the orbit target.

## Goal

A director must be able to turn the final camera toward any part of a scene
without the camera being pulled back toward an automatically inferred subject.
Target orbit remains available for deliberate inspection or composition, but
it is opt-in and visibly controlled.

The approved behavior is:

- right-drag defaults to free camera rotation in place;
- free rotation changes camera direction without changing position or lens;
- Shot Preview exposes a compact target-lock selector;
- only an explicitly selected visible actor or prop enables target orbit;
- target orbit keeps the selected target in view and preserves orbit radius;
- left-drag pan, wheel focal length, keyboard movement, and movement-pad
  behavior remain unchanged.

## Root Cause

The current controller derives an orbit target as soon as Shot Preview becomes
eligible. Its priority order reads enabled `keep-visible` constraints,
composition framing targets, visible scene bounds, and finally the current
camera-forward ray. Every right-drag then passes that derived point to the
orbit calculation, which moves the camera around the point and continuously
looks back at it.

This is deterministic, but it is not neutral camera rotation. A constraint or
framing target elsewhere in the image can control every later right-drag even
when the director is trying to turn toward the background or an empty part of
the environment.

## Product Boundary

This change includes:

- free-look right-drag as the default Shot Preview rotation mode;
- an explicit target-lock selector for visible actors and props;
- deterministic visual-center resolution for the chosen target;
- transient target-lock lifecycle rules;
- pure navigation tests, UI contract tests, documentation updates, and real
  browser verification.

This change does not include:

- click-to-pick or raycast target selection in the rendered image;
- environment, region, opening, camera, or hidden-entity targets;
- multiple simultaneous targets or weighted composition targets;
- roll controls, six-degree-of-freedom camera rigs, animation, or keyframes;
- automatic subject tracking;
- saving target-lock state in `SceneSpec` or adding a schema version;
- new ScenePatch operations or runtime language inference.

## Interaction Model

### Default free rotation

Right-drag begins in free mode whenever the selector is set to
`Off (free rotation)`. Horizontal pointer motion changes yaw around world Y.
Vertical pointer motion changes pitch while preserving a stable no-roll camera
orientation. Pitch is clamped just before the two vertical poles so direction
remains controllable and the camera cannot flip.

The camera position, transform scale, and focal length remain unchanged. One
completed drag still produces one existing `entity.transform.set` Patch, one
revision, and one undo step. A no-op drag produces no Patch.

Free rotation must not read or respond to `keep-visible` constraints,
composition framing targets, scene bounds, selected editor entities, or entity
proximity.

### Explicit target lock

Shot Preview adds a compact labeled select control beside the existing movement
pad and focal-length readout. Its first option is `Off (free rotation)`.
Following options list current visible actors and props in stable scene-entity
order, using their existing human-readable label with a generic kind fallback.

Choosing an actor or prop opts into target orbit. Right-drag then reuses the
existing fixed-radius orbit behavior and continuously looks at that entity's
resolved visual center:

- actors use the center of their current resolved visible rig bounds;
- props use the center of their transformed geometry bounds.

No inferred constraint, framing target, or scene-wide bounds may replace the
explicit choice. If the chosen target cannot resolve to a finite center, the
selector falls back to free mode before another gesture can begin.

Changing the selector during an active draft is disabled. The new choice
applies to the next gesture only; it never retargets an in-progress drag.

### Existing controls

Left-drag continues to translate along the camera's image-plane right and up
axes while preserving rotation. Its movement sensitivity still needs a
positive depth reference. The controller may derive that reference from the
explicit target when locked or from a camera-forward scene-depth helper while
free, but the reference is used only as a distance scalar. It must never
change camera rotation or turn pan into target tracking.

Wheel focal-length control, arrow/Page movement, modifier precision, the
six-button movement pad, workflow-lock preservation, user-lock blocking,
pointer capture, draft cancellation, undo/redo, and export blocking remain
under their existing contracts.

## Target-Lock State

Target-lock choice is editor UI state, not persistent scene state. The
controller stores only an entity ID or `null`.

The choice:

- defaults to `null` when Shot Preview first becomes eligible;
- survives the controller's own accepted camera revisions;
- survives unrelated revisions while the same scene, active camera, and target
  remain valid;
- resets to `null` when the scene ID or active camera changes;
- resets to `null` when the target is removed, hidden, or changes to an
  unsupported entity kind;
- is never serialized, submitted, logged, exported, or copied into history.

An authoritative external revision still cancels any active camera draft under
the existing concurrency rules. Retaining a still-valid target choice after
that cancellation does not authorize retrying the old draft.

## Navigation Math

The pure editor navigation module gains a free-rotation function that accepts a
camera and total pointer delta and returns a new `TransformSpec`.

The function derives yaw and pitch from the original camera forward vector,
applies the existing radians-per-pixel sensitivity, clamps pitch to the
existing safe pole limit, and reconstructs a normalized look quaternion with
world Y as the stable up reference. Because every draft is recomputed from the
gesture's original camera plus total pointer displacement, event frequency
cannot change the result.

Target orbit remains a separate pure function. The controller chooses exactly
one of the two functions at pointer-move time based on the target ID captured
at pointer-down. This keeps free rotation and orbit semantics independent and
testable.

Automatic target derivation is removed from right-drag. Any retained helper for
pan sensitivity must have a distance-oriented name and return contract so it
cannot be mistaken for an implicit orbit target.

## Component Integration

`ShotCameraNavigation` owns the transient target ID and renders the selector.
At pointer-down it captures:

- scene ID and base revision;
- active camera ID and original camera transform;
- the current explicit target ID or `null`;
- the resolved finite target point when target orbit is enabled.

At pointer-move:

- left button uses image-plane pan and a distance reference;
- right button plus no target uses free rotation;
- right button plus a valid captured target uses fixed-radius orbit.

The renderer continues to receive only a draft transform. The editor store,
bridge, session, ScenePatch schema, and `SceneSpec` remain unaware of camera
navigation mode.

The selector is disabled while camera controls are disabled, while the camera
is user protected, or while a draft/commit is pending. A user-protected camera
continues to expose the existing unlock action; target selection does not
bypass protection.

## Accessibility And Layout

The selector has a visible short label and an accessible name that communicates
that it controls the right-drag orbit target. The free option explicitly says
that rotation is unlocked rather than using an ambiguous blank value.

The control stays in the existing Shot Preview control band and must not cover
the 16:9 image, mode switcher, movement pad, or focal readout at supported
desktop and compact breakpoints. Native keyboard operation of the select is
preserved and navigation key handlers must not intercept keystrokes while the
select has focus.

## Documentation

User-facing and Skill guidance must state:

- right-drag rotates freely in place by default;
- choose a visible actor or prop in Target lock to orbit it;
- no composition or keep-visible target is applied automatically;
- target choice is transient editor state.

Existing wording that promises automatic orbit around the primary composition
or keep-visible target must be replaced. Release notes are deferred until this
change is accepted as a stable milestone; no public release is implied by the
implementation commit alone.

## Testing

### Pure navigation tests

- free rotation preserves position, scale, and focal length inputs;
- horizontal drag changes yaw without introducing roll;
- vertical drag changes pitch and clamps before either pole;
- a complete horizontal revolution returns to the original direction;
- free rotation results are independent of scene constraints and framing;
- explicit actor and prop centers resolve deterministically;
- target orbit still preserves radius and looks at the explicit center;
- free pan sensitivity receives a finite positive reference distance.

Every new behavior begins with a failing test and follows the repository's
red-green-refactor cycle.

### UI contract and integration tests

- the selector defaults to free mode;
- it lists only visible actors and props in stable order;
- right-drag without a selection calls free rotation;
- right-drag with a selection calls target orbit using the captured target;
- changing scene or camera resets the target;
- hiding, removing, or invalidating the target resets it;
- the controller's own accepted revision preserves a valid selection;
- protected, disabled, and pending states disable the selector;
- inputs and the selector retain native keyboard behavior;
- one drag still creates one lock-preserving Patch and one undo step.

### Repository and browser verification

Run the focused navigation and UI tests, complete test suite, type checking,
lint, production build, public/generic audit, and `git diff --check`.

In a real connected browser with a generic scene containing actors, props, and
an enabled keep-visible/framing target:

1. leave Target lock off and right-drag away from the framed subject;
2. confirm the camera position is unchanged and direction is not pulled back;
3. choose a different visible actor and confirm right-drag orbits only it;
4. choose a visible prop and confirm the same explicit behavior;
5. return the selector to free mode and confirm free rotation resumes;
6. verify left-drag, wheel, keys, pad controls, workflow lock, user lock,
   revision count, undo/redo, and draft cancellation;
7. inspect the browser console and verify no unexpected errors or warnings;
8. inspect the final Shot Preview and composition report before any visual
   acceptance or PNG export claim.

All fixtures, screenshots, logs, and outputs remain generic and contain no
external profile data or machine-specific paths.

## Acceptance Criteria

The change is accepted when:

- right-drag never locks to an object unless the user explicitly chose it;
- free rotation changes direction in place and remains stable near vertical;
- explicit actor and prop target orbit is deterministic and visible in the UI;
- target choice follows the declared transient lifecycle;
- all existing camera controls, locking, history, concurrency, and export
  invariants remain intact;
- automated gates pass and a real browser reproduces both free rotation and
  explicit orbit behavior using only generic test content.
