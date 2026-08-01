import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { ACTOR_LIMB_PART_IDS } from "../src/domain/actor-anatomy";
import { createDefaultScene } from "../src/domain/default-scene";
import { INTENT_REPORT_SCHEMA_VERSION } from "../src/domain/intent-report";
import {
  type ScenePatch,
} from "../src/domain/scene-patch";
import {
  isLegacyActorEntity,
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  patchSubmissionSchema,
  sceneSubmissionSchema,
} from "../src/domain/scene-submission";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";
import { createSkillRuntimeFixture } from "./helpers/skill-runtime-fixture";

const execFileAsync = promisify(execFile);
const auditScript = path.resolve(
  ".agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs",
);
const transitionScript = path.resolve(
  ".agents/skills/shubi-shot-director/scripts/verify-transition.mjs",
);
const canonicalJsonDigestScript = path.resolve(
  "scripts/canonical-json-sha256.mjs",
);
const actorLimbPlan = path.resolve(
  "docs/superpowers/plans/2026-07-27-actor-limb-presence.md",
);
const skillDirectory = path.resolve(
  ".agents/skills/shubi-shot-director",
);
const referenceDirectory = path.join(skillDirectory, "references");
const generatedSchemaDirectory = path.join(
  referenceDirectory,
  "generated",
);
const temporaryDirectories: string[] = [];

const extractVerificationTestReferences = (source: string): string[] =>
  [
    ...new Set(
      (
        source.match(
          /(?<![A-Za-z0-9._/\\-])tests(?:[\\/][A-Za-z0-9._-]+)+\.test\.ts(?![A-Za-z0-9._/\\-])/gu,
        ) ?? []
      ).map((reference) => reference.replaceAll("\\", "/")),
    ),
  ].sort();

const markdownSectionAfterHeading = (
  source: string,
  heading: string,
): string => {
  const marker = `### ${heading}`;
  const headingIndex = source.indexOf(marker);
  if (headingIndex < 0) {
    return "";
  }
  const contentStart = source.indexOf("\n", headingIndex + marker.length);
  if (contentStart < 0) {
    return "";
  }
  const remaining = source.slice(contentStart + 1);
  const nextHeadingIndex = remaining.search(/^#{1,3}\s+/mu);
  return (nextHeadingIndex < 0
    ? remaining
    : remaining.slice(0, nextHeadingIndex)
  ).trim();
};

const fencedCodeBlock = (source: string, language: string): string => {
  const marker = "```" + language;
  const openingIndex = source.indexOf(marker);
  if (openingIndex < 0) {
    return "";
  }
  const contentStart = source.indexOf("\n", openingIndex + marker.length);
  if (contentStart < 0) {
    return "";
  }
  const closingIndex = source.indexOf("```", contentStart + 1);
  return closingIndex < 0
    ? ""
    : source.slice(contentStart + 1, closingIndex).trim();
};

type JsonSchemaNode = {
  additionalProperties?: boolean;
  const?: unknown;
  enum?: unknown[];
  maximum?: number;
  maxItems?: number;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  [key: string]: unknown;
  properties?: Record<string, JsonSchemaNode>;
};

const nestedConst = (
  schema: JsonSchemaNode,
  ...propertyNames: string[]
): unknown => {
  let current = schema;
  for (const propertyName of propertyNames) {
    const next = current.properties?.[propertyName];
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }
  return current.const;
};

const propertySchemas = (
  schema: unknown,
  propertyName: string,
  matches: JsonSchemaNode[] = [],
): JsonSchemaNode[] => {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      propertySchemas(item, propertyName, matches);
    }
    return matches;
  }
  if (typeof schema !== "object" || schema === null) {
    return matches;
  }

  const node = schema as JsonSchemaNode;
  const property = node.properties?.[propertyName];
  if (property !== undefined) {
    matches.push(property);
  }
  for (const value of Object.values(node)) {
    propertySchemas(value, propertyName, matches);
  }
  return matches;
};

const objectSchemasWithProperties = (
  schema: unknown,
  propertyNames: readonly string[],
  matches: JsonSchemaNode[] = [],
): JsonSchemaNode[] => {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      objectSchemasWithProperties(item, propertyNames, matches);
    }
    return matches;
  }
  if (typeof schema !== "object" || schema === null) {
    return matches;
  }

  const node = schema as JsonSchemaNode;
  if (
    node.properties !== undefined &&
    propertyNames.every((propertyName) =>
      Object.hasOwn(node.properties!, propertyName),
    )
  ) {
    matches.push(node);
  }
  for (const value of Object.values(node)) {
    objectSchemasWithProperties(value, propertyNames, matches);
  }
  return matches;
};

const fencedJsonAfterHeading = (
  source: string,
  heading: string,
): unknown => {
  const headingIndex = source.indexOf(heading);
  expect(headingIndex, `missing heading: ${heading}`).toBeGreaterThanOrEqual(
    0,
  );
  const openingIndex = source.indexOf("```json", headingIndex);
  expect(
    openingIndex,
    `missing JSON fence after: ${heading}`,
  ).toBeGreaterThanOrEqual(0);
  const contentIndex = openingIndex + "```json".length;
  const closingIndex = source.indexOf("```", contentIndex);
  expect(
    closingIndex,
    `missing closing JSON fence after: ${heading}`,
  ).toBeGreaterThan(contentIndex);
  return JSON.parse(source.slice(contentIndex, closingIndex));
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shot-skill-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const runTransitionVerifier = async (
  directory: string,
  before: SceneSpec,
  after: SceneSpec,
  patch: ScenePatch,
) => {
  const beforeFile = path.join(directory, "before.json");
  const afterFile = path.join(directory, "after.json");
  const patchFile = path.join(directory, "patch.json");
  await Promise.all([
    writeFile(beforeFile, JSON.stringify(before)),
    writeFile(afterFile, JSON.stringify(after)),
    writeFile(patchFile, JSON.stringify(patch)),
  ]);
  return execFileAsync(
    process.execPath,
    [
      transitionScript,
      "--before",
      beforeFile,
      "--after",
      afterFile,
      "--patch",
      patchFile,
    ],
    { encoding: "utf8" },
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Skill deterministic scripts", () => {
  it.each([
    [
      "LIMB_HIERARCHY_CONFLICT",
      "The requested limb presence conflicts with the actor hierarchy.",
    ],
    [
      "ACTOR_LIMB_TARGET_INVALID",
      "The requested limb target is not an editable actor.",
    ],
  ] as const)("maps %s to a fixed safe message", async (code, message) => {
    const privateMarker = `PRIVATE_${code}_DETAIL`;
    const runtime = await createSkillRuntimeFixture({
      doctorData: { ...getRuntimeCapabilityManifest() },
      actionErrors: {
        "patch.apply": {
          code,
          message: privateMarker,
        },
      },
    });
    temporaryDirectories.push(runtime.runtimeRoot);

    const result = await runtime.run([
      "patch",
      "apply",
      "--file",
      "patch.json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: { code, message },
    });
    expect(message).not.toHaveLength(0);
    expect(result.stdout).not.toContain(privateMarker);
  });

  it("audits generic artifacts without exposing denied content", async () => {
    const directory = await temporaryDirectory();
    const safeFile = path.join(directory, "safe.json");
    await writeFile(
      safeFile,
      JSON.stringify({
        sceneId: "scene_generic_test",
        actorSlot: "actor_generic_1",
      }),
    );

    const safe = await execFileAsync(
      process.execPath,
      [auditScript, "--artifact", "--file", safeFile],
      { encoding: "utf8" },
    );
    expect(JSON.parse(safe.stdout)).toMatchObject({ ok: true });

    const deniedValue = "nonpublic-placeholder-token";
    const unsafeFile = path.join(directory, "unsafe.json");
    await writeFile(
      unsafeFile,
      JSON.stringify({
        sceneId: "scene_generic_test",
        rawPrompt: deniedValue,
      }),
    );

    await expect(
      execFileAsync(
        process.execPath,
        [
          auditScript,
          "--artifact",
          "--file",
          unsafeFile,
          "--deny-token",
          deniedValue,
        ],
        { encoding: "utf8" },
      ),
    ).rejects.toMatchObject({
      stdout: expect.not.stringContaining(deniedValue),
    });

    const pathMarker = ["D:", "workspace", "actor.json"].join("\\");
    const pathUnsafeFile = path.join(directory, "path-unsafe.json");
    await writeFile(
      pathUnsafeFile,
      JSON.stringify({
        blueprintFile: pathMarker,
        sourcePath: pathMarker,
      }),
    );
    await expect(
      execFileAsync(
        process.execPath,
        [auditScript, "--artifact", "--file", pathUnsafeFile],
        { encoding: "utf8" },
      ),
    ).rejects.toMatchObject({
      stdout: expect.not.stringContaining(pathMarker),
    });
  });

  it("verifies one-revision minimal Patch transitions", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_transition_test",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "system",
      preserveLock: false,
      operations: [
        {
          op: "camera.lens.set",
          entityId: before.activeCameraId,
          value: {
            projection: "perspective",
            focalLengthMm: 60,
            sensorWidthMm: 36,
            nearM: 0.05,
            farM: 200,
          },
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const beforeFile = path.join(directory, "before.json");
    const afterFile = path.join(directory, "after.json");
    const patchFile = path.join(directory, "patch.json");
    await Promise.all([
      writeFile(beforeFile, JSON.stringify(before)),
      writeFile(afterFile, JSON.stringify(after)),
      writeFile(patchFile, JSON.stringify(patch)),
    ]);

    const verified = await execFileAsync(
      process.execPath,
      [
        transitionScript,
        "--before",
        beforeFile,
        "--after",
        afterFile,
        "--patch",
        patchFile,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(verified.stdout)).toMatchObject({
      ok: true,
      checks: {
        sameSceneId: true,
        exactRevision: true,
        hasOperations: true,
        diffIsMinimal: true,
      },
      changedFields: [
        "entities.camera_shot_1.lens.focalLengthMm",
      ],
    });
  });

  it("authorizes only actor limb presence plus deterministic contact correction", async () => {
    const directory = await temporaryDirectory();
    const defaultScene = createDefaultScene();
    const before = sceneSpecSchema.parse({
      ...defaultScene,
      entities: defaultScene.entities.filter(
        (entity) => entity.kind !== "environment",
      ),
      constraints: defaultScene.constraints.map((constraint) => ({
        ...constraint,
        surfaceEntityId: null,
      })),
      spatialLayout: {
        floorY: 0,
        regions: [
          {
            id: "region_stage_1",
            label: "Stage",
            footprintXZ: [
              [-6, -6],
              [6, -6],
              [6, 6],
              [-6, 6],
            ],
            heightM: 3,
            visible: true,
          },
        ],
        boundaries: [],
        openings: [],
        connections: [],
        memberships: [],
      },
    });
    const actor = before.entities.find((entity) => entity.kind === "actor");
    if (!actor || actor.kind !== "actor") {
      throw new Error("Missing generic actor fixture.");
    }
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_limb_transition_test",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: true,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: {
            upper_arm_r: "absent",
            lower_leg_l: "absent",
            lower_leg_r: "absent",
          },
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const beforeFile = path.join(directory, "before.json");
    const afterFile = path.join(directory, "after.json");
    const patchFile = path.join(directory, "patch.json");
    await Promise.all([
      writeFile(beforeFile, JSON.stringify(before)),
      writeFile(afterFile, JSON.stringify(after)),
      writeFile(patchFile, JSON.stringify(patch)),
    ]);

    const verified = await execFileAsync(
      process.execPath,
      [
        transitionScript,
        "--before",
        beforeFile,
        "--after",
        afterFile,
        "--patch",
        patchFile,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(verified.stdout)).toMatchObject({
      ok: true,
      changedFields: [
        `entities.${actor.id}.body.limbPresence.foot_l`,
        `entities.${actor.id}.body.limbPresence.foot_r`,
        `entities.${actor.id}.body.limbPresence.forearm_r`,
        `entities.${actor.id}.body.limbPresence.hand_r`,
        `entities.${actor.id}.body.limbPresence.lower_leg_l`,
        `entities.${actor.id}.body.limbPresence.lower_leg_r`,
        `entities.${actor.id}.body.limbPresence.upper_arm_r`,
        `entities.${actor.id}.transform.positionM.1`,
      ],
      unexpectedDifferences: [],
    });

    const tampered = structuredClone(after);
    tampered.title = "Tampered scene title";
    const tamperedActor = tampered.entities.find(
      (entity) => entity.id === actor.id,
    );
    const otherEntity = tampered.entities.find(
      (entity) => entity.id !== actor.id,
    );
    if (!isLegacyActorEntity(tamperedActor) || !otherEntity) {
      throw new Error("Missing transition tamper fixtures.");
    }
    tamperedActor.label = "Tampered actor label";
    tamperedActor.lockMode = "workflow";
    tamperedActor.rig = {
      ...tamperedActor.rig,
      version: tamperedActor.rig.version + 1,
    };
    tamperedActor.transform.positionM[0] += 1;
    tamperedActor.transform.positionM[2] += 1;
    otherEntity.visible = !otherEntity.visible;
    if (tampered.spatialLayout === null) {
      throw new Error("Missing spatial layout tamper fixture.");
    }
    tampered.spatialLayout.regions[0]!.visible = false;
    await writeFile(afterFile, JSON.stringify(tampered));

    await expect(
      execFileAsync(
        process.execPath,
        [
          transitionScript,
          "--before",
          beforeFile,
          "--after",
          afterFile,
          "--patch",
          patchFile,
        ],
        { encoding: "utf8" },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${actor.id}.label","entities.${actor.id}.lockMode","entities.${actor.id}.rig.version","entities.${actor.id}.transform.positionM.0","entities.${actor.id}.transform.positionM.2","entities.${otherEntity.id}.visible","spatialLayout.regions.0.visible","title"]`,
      ),
    });
  });

  it("rejects unrelated limb keys outside the requested hierarchy closure", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const actor = before.entities.find((entity) => entity.kind === "actor");
    if (!actor || actor.kind !== "actor") {
      throw new Error("Missing hierarchy closure actor fixture.");
    }
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_limb_closure_boundary",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { upper_arm_r: "absent" },
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const afterActor = after.entities.find((entity) => entity.id === actor.id);
    if (!isLegacyActorEntity(afterActor)) {
      throw new Error("Missing hierarchy closure result actor.");
    }
    afterActor.body.limbPresence.foot_l = "absent";

    await expect(
      runTransitionVerifier(directory, before, after, patch),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${actor.id}.body.limbPresence.foot_l"]`,
      ),
    });
  });

  it("rejects limb-operation Y drift without enabled ground contact", async () => {
    const directory = await temporaryDirectory();
    const before = sceneSpecSchema.parse({
      ...createDefaultScene(),
      constraints: [],
    });
    const actor = before.entities.find((entity) => entity.kind === "actor");
    if (!isLegacyActorEntity(actor)) {
      throw new Error("Missing no-contact actor fixture.");
    }
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_limb_without_contact",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { upper_arm_r: "absent" },
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const afterActor = after.entities.find((entity) => entity.id === actor.id);
    if (!afterActor || afterActor.kind !== "actor") {
      throw new Error("Missing no-contact result actor.");
    }
    afterActor.transform.positionM[1] += 5;

    await expect(
      runTransitionVerifier(directory, before, after, patch),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${actor.id}.transform.positionM.1"]`,
      ),
    });
  });

  it("rejects arbitrary Y drift despite an enabled ground contact", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const actor = before.entities.find((entity) => entity.kind === "actor");
    if (!isLegacyActorEntity(actor)) {
      throw new Error("Missing contact actor fixture.");
    }
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_limb_contact_tamper",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { upper_arm_r: "absent" },
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const afterActor = after.entities.find((entity) => entity.id === actor.id);
    if (!afterActor || afterActor.kind !== "actor") {
      throw new Error("Missing contact result actor.");
    }
    afterActor.transform.positionM[1] += 5;

    await expect(
      runTransitionVerifier(directory, before, after, patch),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${actor.id}.transform.positionM.1"]`,
      ),
    });
  });

  it("authorizes only fields present in entity.flags.set operations", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const entityId = before.entities[0]!.id;
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_lock_transition_test",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "entity.flags.set",
          entityId,
          lockMode: "workflow",
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    after.entities[0]!.visible = !after.entities[0]!.visible;
    const beforeFile = path.join(directory, "before.json");
    const afterFile = path.join(directory, "after.json");
    const patchFile = path.join(directory, "patch.json");
    await Promise.all([
      writeFile(beforeFile, JSON.stringify(before)),
      writeFile(afterFile, JSON.stringify(after)),
      writeFile(patchFile, JSON.stringify(patch)),
    ]);

    await expect(
      execFileAsync(
        process.execPath,
        [
          transitionScript,
          "--before",
          beforeFile,
          "--after",
          afterFile,
          "--patch",
          patchFile,
        ],
        { encoding: "utf8" },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${entityId}.visible"]`,
      ),
    });
  });

  it("does not let visible false authorize sibling lockMode drift", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const entityId = before.entities[0]!.id;
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_visible_false_transition_test",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "system",
      preserveLock: false,
      operations: [
        {
          op: "entity.flags.set",
          entityId,
          visible: false,
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const beforeFile = path.join(directory, "before.json");
    const afterFile = path.join(directory, "after.json");
    const patchFile = path.join(directory, "patch.json");
    await Promise.all([
      writeFile(beforeFile, JSON.stringify(before)),
      writeFile(afterFile, JSON.stringify(after)),
      writeFile(patchFile, JSON.stringify(patch)),
    ]);

    const verified = await execFileAsync(
      process.execPath,
      [
        transitionScript,
        "--before",
        beforeFile,
        "--after",
        afterFile,
        "--patch",
        patchFile,
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(verified.stdout)).toMatchObject({
      ok: true,
      changedFields: [`entities.${entityId}.visible`],
    });

    const tampered = structuredClone(after);
    tampered.entities[0]!.lockMode = "workflow";
    await writeFile(afterFile, JSON.stringify(tampered));

    await expect(
      execFileAsync(
        process.execPath,
        [
          transitionScript,
          "--before",
          beforeFile,
          "--after",
          afterFile,
          "--patch",
          patchFile,
        ],
        { encoding: "utf8" },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${entityId}.lockMode"]`,
      ),
    });
  });

  it("does not let lockMode none authorize sibling visible drift", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const entityId = before.entities[0]!.id;
    before.entities[0]!.lockMode = "workflow";
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_lock_none_transition_test",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "system",
      preserveLock: false,
      operations: [
        {
          op: "entity.flags.set",
          entityId,
          lockMode: "none",
        },
      ],
    };
    const after = applyScenePatch(before, patch).next;
    const beforeFile = path.join(directory, "before.json");
    const afterFile = path.join(directory, "after.json");
    const patchFile = path.join(directory, "patch.json");
    await Promise.all([
      writeFile(beforeFile, JSON.stringify(before)),
      writeFile(afterFile, JSON.stringify(after)),
      writeFile(patchFile, JSON.stringify(patch)),
    ]);

    const verified = await execFileAsync(
      process.execPath,
      [
        transitionScript,
        "--before",
        beforeFile,
        "--after",
        afterFile,
        "--patch",
        patchFile,
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(verified.stdout)).toMatchObject({
      ok: true,
      changedFields: [`entities.${entityId}.lockMode`],
    });

    const tampered = structuredClone(after);
    tampered.entities[0]!.visible = !tampered.entities[0]!.visible;
    await writeFile(afterFile, JSON.stringify(tampered));

    await expect(
      execFileAsync(
        process.execPath,
        [
          transitionScript,
          "--before",
          beforeFile,
          "--after",
          afterFile,
          "--patch",
          patchFile,
        ],
        { encoding: "utf8" },
      ),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(
        `"unexpectedDifferences":["entities.${entityId}.visible"]`,
      ),
    });
  });
});

describe("verification test reference extraction", () => {
  it.each([
    { label: "POSIX", reference: "tests/foo.test.ts" },
    { label: "Windows", reference: String.raw`tests\foo.test.ts` },
  ])("normalizes $label references", ({ reference }) => {
    expect(extractVerificationTestReferences(reference)).toEqual([
      "tests/foo.test.ts",
    ]);
  });

  it("does not truncate longer path tokens into valid test references", () => {
    const invalidReferences = [
      "tests/foo.test.ts.bak",
      "tests/foo.test.tsx",
      "tests/foo.test.ts-backup",
      "tests/foo.test.ts/notes",
      "prefix-tests/foo.test.ts",
    ].join("\n");

    expect(extractVerificationTestReferences(invalidReferences)).toEqual([]);
  });

});

describe("Skill host-semantic documentation", () => {
  it("publishes one bounded executable v0.7 Patch source-integrity gate", async () => {
    const [releaseNote, verificationGuide] = await Promise.all([
      readFile(path.resolve("docs/releases/v0.7.0.md"), "utf8"),
      readFile(path.resolve("docs/verification.md"), "utf8"),
    ]);
    const focusedGate = markdownSectionAfterHeading(
      verificationGuide,
      "v0.7.0 Patch source-integrity gate",
    );
    const command = fencedCodeBlock(focusedGate, "powershell");
    const referencedTestFiles = extractVerificationTestReferences(command);
    const expectedTestFiles = [
      "tests/actor-puppet-patch.test.ts",
      "tests/scene-session.test.ts",
      "tests/server-api-health.test.ts",
      "tests/structured-submission-cli.test.ts",
      "tests/structured-submission.test.ts",
    ];
    const missingTestFiles = (
      await Promise.all(
        referencedTestFiles.map(async (filePath) => {
          try {
            return (await stat(path.resolve(filePath))).isFile()
              ? undefined
              : filePath;
          } catch {
            return filePath;
          }
        }),
      )
    ).filter((filePath): filePath is string => filePath !== undefined);
    const checklistRows = new Map(
      [...focusedGate.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|$/gmu)].map(
        ([, key, value]) => [key, value],
      ),
    );

    expect(focusedGate).not.toBe("");
    expect(command).toMatch(/^pnpm exec vitest run /u);
    expect(referencedTestFiles).toEqual(expectedTestFiles);
    expect(
      missingTestFiles,
      `The v0.7 source-integrity gate references missing test files:\n${missingTestFiles.join("\n")}`,
    ).toEqual([]);
    expect([...checklistRows.keys()]).toEqual([
      "v1-v4",
      "v5",
      "forwarding",
      "stable-source",
      "carrier-boundary",
    ]);
    const v1ToV4 = checklistRows.get("v1-v4") ?? "";
    expect(v1ToV4).toContain("canonical v6 Patch");
    expect(v1ToV4).toContain("directly");
    expect(v1ToV4).not.toContain("sanitized v5 compatibility payload");
    const v5 = checklistRows.get("v5") ?? "";
    expect(v5).toContain("only v5");
    expect(v5).toContain("sanitized v5 compatibility payload");
    expect(v5).toContain("reparse");
    expect(v5).toContain("canonical equivalence");
    for (const phrase of [
      "Raw legacy subtrees",
      "unknown markers",
      "input paths",
      "never forwarded",
    ]) {
      expect(checklistRows.get("forwarding")).toContain(phrase);
    }
    for (const phrase of [
      "Raw Session",
      "API",
      "direct apply",
      "same stable Patch snapshot",
    ]) {
      expect(checklistRows.get("stable-source")).toContain(phrase);
    }
    for (const phrase of [
      "transient carrier",
      "public JSON Schema",
      "SceneSpec",
      "history",
      "persistence",
    ]) {
      expect(checklistRows.get("carrier-boundary")).toContain(phrase);
    }
    const releaseLink =
      "[v0.7.0 Patch source-integrity gate](../verification.md#v070-patch-source-integrity-gate)";
    const releaseGateReference =
      releaseNote
        .split(/\r?\n/u)
        .find((line) => line.includes(releaseLink)) ?? "";
    expect(releaseGateReference).toContain(releaseLink);
    for (const phrase of [
      "v1-v4",
      "canonical v6 Patch",
      "directly",
      "only v5",
      "sanitized v5 compatibility payload",
    ]) {
      expect(releaseGateReference).toContain(phrase);
    }
  });

  it("separates dated current and historical v0.7 evidence", async () => {
    const sources = await Promise.all([
      readFile(path.resolve("docs/releases/v0.7.0.md"), "utf8"),
      readFile(path.resolve("docs/verification.md"), "utf8"),
    ]);

    for (const source of sources) {
      const latest = markdownSectionAfterHeading(
        source,
        "Latest fresh evidence — 2026-08-01",
      );
      const historical = markdownSectionAfterHeading(
        source,
        "Historical evidence — 2026-07-31",
      );

      expect(latest).toContain("pnpm verify");
      expect(latest).toContain("79 test files");
      expect(latest).toContain("1,809 tests");
      expect(latest).toContain("242 files");
      expect(latest).toContain("zero findings");
      expect(historical).not.toMatch(
        /79 test files|1,809 tests|242 files|revision 63/iu,
      );
    }
  });

  it("teaches the complete host-only Actor Blueprint workflow without persisting a file path", async () => {
    const [skill, blueprintReference, sceneAuthoring, patchAuthoring, visualQa] =
      await Promise.all([
        readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
        readFile(
          path.join(referenceDirectory, "actor-blueprints.md"),
          "utf8",
        ),
        readFile(path.join(referenceDirectory, "scene-authoring.md"), "utf8"),
        readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
        readFile(path.join(referenceDirectory, "visual-qa.md"), "utf8"),
      ]);
    const guidance = [
      skill,
      blueprintReference,
      sceneAuthoring,
      patchAuthoring,
      visualQa,
    ].join("\n");

    expect(skill).toContain(
      "SceneSpec, ScenePatch, and IntentReport schema version 6",
    );
    expect(skill).toContain(
      "Use a slot, label, or alias only in Host Codex to locate the snapshot actor.",
    );
    expect(skill).toContain(
      "Use `actor.pose.set { op, entityId, value }` as the sole actor-operation target-field exception.",
    );
    expect(guidance).toContain("blueprint validate --file");
    expect(guidance).toMatch(
      /Host-only[\s\S]*source path[\s\S]*never[\s\S]*(?:SceneSpec|ScenePatch|IntentReport|history|diagnostics|logs|screenshots)/iu,
    );
    expect(guidance).toMatch(
      /same SHA-256[\s\S]*reuse[\s\S]*same blueprintId[\s\S]*different SHA-256[\s\S]*ACTOR_BLUEPRINT_ID_CONFLICT/iu,
    );
    expect(guidance).toContain("actor.blueprint.register");
    expect(guidance).toContain("blueprintInstance");
    expect(guidance).toContain("actor.variant.set");
    expect(guidance).toMatch(
      /one resolved actor projection[\s\S]*render[\s\S]*bounds[\s\S]*contact[\s\S]*composition[\s\S]*diagnostics/iu,
    );
    expect(guidance).toMatch(
      /Overview[\s\S]*Local[\s\S]*Shot Preview[\s\S]*browser-rendered final camera/iu,
    );
    expect(guidance).toMatch(
      /no automatic garbage collection|no blueprint removal operation/iu,
    );
  });

  it("routes natural-language creation and modification through host-authored submissions", async () => {
    const referenceFiles = (await readdir(referenceDirectory))
      .filter((fileName) => fileName.endsWith(".md"))
      .map((fileName) => path.join(referenceDirectory, fileName));
    const [skill, cliContract, ...currentGuidance] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "cli-contract.md"), "utf8"),
      ...[
        path.resolve("README.md"),
        path.resolve("AGENTS.md"),
        path.resolve("docs/verification.md"),
        ...referenceFiles,
      ].map((filePath) => readFile(filePath, "utf8")),
    ]);
    const combinedGuidance = [skill, ...currentGuidance].join("\n");

    expect(skill).toMatch(/host Codex is the sole semantic authority/iu);
    expect(skill).toContain("scene submit --file");
    expect(skill).toContain("patch submit --file");
    expect(skill).toMatch(/account or KEY mode/iu);
    expect(skill).toMatch(/never inspect/iu);
    expect(skill).toMatch(/never pass/iu);
    expect(combinedGuidance).not.toMatch(
      /\bshot\s+(?:create|modify)\b[^\n]*--text/iu,
    );
    expect(combinedGuidance).not.toMatch(/\bprofile\s+resolve\b/iu);
    expect(combinedGuidance).not.toMatch(/--profile\b/iu);

    expect(cliContract).toMatch(/already-structured automation only/iu);
    expect(cliContract).toMatch(
      /scene create --file[\s\S]*already-structured automation/iu,
    );
    expect(cliContract).toMatch(
      /patch apply --file[\s\S]*already-structured automation/iu,
    );
  });

  it("documents generated schema annotations without weakening Host authority", async () => {
    const [skill, sceneAuthoring, actorBlueprints, patchAuthoring] =
      await Promise.all([
        readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
        readFile(path.join(referenceDirectory, "scene-authoring.md"), "utf8"),
        readFile(path.join(referenceDirectory, "actor-blueprints.md"), "utf8"),
        readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
      ]);
    const guidance = [
      skill,
      sceneAuthoring,
      actorBlueprints,
      patchAuthoring,
    ].join("\n");

    expect(skill).toMatch(/generated JSON Schema[\s\S]*structural contract/iu);
    expect(guidance).toContain("x-shubi-resolved-stature");
    expect(guidance).toContain("x-shubi-limb-hierarchy");
    expect(guidance).toMatch(
      /Ajv[\s\S]*cannot[\s\S]*(?:cross-snapshot|resolved stature)[\s\S]*limb hierarchy/iu,
    );
    expect(guidance).toMatch(
      /final acceptance[\s\S]*runtime Zod refinement/iu,
    );
    expect(guidance).toMatch(
      /Host Codex[\s\S]*author[\s\S]*correctly[\s\S]*never rely[\s\S]*runtime[\s\S]*(?:infer|repair)/iu,
    );
  });

  it("resolves an explicit relative external profile before the Skill cwd switch", async () => {
    const [skill, externalProfiles] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(
        path.join(referenceDirectory, "external-profiles.md"),
        "utf8",
      ),
    ]);

    expect(skill).toMatch(
      /before changing to (?:this|the) Skill directory[\s\S]*relative external profile[\s\S]*current working project[\s\S]*host-only absolute path/iu,
    );
    expect(externalProfiles).toMatch(
      /relative path[\s\S]*current working project[\s\S]*before changing to (?:this|the) Skill directory[\s\S]*host-only absolute path/iu,
    );
    expect(externalProfiles).toMatch(
      /never pass[\s\S]*profile path[\s\S]*Director runtime/iu,
    );
  });

  it("documents portable relative files and rejects Windows drive-relative forms", async () => {
    const guidance = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "cli-contract.md"), "utf8"),
      readFile(path.resolve("README.md"), "utf8"),
    ]);

    for (const source of guidance) {
      expect(source).toMatch(
        /portable(?: or native)? relative `--file`/iu,
      );
      expect(source).not.toMatch(/every relative `--file`/iu);
      expect(source).toMatch(
        /Windows drive-relative paths are rejected/iu,
      );
      expect(source).toMatch(
        /portable relative path or a fully absolute path supplied by the user/iu,
      );
      expect(source).not.toMatch(
        /(?:^|[\s`"'(])[a-z]:[\\/][^\s`]+/imu,
      );
    }
  });

  it("documents a canonical JSON digest tool matching the wrapper", async () => {
    const directory = await temporaryDirectory();
    const schemaFile = path.join(
      generatedSchemaDirectory,
      "intent-report.schema.json",
    );
    const reformattedSchemaFile = path.join(
      directory,
      "intent-report.reformatted.schema.json",
    );
    const [schemaSource, wrapperSource, planSource] = await Promise.all([
      readFile(schemaFile, "utf8"),
      readFile(path.join(skillDirectory, "scripts", "director.mjs"), "utf8"),
      readFile(actorLimbPlan, "utf8"),
    ]);
    await writeFile(
      reformattedSchemaFile,
      `${JSON.stringify(JSON.parse(schemaSource), null, 4)}\r\n`,
      "utf8",
    );

    const [generatedDigest, reformattedDigest] = await Promise.all([
      execFileAsync(process.execPath, [canonicalJsonDigestScript, schemaFile], {
        encoding: "utf8",
      }),
      execFileAsync(
        process.execPath,
        [canonicalJsonDigestScript, reformattedSchemaFile],
        { encoding: "utf8" },
      ),
    ]);
    const expectedDigest =
      /const expectedIntentReportSchemaDigest =\s*\r?\n\s*"([0-9a-f]{64})";/u.exec(
        wrapperSource,
      )?.[1];

    expect(expectedDigest).toBe(
      "cb84ecb22395a8382eb20f5d8cc8f741062256f46174a6b11c52f5877e245ec2",
    );
    expect(generatedDigest.stdout.trim()).toBe(expectedDigest);
    expect(reformattedDigest.stdout.trim()).toBe(expectedDigest);
    expect(planSource).toContain(
      "node scripts/canonical-json-sha256.mjs .agents/skills/shubi-shot-director/references/generated/intent-report.schema.json",
    );
    expect(planSource).not.toMatch(
      /Get-FileHash[^\r\n]*intent-report\.schema\.json/iu,
    );
  });

  it("aligns generated nested schema versions with runtime.json", async () => {
    const [runtime, sceneSchema, patchSchema, intentSchema, sceneEnvelope, patchEnvelope] =
      await Promise.all([
        readFile(path.join(skillDirectory, "runtime.json"), "utf8"),
        readFile(
          path.join(generatedSchemaDirectory, "scene-spec.schema.json"),
          "utf8",
        ),
        readFile(
          path.join(generatedSchemaDirectory, "scene-patch.schema.json"),
          "utf8",
        ),
        readFile(
          path.join(generatedSchemaDirectory, "intent-report.schema.json"),
          "utf8",
        ),
        readFile(
          path.join(
            generatedSchemaDirectory,
            "scene-submission.schema.json",
          ),
          "utf8",
        ),
        readFile(
          path.join(
            generatedSchemaDirectory,
            "patch-submission.schema.json",
          ),
          "utf8",
        ),
      ]);
    const runtimeManifest = JSON.parse(runtime) as {
      sceneSchemaVersion: number;
      patchSchemaVersion: number;
      intentReportSchemaVersion: number;
    };
    const parsedSceneSchema = JSON.parse(sceneSchema) as JsonSchemaNode;
    const parsedPatchSchema = JSON.parse(patchSchema) as JsonSchemaNode;
    const parsedIntentSchema = JSON.parse(intentSchema) as JsonSchemaNode;
    const parsedSceneEnvelope = JSON.parse(sceneEnvelope) as JsonSchemaNode;
    const parsedPatchEnvelope = JSON.parse(patchEnvelope) as JsonSchemaNode;

    expect(runtimeManifest).toMatchObject({
      sceneSchemaVersion: SCENE_SCHEMA_VERSION,
      patchSchemaVersion: PATCH_SCHEMA_VERSION,
      intentReportSchemaVersion: INTENT_REPORT_SCHEMA_VERSION,
    });
    expect(nestedConst(parsedSceneSchema, "schemaVersion")).toBe(
      SCENE_SCHEMA_VERSION,
    );
    expect(nestedConst(parsedPatchSchema, "schemaVersion")).toBe(
      PATCH_SCHEMA_VERSION,
    );
    expect(nestedConst(parsedIntentSchema, "schemaVersion")).toBe(
      INTENT_REPORT_SCHEMA_VERSION,
    );
    expect(
      nestedConst(parsedSceneEnvelope, "intentReport", "schemaVersion"),
    ).toBe(INTENT_REPORT_SCHEMA_VERSION);
    expect(nestedConst(parsedSceneEnvelope, "scene", "schemaVersion")).toBe(
      SCENE_SCHEMA_VERSION,
    );
    expect(
      nestedConst(parsedPatchEnvelope, "intentReport", "schemaVersion"),
    ).toBe(INTENT_REPORT_SCHEMA_VERSION);
    expect(nestedConst(parsedPatchEnvelope, "patch", "schemaVersion")).toBe(
      PATCH_SCHEMA_VERSION,
    );
  });

  it("publishes the canonical v6 SceneSpec lock and actor puppet schema contract", async () => {
    const [sceneSource, patchSource, intentSource] = await Promise.all([
      readFile(
        path.join(generatedSchemaDirectory, "scene-spec.schema.json"),
        "utf8",
      ),
      readFile(
        path.join(generatedSchemaDirectory, "scene-patch.schema.json"),
        "utf8",
      ),
      readFile(
        path.join(generatedSchemaDirectory, "intent-report.schema.json"),
        "utf8",
      ),
    ]);
    const sceneSchema = JSON.parse(sceneSource) as JsonSchemaNode;
    const patchSchema = JSON.parse(patchSource) as JsonSchemaNode;
    const intentSchema = JSON.parse(intentSource) as JsonSchemaNode;

    expect(nestedConst(sceneSchema, "schemaVersion")).toBe(6);
    expect(sceneSource).not.toMatch(/"locked"/u);
    const sceneLockModes = propertySchemas(sceneSchema, "lockMode");
    expect(sceneLockModes.length).toBeGreaterThan(0);
    for (const lockMode of sceneLockModes) {
      expect(lockMode.enum).toEqual(["none", "workflow", "user"]);
    }
    const entitySchemas = objectSchemasWithProperties(sceneSchema, [
      "id",
      "kind",
      "visible",
    ]);
    expect(entitySchemas.length).toBeGreaterThan(0);
    for (const entitySchema of entitySchemas) {
      expect(entitySchema.required).toContain("lockMode");
    }

    expect(nestedConst(patchSchema, "schemaVersion")).toBe(6);
    expect(patchSchema.required).toContain("preserveLock");
    expect(patchSchema.properties?.operations?.maxItems).toBe(256);
    expect(patchSource).not.toMatch(/"locked"/u);
    const patchLockModes = propertySchemas(patchSchema, "lockMode");
    expect(patchLockModes.length).toBeGreaterThan(0);
    for (const lockMode of patchLockModes) {
      expect(lockMode.enum).toEqual(["none", "workflow", "user"]);
    }

    expect(nestedConst(intentSchema, "schemaVersion")).toBe(6);
    expect(intentSource).toContain('"entity.lockMode"');
    expect(intentSource).not.toContain('"entity.locked"');
    expect(
      propertySchemas(intentSchema, "operationIndex").some(
        ({ maximum }) => maximum === 255,
      ),
    ).toBe(true);

    const [limbPresenceSchema] = propertySchemas(
      sceneSchema,
      "limbPresence",
    );
    expect(limbPresenceSchema).toBeDefined();
    expect(limbPresenceSchema?.required).toEqual(ACTOR_LIMB_PART_IDS);
    expect(limbPresenceSchema?.additionalProperties).toBe(false);
    expect(Object.keys(limbPresenceSchema?.properties ?? {})).toEqual(
      ACTOR_LIMB_PART_IDS,
    );
    for (const partId of ACTOR_LIMB_PART_IDS) {
      expect(limbPresenceSchema?.properties?.[partId]?.enum).toEqual([
        "present",
        "absent",
      ]);
    }

    const limbOperations = objectSchemasWithProperties(patchSchema, [
      "op",
      "actorId",
      "updates",
    ]).filter(
      (schema) =>
        schema.properties?.op?.const === "actor.limb-presence.set",
    );
    expect(limbOperations).toHaveLength(1);
    const updatesSchema = limbOperations[0]?.properties?.updates;
    expect(limbOperations[0]?.additionalProperties).toBe(false);
    expect(updatesSchema?.additionalProperties).toBe(false);
    expect(updatesSchema?.minProperties).toBe(1);
    expect(updatesSchema?.maxProperties).toBe(12);
    expect(Object.keys(updatesSchema?.properties ?? {})).toEqual(
      ACTOR_LIMB_PART_IDS,
    );
    for (const partId of ACTOR_LIMB_PART_IDS) {
      expect(updatesSchema?.properties?.[partId]?.enum).toEqual([
        "present",
        "absent",
      ]);
    }

    expect(intentSource).toContain('"actor-limb-presence"');
    for (const partId of ACTOR_LIMB_PART_IDS) {
      expect(intentSource).toContain(
        `"entity.body.limbPresence.${partId}"`,
      );
    }

    for (const source of [sceneSource, patchSource, intentSource]) {
      expect(source).not.toMatch(
        /"(?:prosthesis|replacement|mechanical|socket|customMesh|replacementMesh|sourceWording|profilePath|alias)[^"]*"\s*:/iu,
      );
    }
  });

  it("teaches automatic per-conversation scene workspaces", async () => {
    const [skill, cliContract, recovery] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "cli-contract.md"), "utf8"),
      readFile(
        path.join(referenceDirectory, "recovery-and-concurrency.md"),
        "utf8",
      ),
    ]);
    const guidance = [skill, cliContract, recovery].join("\n");

    expect(skill).toMatch(
      /separate Codex conversations[\s\S]*separate workspaces/iu,
    );
    expect(skill).toContain("workspace current");
    expect(skill).not.toContain("Require application version 0.7.0");
    expect(guidance).toContain("workspace list");
    expect(guidance).toContain("workspace attach --id");
    expect(guidance).toMatch(/raw thread ID[\s\S]*never[\s\S]*runtime/iu);
    expect(guidance).toMatch(/each workspace[\s\S]*Shot Preview/iu);
    expect(guidance).toMatch(/stop[\s\S]*current workspace/iu);
    expect(guidance).toMatch(
      /workspace operations[\s\S]*never create SceneSpec revisions/iu,
    );
  });

  it("teaches the complete workflow and user lock contract", async () => {
    const [
      skill,
      intentReport,
      patchAuthoring,
      recovery,
      sceneAuthoring,
      cliContract,
      readme,
    ] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "intent-report.md"), "utf8"),
      readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
      readFile(
        path.join(referenceDirectory, "recovery-and-concurrency.md"),
        "utf8",
      ),
      readFile(path.join(referenceDirectory, "scene-authoring.md"), "utf8"),
      readFile(path.join(referenceDirectory, "cli-contract.md"), "utf8"),
      readFile(path.resolve("README.md"), "utf8"),
    ]);
    const lockGuidance = [skill, patchAuthoring, recovery, cliContract].join(
      "\n",
    );
    const creationGuidance = [skill, sceneAuthoring, readme].join("\n");

    expect(lockGuidance).toContain("preserveLock: true");
    expect(cliContract).toContain(
      "Every canonical v6 Patch includes `preserveLock`",
    );
    expect(cliContract).not.toContain("in v0.6");
    expect(lockGuidance).toMatch(
      /workflow locks never require user authorization/iu,
    );
    expect(lockGuidance).toMatch(
      /user locks[\s\S]*explicit confirmation[\s\S]*stop-and-ask/iu,
    );
    expect(lockGuidance).toMatch(
      /ordinary natural-language corrections[\s\S]*preserveLock: true/iu,
    );
    expect(lockGuidance).toMatch(
      /USER_LOCKED[\s\S]*stop-and-ask/iu,
    );
    expect(lockGuidance).toMatch(
      /WORKFLOW_LOCKED[\s\S]*re-author[\s\S]*preserveLock: true[\s\S]*not ask (?:the )?user/iu,
    );
    expect(lockGuidance).toMatch(
      /after explicit user confirmation[\s\S]*preserveLock: false[\s\S]*explicit lock-mode transition operations[\s\S]*same atomic Patch/iu,
    );
    expect(lockGuidance).toMatch(/no temporary separate unlock/iu);

    expect(creationGuidance).toMatch(
      /new (?:or|and) unfinished graybox entities[\s\S]*lockMode[\s\S]*none/iu,
    );
    expect(creationGuidance).toMatch(
      /background persistence never creates locks/iu,
    );
    expect(creationGuidance).toMatch(
      /explicit user-facing save[\s\S]*workflow locks[\s\S]*before serialization/iu,
    );

    expect(intentReport).toMatch(/schemaVersion[\s\S]*literal `6`/iu);
    expect(intentReport).toContain("entity.lockMode");
    expect(intentReport).not.toContain("entity.locked");
  });

  it("teaches direct final-camera adjustment in Shot Preview", async () => {
    const skill = await readFile(
      path.join(skillDirectory, "SKILL.md"),
      "utf8",
    );

    expect(skill).toMatch(
      /Shot Preview[\s\S]*automatically owns[\s\S]*no activation toggle/iu,
    );
    expect(skill).toMatch(/six[\s-]*button[\s\S]*movement/iu);
    expect(skill).toMatch(/workflow[\s\S]*preserveLock: true/iu);
    expect(skill).toMatch(/left drag[\s\S]*image plane/iu);
    expect(skill).toMatch(/right drag[\s\S]*orbit/iu);
    expect(skill).toMatch(/wheel[\s\S]*focal length[\s\S]*millimeters/iu);
    expect(skill).toMatch(/PageUp[\s\S]*PageDown/iu);
    expect(skill).toMatch(/user locks[\s\S]*stop/iu);
  });

  it("teaches canonical v6 actor limb presence authoring and visual QA", async () => {
    const [
      skill,
      sceneAuthoring,
      patchAuthoring,
      intentReport,
      externalProfiles,
      visualQa,
    ] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "scene-authoring.md"), "utf8"),
      readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
      readFile(path.join(referenceDirectory, "intent-report.md"), "utf8"),
      readFile(path.join(referenceDirectory, "external-profiles.md"), "utf8"),
      readFile(path.join(referenceDirectory, "visual-qa.md"), "utf8"),
    ]);
    const guidance = [
      skill,
      sceneAuthoring,
      patchAuthoring,
      intentReport,
      externalProfiles,
      visualQa,
    ].join("\n");

    expect(skill).toContain(
      "SceneSpec, ScenePatch, and IntentReport schema version 6",
    );
    expect(guidance).toContain("actor.limb-presence.set");
    expect(guidance).toContain("actor-limb-presence");
    expect(guidance.indexOf("upper_arm_r")).toBeLessThan(
      guidance.indexOf("forearm_r"),
    );
    expect(guidance.indexOf("forearm_r")).toBeLessThan(
      guidance.indexOf("hand_r"),
    );
    expect(guidance).toMatch(
      /absent parent[\s\S]*descendants[\s\S]*absent/iu,
    );
    expect(guidance).toMatch(
      /present child[\s\S]*required ancestors[\s\S]*present/iu,
    );
    expect(guidance).toMatch(
      /explicit parent[\s\S]*absent[\s\S]*descendant[\s\S]*present[\s\S]*LIMB_HIERARCHY_CONFLICT[\s\S]*rewrite[\s\S]*single operation/iu,
    );
    expect(guidance).toMatch(
      /replacement parts|prostheses|mechanical limbs|sockets|custom meshes/iu,
    );
    expect(guidance).toMatch(
      /unsupported[\s\S]*must not[\s\S]*(?:presence|present|absent)/iu,
    );
    expect(guidance).toMatch(
      /ACTOR_LIMB_TARGET_INVALID[\s\S]*refresh[\s\S]*actor[\s\S]*never[\s\S]*fallback[\s\S]*entity/iu,
    );
    expect(guidance).toMatch(
      /hidden geometry|zero scale|detached/iu,
    );
    expect(visualQa).toMatch(
      /Overview[\s\S]*affected Local[\s\S]*Shot Preview/iu,
    );
    expect(visualQa).toMatch(
      /contact[\s\S]*framing[\s\S]*persistence[\s\S]*export/iu,
    );
    expect(externalProfiles).toMatch(
      /anatomy[\s\S]*host memory[\s\S]*canonical generic part states/iu,
    );
    expect(externalProfiles).toMatch(
      /must not[\s\S]*alias profile[\s\S]*runtime input[\s\S]*repository[\s\S]*logs[\s\S]*screenshots[\s\S]*saved source metadata/iu,
    );
  });

  it("teaches the exact target field for every public actor operation", async () => {
    const sources = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
      readFile(path.join(referenceDirectory, "external-profiles.md"), "utf8"),
    ]);

    for (const source of sources) {
      expect(source).toContain("actor.pose.set { op, entityId, value }");
      expect(source).toMatch(
        /actor\.height\.set[\s\S]*actor\.pose\.joints\.set[\s\S]*actor\.limb-presence\.set[\s\S]*actor\.variant\.set[\s\S]*use `actorId`/iu,
      );
      expect(source).not.toMatch(
        /every actor operation `actorId`|every actor operation[\s\S]{0,40}`actorId`/iu,
      );
    }
  });

  it("publishes all eight immutable complete-action recipes", async () => {
    const [skill, sceneAuthoring, patchAuthoring] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "scene-authoring.md"), "utf8"),
      readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
    ]);
    const expectedPoseIds = [
      "pose.standing-neutral-v1",
      "pose.kneeling-lean-v1",
      "pose.seated-v1",
      "pose.lying-supine-v1",
      "pose.leaning-forward-v1",
      "pose.reaching-right-v1",
      "pose.walking-step-v1",
      "pose.crouching-v1",
    ];

    for (const poseId of expectedPoseIds) {
      expect(sceneAuthoring).toContain(poseId);
    }
    for (const source of [skill, sceneAuthoring, patchAuthoring]) {
      expect(source).toContain("references/generated/pose-presets.json");
      expect(source).toContain(
        '{ op: "actor.pose.set", entityId, value: { preset: { registry: "builtin", id, version, parameters: { contactOffsetM } }, joints } }',
      );
      expect(source).toContain(
        "round(resolvedHeightM * contactOffsetHeightRatio, 5)",
      );
      expect(source).toContain(
        "Take `id`, `version`, `joints`, and `contactOffsetHeightRatio` from the generated recipe.",
      );
      expect(source).toContain(
        "Use the ratio only to calculate `contactOffsetM`; do not include `contactOffsetHeightRatio` in the PoseSpec.",
      );
      expect(source).toMatch(/copy[\s\S]*exact immutable[\s\S]*id[\s\S]*version[\s\S]*joints/iu);
      expect(source).toMatch(/never[\s\S]*(?:sparse action|guess quaternions?|invent a preset)/iu);
    }
  });

  it("uses Blueprint instance evidence for required create limb presence", async () => {
    const [sceneAuthoring, intentReport] = await Promise.all([
      readFile(path.join(referenceDirectory, "scene-authoring.md"), "utf8"),
      readFile(path.join(referenceDirectory, "intent-report.md"), "utf8"),
    ]);

    expect(intentReport).toMatch(
      /`actor\.blueprintInstance` \| `actor-blueprint-instance`, `actor-blueprint-variant`, `actor-limb-presence`/u,
    );
    expect(sceneAuthoring).toMatch(
      /required Blueprint limb-presence[\s\S]*actor\.blueprintInstance[\s\S]*evidence/iu,
    );
    expect(sceneAuthoring).toMatch(
      /never invent[\s\S]*nested[\s\S]*override[\s\S]*evidence path/iu,
    );
  });

  it("lists deterministic companion changes without granting host-side extras", async () => {
    const sources = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(referenceDirectory, "patch-authoring.md"), "utf8"),
    ]);

    for (const source of sources) {
      expect(source).toMatch(/requested changes[\s\S]*deterministic companion changes/iu);
      expect(source).toMatch(
        /actor\.pose\.joints\.set[\s\S]*merge[\s\S]*specified joints[\s\S]*pose\.custom-v1[\s\S]*preserv(?:e|es|ing)[\s\S]*preset/iu,
      );
      expect(source).toMatch(
        /actor\.height\.set[\s\S]*actual stature[\s\S]*shoulderWidthM[\s\S]*same (?:height )?ratio[\s\S]*clamp[\s\S]*0\.25[\s\S]*0\.8[\s\S]*contactOffsetM[\s\S]*same ratio/iu,
      );
      expect(source).toMatch(
        /contact (?:is )?active[\s\S]*contact-owned translation/iu,
      );
      expect(source).toMatch(
        /complete action[\s\S]*limb[\s\S]*variant[\s\S]*contact-owned translation/iu,
      );
      expect(source).toMatch(
        /deterministic companion changes[\s\S]*not[\s\S]*Host[\s\S]*additional fields/iu,
      );
    }
  });

  it("publishes generic v6 SceneSpec limb-presence create and modify examples", async () => {
    const intentReport = await readFile(
      path.join(referenceDirectory, "intent-report.md"),
      "utf8",
    );
    const createSubmission = sceneSubmissionSchema.parse(
      fencedJsonAfterHeading(
        intentReport,
        "## Generic scene-submission pattern",
      ),
    );
    const modifySubmission = patchSubmissionSchema.parse(
      fencedJsonAfterHeading(
        intentReport,
        "## Generic limb-presence modify pattern",
      ),
    );
    const actor = createSubmission.scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    expect(actor?.kind).toBe("actor");
    if (!isLegacyActorEntity(actor)) {
      throw new Error("Missing generic create actor.");
    }
    expect(Object.keys(actor.body.limbPresence)).toEqual(
      ACTOR_LIMB_PART_IDS,
    );
    expect(
      createSubmission.intentReport.recognizedConstraints.find(
        ({ kind }) => kind === "actor-limb-presence",
      )?.evidence,
    ).toEqual(
      ACTOR_LIMB_PART_IDS.map((partId) => ({
        type: "entity-property",
        entityId: actor.id,
        path: `entity.body.limbPresence.${partId}`,
      })),
    );
    expect(modifySubmission.patch).toMatchObject({
      schemaVersion: 6,
      preserveLock: true,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: "actor_generic_1",
          updates: {
            upper_arm_r: "absent",
            lower_leg_l: "absent",
            lower_leg_r: "absent",
          },
        },
      ],
    });
    expect(modifySubmission.intentReport.recognizedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "actor-limb-presence",
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        }),
      ]),
    );
  });

  it.each([
    {
      label: "Skill",
      filePath: path.join(skillDirectory, "SKILL.md"),
    },
    {
      label: "patch-authoring reference",
      filePath: path.join(referenceDirectory, "patch-authoring.md"),
    },
  ])(
    "teaches the atomic user-lock mutation sequence in the $label",
    async ({ filePath }) => {
      const source = await readFile(filePath, "utf8");

      expect(source).toMatch(
        /one atomic ScenePatch[\s\S]*preserveLock: false/iu,
      );
      expect(source).toMatch(
        /entity\.flags\.set[\s\S]*user[\s\S]*none[\s\S]*confirmed mutation operations[\s\S]*entity\.flags\.set[\s\S]*none[\s\S]*user/iu,
      );
      expect(source).toMatch(
        /intermediate none[\s\S]*Patch working clone[\s\S]*never[\s\S]*separate revision[\s\S]*event[\s\S]*saved state/iu,
      );
      expect(source).toMatch(
        /protection is intentionally removed[\s\S]*omit (?:the )?(?:final )?relock/iu,
      );
      expect(source).toContain(
        "`preserveLock: false` without explicit lock-mode transitions is not authorization.",
      );
      expect(source).not.toMatch(
        /(?:just|simply)\s+(?:set|use)\s+`?preserveLock:\s*false/iu,
      );
      expect(source).not.toMatch(
        /`?preserveLock:\s*false`?\s+(?:alone\s+)?(?:authorizes|allows|permits|is sufficient)/iu,
      );
      const unsafeTemporaryUnlockLines = source
        .split(/\r?\n/u)
        .filter(
          (line) =>
            /separate temporary unlock/iu.test(line) &&
            !/\b(?:forbidden|never|no|must not|do not)\b/iu.test(line),
        );
      expect(unsafeTemporaryUnlockLines).toEqual([]);
    },
  );

  it.each([
    {
      label: "Skill",
      filePath: path.join(skillDirectory, "SKILL.md"),
    },
    {
      label: "scene-authoring reference",
      filePath: path.join(referenceDirectory, "scene-authoring.md"),
    },
    {
      label: "patch-authoring reference",
      filePath: path.join(referenceDirectory, "patch-authoring.md"),
    },
    {
      label: "recovery reference",
      filePath: path.join(
        referenceDirectory,
        "recovery-and-concurrency.md",
      ),
    },
  ])(
    "teaches the complete workflow-lock lifecycle in the $label",
    async ({ filePath }) => {
      const source = await readFile(filePath, "utf8");

      expect(source).toMatch(/workflow-checkpoint protection/iu);
      expect(source).toMatch(
        /visual acceptance[\s\S]*reviewed and accepted entity subset/iu,
      );
      expect(source).toMatch(
        /Overview[\s\S]*required Local previews[\s\S]*final Shot Preview/iu,
      );
      expect(source).toMatch(
        /explicit user-facing save[\s\S]*all remaining none[\s\S]*before serialization/iu,
      );
      expect(source).toMatch(
        /explicit ScenePatch[\s\S]*preserveLock: false/iu,
      );
      const workflowCreationGuidance = source
        .split(/\r?\n/u)
        .filter(
          (line) =>
            /visual-acceptance.*explicit-save/iu.test(line) &&
            /preserveLock:\s*false/iu.test(line),
        )
        .join("\n");
      expect(workflowCreationGuidance).toMatch(
        /must use an explicit ScenePatch with `preserveLock: false` to create workflow locks/iu,
      );
      expect(workflowCreationGuidance).not.toMatch(
        /\b(?:typically|usually|preferably)\b|may use|when possible/iu,
      );
      expect(source).toMatch(
        /ordinary (?:natural-language )?corrections[\s\S]{0,200}`preserveLock: true`/iu,
      );
      expect(source).toMatch(
        /background(?: and| or|\/) autosave persistence never creates locks/iu,
      );
      expect(source).toMatch(
        /unfinished (?:or|and) unaccepted entities remain none/iu,
      );
      expect(source).toMatch(
        /workflow locks never require confirmation or user authorization/iu,
      );

      const unsafeConfirmationLines = source
        .split(/\r?\n/u)
        .filter(
          (line) =>
            /workflow locks?.*require.*confirmation/iu.test(line) &&
            !/\bnever\b/iu.test(line),
        );
      expect(unsafeConfirmationLines).toEqual([]);
    },
  );

  it("does not silently lock entities in the canonical create reference", async () => {
    const intentReport = await readFile(
      path.join(referenceDirectory, "intent-report.md"),
      "utf8",
    );
    const raw = fencedJsonAfterHeading(
      intentReport,
      "## Generic scene-submission pattern",
    );
    const submission = sceneSubmissionSchema.parse(raw);
    expect(
      submission.scene.entities.every(
        ({ lockMode }) => lockMode === "none",
      ),
    ).toBe(true);
    const silentlyLockedEntityIds = submission.scene.entities
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

    expect(silentlyLockedEntityIds).toEqual([]);
  });

  it("keeps current quoted Skill metadata for the complete graybox workflow", async () => {
    const metadata = await readFile(
      path.join(skillDirectory, "agents/openai.yaml"),
      "utf8",
    );
    expect(metadata).toContain("$shubi-shot-director");
    expect(metadata).toMatch(/stage or revise/iu);
    expect(metadata).toMatch(/graybox/iu);
    expect(metadata).toMatch(/editable limb presence/iu);
    expect(metadata).toMatch(/final camera/iu);
    expect(metadata).not.toMatch(/modular|production assets?/iu);
    const values = metadata
      .split(/\r?\n/u)
      .filter((line) => /^\s+(?:display_name|short_description|default_prompt):/u.test(line));
    expect(values).toHaveLength(3);
    expect(values.every((line) => /:\s*"[^"]*"\s*$/u.test(line))).toBe(
      true,
    );
    const shortDescription = /short_description:\s*"([^"]+)"/u.exec(
      metadata,
    )?.[1];
    expect(shortDescription?.length).toBeGreaterThanOrEqual(25);
    expect(shortDescription?.length).toBeLessThanOrEqual(64);
  });

  it.each([
    {
      filePath:
        "docs/superpowers/specs/2026-07-24-skill-version-compatibility-design.md",
      successor: "2026-07-25-host-semantic-authority-design.md",
    },
    {
      filePath:
        "docs/superpowers/plans/2026-07-24-skill-version-compatibility.md",
      successor: "2026-07-25-host-semantic-authority-v2.md",
    },
  ])("marks $filePath as superseded near the top", async ({ filePath, successor }) => {
    const prefix = (await readFile(path.resolve(filePath), "utf8"))
      .split(/\r?\n/u)
      .slice(0, 12)
      .join("\n");
    expect(prefix).toMatch(/superseded/iu);
    expect(prefix).toContain(successor);
  });
});
