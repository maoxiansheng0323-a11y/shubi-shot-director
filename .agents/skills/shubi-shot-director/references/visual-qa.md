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

CLI export requires an open connected Shot Preview at the exact current scene
revision. The returned PNG must come from the browser-rendered final camera;
never accept a software approximation or a stale preview as equivalent.

For an export, verify the returned scene ID, revision, dimensions, SHA-256
hash, and warning codes. Never infer export success from a file name alone.
