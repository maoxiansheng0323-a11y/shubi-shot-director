# Editor View Mouse Controls Design

**Status:** Approved in conversation on 2026-08-06.

**Scope:** Change only the UI-only studio editor view mouse mapping. This does
not change any persistent shot camera, expanded Shot Preview control, scene
schema, or entity mutation contract.

## Decision

The large studio surface is an editor view, not a camera entity and not a
first-person camera. Its observation center remains the current
`OrbitControls` target.

The approved mouse mapping is:

- left-drag on empty studio space pans the editor view;
- right-drag on empty studio space or non-editable scene geometry orbits the
  editor view around its current observation center;
- left-drag on an editable actor, prop, or camera proxy continues to move that
  entity and takes priority over editor-view panning;
- a right-button click that moves no more than the shared 5 px studio drag
  threshold clears current entity and actor-part selection;
- a right-button gesture that exceeds the threshold rotates the editor view
  and must not clear selection;
- the wheel retains editor-view zoom.

This design supersedes only the sentence in
`2026-08-05-direct-studio-manipulation-design.md` that assigns editor-camera
panning to right-drag. Expanded Shot Preview retains its independent approved
mapping: left-drag translates the persistent shot camera and right-drag rotates
it.

## Interaction Boundary

`EditorCameraRig` owns the OrbitControls mouse-button mapping. The editor
surface owns right-button click-versus-drag classification. Both use the same
studio pointer threshold so one physical gesture cannot be interpreted as both
view rotation and selection clearing.

Selection clearing is transient UI behavior only. It removes ordinary entity
selection, red entity focus, and green actor-part focus. It does not undo an
accepted transform or pose edit, create a scene revision, change history, or
alter a shot camera. Undo remains a separate toolbar or keyboard action.

Entity dragging retains the existing pointer-capture, lock, draft, commit, and
cancel behavior. User-protected entities remain non-mutable. Workflow locks
remain preserved. Empty-space editor navigation never creates a `ScenePatch`.

## Event Rules

The editor surface records the right-button pointer-down position and compares
subsequent movement with `STUDIO_POINTER_DRAG_THRESHOLD_PX`.

- At or below the threshold, the following context-menu event is treated as a
  short right-click and clears transient selection.
- Above the threshold, the gesture is classified as editor-view rotation and
  the associated context-menu event is prevented without clearing selection.
- Pointer cancellation, lost capture, leaving the editor, or unmounting clears
  the temporary gesture classifier without changing scene or selection state.

Native browser context menus remain suppressed inside the editor surface.
Keyboard `Escape` remains an equivalent explicit selection-clear action.

## Accessibility And Copy

The editor viewport accessible label and public guidance must describe the
actual mapping: left-drag pans, right-drag orbits, and the wheel zooms. Text must
continue to distinguish the editor view from persistent shot cameras.

No visible tutorial overlay or additional mode button is introduced.

## Testing

Implementation follows red-green-refactor.

Focused automated tests must prove:

- OrbitControls maps left to pan, right to rotate, and middle to dolly;
- right movement at exactly 5 px remains a selection-clear click;
- right movement above 5 px suppresses selection clearing;
- left entity drag eligibility and transform commit behavior are unchanged;
- editor-view navigation creates no scene revision or camera Patch;
- expanded Shot Preview keeps its existing independent mouse mapping;
- viewport accessible copy matches the new controls.

Real-browser acceptance uses a generic large scene and verifies:

1. left-dragging empty space pans the studio without changing scene revision;
2. right-dragging empty space orbits around the current observation center
   without changing scene revision or selection;
3. a short right-click clears current entity or part selection;
4. left-dragging an entity still moves only that entity in one revision;
5. the compact and expanded shot-camera previews remain unchanged;
6. the browser console reports no unexpected errors or warnings.

After focused tests, run the repository type check, lint, build, public audit,
full `pnpm verify`, and `git diff --check` gates.

## Acceptance Criteria

The change is accepted when a large scene can be inspected with left-drag pan,
right-drag orbit, and wheel zoom; entity left-drag remains direct manipulation;
right-click clearing never fires after a rotation drag; and no editor-view
gesture mutates or persists a shot camera.
