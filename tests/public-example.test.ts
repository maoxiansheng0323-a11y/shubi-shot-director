import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ACTOR_LIMB_PART_IDS } from "../src/domain/actor-anatomy";
import { INTENT_REPORT_SCHEMA_VERSION } from "../src/domain/intent-report";
import { parseSceneSubmission } from "../src/domain/scene-submission";
import { analyzeComposition } from "../src/domain/composition-safety";
import { isLegacyActorEntity } from "../src/domain/scene-schema";

const exampleUrl = new URL(
  "../examples/quickstart.scene-submission.json",
  import.meta.url,
);
const connectedExampleUrl = new URL(
  "../examples/connected-regions.scene-submission.json",
  import.meta.url,
);
const examplesDirectoryUrl = new URL("../examples/", import.meta.url);

const allPresentLimbPresence = Object.fromEntries(
  ACTOR_LIMB_PART_IDS.map((partId) => [partId, "present"]),
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

const collectExactKeys = (
  value: unknown,
  keyName: string,
  matches: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExactKeys(item, keyName, matches);
    }
    return matches;
  }
  if (typeof value !== "object" || value === null) {
    return matches;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === keyName) {
      matches.push(key);
    }
    collectExactKeys(child, keyName, matches);
  }
  return matches;
};

const silentlyLockedCreateEntityIds = (
  raw: unknown,
): string[] => {
  const submission = parseSceneSubmission(raw);
  if (submission.intentReport.operation !== "create") {
    return [];
  }

  return submission.scene.entities
    .filter(({ lockMode }) => lockMode !== "none")
    .filter(
      ({ id }) =>
        !submission.intentReport.recognizedConstraints.some(
          (constraint) =>
            constraint.kind === "lock-protection" &&
            constraint.targets.includes(id) &&
            constraint.evidence.some(
              (evidence) =>
                evidence.type === "entity-property" &&
                evidence.entityId === id &&
                evidence.path === "entity.lockMode",
            ),
        ),
    )
    .map(({ id }) => id);
};

describe("public quick-start scene submission", () => {
  it("is a strict generic create envelope with complete evidence", async () => {
    const source = await readFile(exampleUrl, "utf8");
    const raw: unknown = JSON.parse(source);
    const submission = parseSceneSubmission(raw);

    expect(submission.intentReport).toMatchObject({
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
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
      "actor-limb-presence",
      "pose",
      "contact",
      "focal-length",
      "output",
    ]);

    expect(submission.scene.sceneId).toBe("scene_quickstart_1");
    expect(submission.scene.schemaVersion).toBe(5);
    expect(submission.scene.spatialLayout).toBeNull();
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
      body: { limbPresence: allPresentLimbPresence },
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
    expect(
      submission.scene.entities.every(
        ({ lockMode }) => lockMode === "none",
      ),
    ).toBe(true);

    expect(collectForbiddenKeys(raw)).toEqual([]);
    expect(source).not.toMatch(
      /(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:users|home)\/|file:\/\/)/iu,
    );
    expect(collectExactKeys(raw, "locked")).toEqual([]);
  });

  it("provides an abstract three-region connected-layout example", async () => {
    const source = await readFile(connectedExampleUrl, "utf8");
    const raw: unknown = JSON.parse(source);
    const submission = parseSceneSubmission(raw);

    expect(
      submission.scene.spatialLayout?.regions.map(({ id }) => id),
    ).toEqual(["region_alpha", "region_beta", "region_gamma"]);
    expect(
      submission.scene.entities.some(
        (entity) => entity.kind === "environment",
      ),
    ).toBe(false);
    expect(
      submission.scene.spatialLayout?.connections.map(
        ({ openingId }) => openingId,
      ),
    ).toEqual(["opening_alpha_beta", "opening_beta_gamma"]);
    expect(collectForbiddenKeys(raw)).toEqual([]);
    expect(collectExactKeys(raw, "locked")).toEqual([]);
    expect(analyzeComposition(submission.scene).topologySafe.status).toBe(
      "pass",
    );
  });

  it("keeps every canonical public scene on v5 lockMode and limb-presence fields", async () => {
    const starterSource = await readFile(
      new URL("../examples/starter.scene.json", import.meta.url),
      "utf8",
    );
    const starter: unknown = JSON.parse(starterSource);

    expect(starter).toMatchObject({ schemaVersion: 5 });
    expect(collectExactKeys(starter, "locked")).toEqual([]);
    expect(starter).toMatchObject({
      entities: expect.arrayContaining([
        expect.objectContaining({ lockMode: "none" }),
      ]),
    });
    expect(
      (
        starter as {
          entities: Array<{
            kind: string;
            lockMode: string;
            body?: { limbPresence?: unknown };
          }>;
        }
      ).entities.every(({ lockMode }) => lockMode === "none"),
    ).toBe(true);
    expect(
      (
        starter as {
          entities: Array<{
            kind: string;
            body?: { limbPresence?: unknown };
          }>;
        }
      ).entities
        .filter(({ kind }) => kind === "actor")
        .every(
          ({ body }) =>
            JSON.stringify(body?.limbPresence) ===
            JSON.stringify(allPresentLimbPresence),
        ),
    ).toBe(true);
  });

  it("gives every public actor a complete generic all-present map and intent evidence", async () => {
    const submissionFiles = (await readdir(examplesDirectoryUrl)).filter(
      (fileName) => fileName.endsWith(".scene-submission.json"),
    );

    for (const fileName of submissionFiles) {
      const raw: unknown = JSON.parse(
        await readFile(new URL(fileName, examplesDirectoryUrl), "utf8"),
      );
      const submission = parseSceneSubmission(raw);
      expect(submission.scene.schemaVersion, fileName).toBe(5);
      expect(submission.intentReport.schemaVersion, fileName).toBe(5);
      for (const actor of submission.scene.entities.filter(
        (entity) => entity.kind === "actor",
      )) {
        if (!isLegacyActorEntity(actor)) {
          throw new Error(`${fileName}:${actor.id} must be a legacy actor.`);
        }
        expect(actor.body.limbPresence, `${fileName}:${actor.id}`).toEqual(
          allPresentLimbPresence,
        );
        expect(
          submission.intentReport.recognizedConstraints.find(
            (constraint) =>
              constraint.kind === "actor-limb-presence" &&
              constraint.targets.includes(actor.id),
          )?.evidence,
          `${fileName}:${actor.id}`,
        ).toEqual(
          ACTOR_LIMB_PART_IDS.map((partId) => ({
            type: "entity-property",
            entityId: actor.id,
            path: `entity.body.limbPresence.${partId}`,
          })),
        );
      }
    }
  });

  it("never adds create-example locks without lock-protection intent evidence", async () => {
    const submissionFiles = (await readdir(examplesDirectoryUrl)).filter(
      (fileName) => fileName.endsWith(".scene-submission.json"),
    );

    for (const fileName of submissionFiles) {
      const raw: unknown = JSON.parse(
        await readFile(new URL(fileName, examplesDirectoryUrl), "utf8"),
      );
      expect(
        silentlyLockedCreateEntityIds(raw),
        `${fileName} has locks without lock-protection intent evidence`,
      ).toEqual([]);
    }
  });
});
