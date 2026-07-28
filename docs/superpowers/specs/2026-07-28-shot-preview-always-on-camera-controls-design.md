# Shot Preview Always-On Camera Controls Design

## Problem

Shot Preview currently requires an unlabeled bottom-left toggle before its
pointer surface can receive input. When the toggle is inactive, keyboard
navigation is ignored, right-click opens the browser menu, and mouse gestures
do nothing. The controls therefore appear broken even though the gesture logic
exists.

## Decision

Shot Preview owns its camera interaction surface whenever an active camera is
present and the editor is not disabled. There is no separate activation mode.
The surface always suppresses its context menu and becomes focused after an
eligible Shot Preview mounts or is clicked.

Keep the existing interaction paths:

- left drag pans on the image plane;
- right drag orbits around the derived composition target;
- wheel changes focal length in millimeters;
- arrow keys move forward, backward, left, and right;
- PageUp and PageDown move along world Y.

Add a compact six-button pad for forward, backward, left, right, up, and down.
Each click uses the existing keyboard movement mapping and commits exactly one
lock-preserving transform Patch, producing one undo step. The pad is a reliable
fallback, not a replacement for mouse or keyboard control.

## Lock And State Rules

- `user` locked cameras disable every camera control and never create a draft.
- `workflow` locked cameras remain workflow locked through
  `preserveLock: true`.
- Live drafts remain UI state and are not persisted in `SceneSpec`.
- No schema, bridge, scene-file, or export contract changes are required.

## Acceptance

In an eligible Shot Preview, right-click never opens the browser menu, keyboard
navigation works without pressing a mode toggle, and every six-way button moves
the camera in the matching direction with one revision increment. User-locked
cameras expose the disabled state. Existing pointer, wheel, undo, export, and
outside-wall visibility behavior remains intact.
