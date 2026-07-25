# Connected environments

The current public schema supports one graybox room environment plus ordinary
props. It does not yet provide stable `Zone`, `WallSegment`, `Opening`,
`Portal`, `ClearancePath`, or camera-volume records.

Do not approximate a request for connected rooms, door openings, guaranteed
clearance, or cross-zone sightlines with a generic three-wall room and then
claim success. Return an unsupported spatial-topology constraint.

For requests that fit the current schema:

- use the room preset only as the enclosing graybox;
- use props for non-structural blocking volumes;
- preserve entity IDs and transforms across camera edits;
- add composition targets for subjects and critical props that must remain in
  frame.

Connected-environment authoring belongs to the later schema migration. Do not
smuggle it into preset parameters whose meaning is not validated.
