# External profiles

Load an external `project-profile.json` only when the user supplies its exact path in the current request and Host Codex has filesystem access to that path. If the explicit path is a relative path, resolve it against the current working project before changing to the Skill directory and keep only the resulting host-only absolute path in host memory.

## Host-only procedure

1. Read only that exact host-only absolute path with host filesystem access. Never search parent folders, home directories, sibling repositories, recent files, or conventional locations.
2. Validate a strict generic v1 object with no extra fields:

   ```json
   {
     "schemaVersion": 1,
     "actorAliases": [
       {
         "slot": "actor_generic_1",
         "aliases": ["generic-subject-a"]
       }
     ]
   }
   ```

3. Require every `slot` to match `^actor_(male|female|generic)_[1-9][0-9]*$`. Require non-empty alias arrays and reject duplicate or ambiguous normalized aliases.
4. Normalize aliases only in host memory for comparison. Resolve them to generic slots before authoring entities, targets, evidence, or Patch operations.
5. If an alias remains ambiguous, ask the user only when the choice changes the result. Do not guess.
6. Discard the path, file content, aliases, and normalized lookup after host planning.

Never pass the profile path, profile content, alias text, or normalized lookup to the Director runtime. Never copy them into the repository, transient submissions, IntentReport, SceneSpec, ScenePatch, saved scenes, logs, screenshots, fixtures, or exports.

If the exact file cannot be read or validated, report a generic host-side profile error without echoing the path or content. The runtime has no profile command or profile input.
