import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  INTENT_REPORT_SCHEMA_VERSION,
  intentReportSchema,
} from "../src/domain/intent-report";
import {
  scenePatchSchema,
  type ScenePatch,
} from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";
import {
  patchSubmissionSchema,
  sceneSubmissionSchema,
} from "../src/domain/scene-submission";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";

const execFileAsync = promisify(execFile);
const auditScript = path.resolve(
  ".agents/skills/shubi-shot-director/scripts/audit-generic-output.mjs",
);
const transitionScript = path.resolve(
  ".agents/skills/shubi-shot-director/scripts/verify-transition.mjs",
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

const GENERATED_SCHEMA_CASES: Array<{
  fileName: string;
  schema: z.ZodType;
}> = [
  { fileName: "scene-spec.schema.json", schema: sceneSpecSchema },
  { fileName: "scene-patch.schema.json", schema: scenePatchSchema },
  { fileName: "intent-report.schema.json", schema: intentReportSchema },
  {
    fileName: "scene-submission.schema.json",
    schema: sceneSubmissionSchema,
  },
  {
    fileName: "patch-submission.schema.json",
    schema: patchSubmissionSchema,
  },
];

type JsonSchemaNode = {
  const?: unknown;
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

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shot-skill-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Skill deterministic scripts", () => {
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
  });

  it("verifies one-revision minimal Patch transitions", async () => {
    const directory = await temporaryDirectory();
    const before = createDefaultScene();
    const patch: ScenePatch = {
      schemaVersion: 1,
      patchId: "patch_transition_test",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "system",
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
});

describe("Skill host-semantic documentation", () => {
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

  it.each(GENERATED_SCHEMA_CASES)(
    "generates $fileName directly from the authoritative Zod schema",
    async ({ fileName, schema }) => {
      const generated = JSON.parse(
        await readFile(path.join(generatedSchemaDirectory, fileName), "utf8"),
      ) as unknown;
      expect(generated).toEqual(z.toJSONSchema(schema));
    },
  );

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

  it("keeps the Skill metadata trigger and graybox staging description", async () => {
    const metadata = await readFile(
      path.join(skillDirectory, "agents/openai.yaml"),
      "utf8",
    );
    expect(metadata).toContain("$shubi-shot-director");
    expect(metadata).toMatch(/graybox/iu);
    expect(metadata).toMatch(/stag/iu);
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
