import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseSceneSubmission } from "../src/domain/scene-submission";

const exampleUrl = new URL(
  "../examples/quickstart.scene-submission.json",
  import.meta.url,
);

const forbiddenEnvelopeKeys = new Set([
  "aliases",
  "apikey",
  "credentials",
  "endpoint",
  "model",
  "profile",
  "projectprofile",
  "prompt",
  "provider",
  "rawtext",
  "sourcetext",
  "token",
  "wording",
]);

const collectForbiddenKeys = (
  value: unknown,
  matches: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectForbiddenKeys(item, matches);
    }
    return matches;
  }
  if (typeof value !== "object" || value === null) {
    return matches;
  }
  for (const [key, child] of Object.entries(value)) {
    const folded = key.replaceAll(/[-_]/gu, "").toLocaleLowerCase();
    if (forbiddenEnvelopeKeys.has(folded)) {
      matches.push(key);
    }
    collectForbiddenKeys(child, matches);
  }
  return matches;
};

describe("public quick-start scene submission", () => {
  it("is a strict generic create envelope with complete evidence", async () => {
    const source = await readFile(exampleUrl, "utf8");
    const raw: unknown = JSON.parse(source);
    const submission = parseSceneSubmission(raw);

    expect(submission.intentReport).toMatchObject({
      schemaVersion: 1,
      operation: "create",
      allowPartial: false,
      unsupportedConstraints: [],
      unresolvedRelations: [],
      warnings: [],
      canApplySafely: true,
    });
    expect(
      submission.intentReport.recognizedConstraints.map(
        ({ kind }) => kind,
      ),
    ).toEqual([
      "environment",
      "entity-presence",
      "actor-slot",
      "pose",
      "contact",
      "focal-length",
      "output",
    ]);

    expect(submission.scene.sceneId).toBe("scene_quickstart_1");
    expect(submission.scene.revision).toBe(0);
    expect(submission.scene.output).toEqual({
      aspect: { width: 16, height: 9 },
      resolutionPx: { width: 1920, height: 1080 },
    });
    expect(
      submission.scene.entities.map(({ id, kind }) => ({ id, kind })),
    ).toEqual([
      { id: "environment_room_1", kind: "environment" },
      { id: "actor_generic_1", kind: "actor" },
      { id: "prop_block_1", kind: "prop" },
      { id: "camera_shot_1", kind: "camera" },
    ]);

    const actor = submission.scene.entities.find(
      (entity) => entity.id === "actor_generic_1",
    );
    const camera = submission.scene.entities.find(
      (entity) => entity.id === "camera_shot_1",
    );
    expect(actor).toMatchObject({
      kind: "actor",
      slot: "actor_generic_1",
    });
    expect(camera).toMatchObject({
      kind: "camera",
      lens: {
        projection: "perspective",
        focalLengthMm: 45,
      },
    });
    expect(submission.scene.constraints).toContainEqual({
      id: "constraint_ground_actor_1",
      type: "ground-contact",
      entityId: "actor_generic_1",
      surfaceEntityId: "environment_room_1",
      enabled: true,
    });

    expect(collectForbiddenKeys(raw)).toEqual([]);
    expect(source).not.toMatch(
      /(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:users|home)\/|file:\/\/)/iu,
    );
  });
});
