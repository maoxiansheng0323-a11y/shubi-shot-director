# Visual QA

Run deterministic pose/contact diagnostics before composition or visual confirmation:

```text
node scripts/director.mjs pose inspect --json
```

Require `report.status: "pass"` for final acceptance. Joint-limit or preferred-bend violations, required contact gap/penetration, out-of-bounds support, unavailable body sites, and failed relaxed-limb targets must be resolved before screenshot review. A `check` remains explicit and export reports `POSE_DIAGNOSTICS_CHECK`; a `fail` blocks composition inspection and export. These checks provide `actor.pose-diagnostics`, `actor.body-contact-sites`, and `actor.static-blocking` evidence.

Then run deterministic composition inspection:

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

First inspect Overview for the whole actor and scene. Confirm requested resolved stature against nearby geometry and compare actor branches at the same meter scale when relevant. Then inspect every affected Local preview for edited limb chains, wrist/ankle articulation, and any contact correction. Finally inspect Shot Preview from the authoritative final camera. Do not claim visual success until stature, missing limbs, pose, contact, framing, persistence across snapshot/save-load, and export state have all been verified.

For a connected layout, inspect Overview for complete region footprints,
wall continuity, door/opening cuts, and connection markers. Then inspect every
affected Local preview: the focused floor and members stay opaque, its
boundaries remain translucent enough to see the interior, adjacent regions are
faded but readable, and distant regions remain context only. Finally switch to
Shot Preview and confirm that Local fading is absent and persistent visibility,
wall openings, entity placement, and the active camera are authoritative.

For limb-presence edits on either actor branch, confirm the requested complete chains are absent or present without hidden geometry, zero-scale geometry, detached fallback parts, phantom joints, or stale bounds. For joint edits, inspect the named canonical joint and its child segment; remember that `hand_*` is the wrist terminal and `foot_*` is the ankle terminal. Confirm contact correction does not move unrelated entities or alter framing unexpectedly.

For Blueprint actors, verify base -> variant -> instance `limbPresenceOverrides` layering, effective variant state, resolved stature from `heightScale`, and module geometry from the same projection used by render, bounds, contact, composition, and diagnostics. Confirm exposed terminals or sealed interfaces follow their mount bones through pose changes, hidden modules leave no stale bounds, variant changes preserve manual overrides, the embedded snapshot SHA-256 does not change, and a saved/reloaded scene remains identical without the external source file.

Region labels are Host-authored display text, not runtime room types. Do not
claim a semantic room classification from floor colors, label wording, or
region order.

CLI export requires an open connected Shot Preview at the exact current scene
revision. The returned PNG must come from the browser-rendered final camera;
never accept a software approximation or a stale preview as equivalent.

For an export, verify the returned scene ID, revision, dimensions, SHA-256
hash, and warning codes. Never infer export success from a file name alone.
