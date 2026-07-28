# Visual QA

Run deterministic composition inspection before visual confirmation:

```text
node scripts/director.mjs composition inspect --json
```

Require separate results for:

- anchor safety;
- framing safety;
- caption and side-UI safety;
- occlusion safety;
- topology safety;
- camera collision safety.

Overall `SAFE` is valid only when every required check passes. Treat
`unchecked`, `check`, `fail`, low confidence, and approximate proxy results as
requiring review.

Then inspect the real final-camera preview. Confirm contact, pose, foreground
ordering, wall penetration, key-prop completeness, headroom, look room,
caption clearance, and the requested shot size. Approximate domain checks do
not replace the rendered view.

First inspect Overview for the whole actor and scene. Then inspect every affected Local preview for the edited limb chains and any contact correction. Finally inspect Shot Preview from the authoritative final camera. Do not claim visual success until contact, framing, persistence across snapshot/save-load, and export state have all been verified.

For a connected layout, inspect Overview for complete region footprints,
wall continuity, door/opening cuts, and connection markers. Then inspect every
affected Local preview: the focused floor and members stay opaque, its
boundaries remain translucent enough to see the interior, adjacent regions are
faded but readable, and distant regions remain context only. Finally switch to
Shot Preview and confirm that Local fading is absent and persistent visibility,
wall openings, entity placement, and the active camera are authoritative.

For limb-presence edits, confirm the requested complete chains are absent or present without hidden geometry, zero-scale geometry, detached fallback parts, phantom joints, or stale bounds. Confirm contact correction does not move unrelated entities or alter framing unexpectedly.

Region labels are Host-authored display text, not runtime room types. Do not
claim a semantic room classification from floor colors, label wording, or
region order.

CLI export requires an open connected Shot Preview at the exact current scene
revision. The returned PNG must come from the browser-rendered final camera;
never accept a software approximation or a stale preview as equivalent.

For an export, verify the returned scene ID, revision, dimensions, SHA-256
hash, and warning codes. Never infer export success from a file name alone.
