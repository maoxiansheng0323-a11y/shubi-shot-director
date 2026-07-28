import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { ACTOR_LIMB_PART_IDS } from "../src/domain/actor-anatomy";
import { validateIntentCoverage } from "../src/domain/intent-coverage";
import {
  ACTOR_LIMB_EVIDENCE_PATHS,
  ENTITY_EVIDENCE_PATHS_V3,
  ENTITY_EVIDENCE_PATHS_V4,
  INTENT_CONSTRAINT_KINDS_V3,
  INTENT_CONSTRAINT_KINDS_V4,
  INTENT_REPORT_SCHEMA_VERSION,
  intentReportSchema,
  type IntentReport,
} from "../src/domain/intent-report";
import { parseIntentReportInput } from "../src/domain/scene-migrations";
import type { ScenePatch } from "../src/domain/scene-patch";
import type { ActorEntity, SceneSpec } from "../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  createIntentReport,
  createPatchIntentReport,
  createStructuredScene,
  createStructuredTwoActorScene,
} from "./helpers/structured-fixtures";

const expectIntentCode = (
  callback: () => unknown,
  code: string,
): void => {
  try {
    callback();
    throw new Error("Expected an intent submission error.");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
};

const actorLimbPatch = (
  scene: SceneSpec,
  actorId = "actor_generic_1",
): ScenePatch => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId: "patch_actor_limb_intent",
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "natural-language",
  preserveLock: false,
  operations: [
    { op: "scene.title.set", value: "Generic limb study" },
    {
      op: "actor.limb-presence.set",
      actorId,
      updates: { hand_r: "absent" },
    },
  ],
});

describe("IntentReport schema", () => {
  it("parses a strict generic create report", () => {
    const report: IntentReport = createIntentReport();

    expect(intentReportSchema.parse(report)).toEqual(report);
  });

  it("accepts canonical lock-protection evidence for a real entity", () => {
    const scene = createStructuredScene();
    const report = intentReportSchema.parse({
      ...createIntentReport(),
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
      recognizedConstraints: [
        {
          id: "intent_lock_protection_1",
          kind: "lock-protection",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.lockMode",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("exports the canonical v4 limb intent kind and exact evidence paths", () => {
    const paths = ACTOR_LIMB_PART_IDS.map(
      (partId) => `entity.body.limbPresence.${partId}`,
    );

    expect(INTENT_CONSTRAINT_KINDS_V4).toEqual([
      ...INTENT_CONSTRAINT_KINDS_V3,
      "actor-limb-presence",
    ]);
    expect(ACTOR_LIMB_EVIDENCE_PATHS).toEqual(paths);
    expect(new Set(ACTOR_LIMB_EVIDENCE_PATHS).size).toBe(
      ACTOR_LIMB_PART_IDS.length,
    );
    expect(ENTITY_EVIDENCE_PATHS_V4).toEqual([
      ...ENTITY_EVIDENCE_PATHS_V3,
      ...paths,
    ]);
  });

  it("accepts actor limb presence only through canonical v4 paths", () => {
    for (const [index, path] of ACTOR_LIMB_EVIDENCE_PATHS.entries()) {
      const report = createIntentReport({
        recognizedConstraints: [
          {
            id: `intent_actor_limb_${index}`,
            kind: "actor-limb-presence",
            required: true,
            targets: ["actor_generic_1"],
            evidence: [
              {
                type: "entity-property",
                entityId: "actor_generic_1",
                path,
              },
            ],
          },
        ],
      });
      expect(intentReportSchema.safeParse(report).success).toBe(true);
    }
  });

  it("covers a create limb constraint with an exact actor property", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_limb_create_1",
          kind: "actor-limb-presence",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.body.limbPresence.hand_r",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("covers a modify limb constraint only from its exact limb operation", () => {
    const before = createStructuredTwoActorScene();
    const patch = actorLimbPatch(before);
    const after = applyScenePatch(before, patch).next;
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_limb_modify_1",
          kind: "actor-limb-presence",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 1 }],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });

  it("rejects modify limb coverage from an existing property without a limb operation", () => {
    const before = createStructuredScene();
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_actor_limb_property_bypass",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [{ op: "scene.title.set", value: "Unrelated title" }],
    };
    const after = applyScenePatch(before, patch).next;
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_limb_property_bypass_1",
          kind: "actor-limb-presence",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.body.limbPresence.hand_r",
            },
          ],
        },
      ],
    });

    expectIntentCode(
      () => validateIntentCoverage(report, { before, after, patch }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("covers actor limb presence when an actor is added", () => {
    const before = createStructuredScene();
    const actor = before.entities.find(
      (entity): entity is ActorEntity => entity.kind === "actor",
    );
    if (!actor) {
      throw new Error("Missing generic actor fixture.");
    }
    const added = structuredClone(actor);
    added.id = "actor_generic_added_1";
    added.slot = "actor_generic_2";
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_actor_limb_add",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [{ op: "entity.add", value: added }],
    };
    const after = applyScenePatch(before, patch).next;
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_limb_add_1",
          kind: "actor-limb-presence",
          required: true,
          targets: [added.id],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });

  it.each([
    ["prop target", "prop_platform_1", 1],
    ["other actor", "actor_generic_2", 1],
    ["wrong operation index", "actor_generic_1", 0],
  ] as const)(
    "rejects limb patch evidence for a %s",
    (_label, targetId, operationIndex) => {
      const before = createStructuredTwoActorScene();
      const patch = actorLimbPatch(before);
      const after = applyScenePatch(before, patch).next;
      const report = createPatchIntentReport({
        recognizedConstraints: [
          {
            id: "intent_actor_limb_invalid_patch_1",
            kind: "actor-limb-presence",
            required: true,
            targets: [targetId],
            evidence: [{ type: "patch-operation", operationIndex }],
          },
        ],
      });

      expectIntentCode(
        () => validateIntentCoverage(report, { before, after, patch }),
        "INTENT_COVERAGE_INCOMPLETE",
      );
    },
  );

  it("rejects a non-limb operation for actor limb presence", () => {
    const before = createStructuredScene();
    const patch: ScenePatch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_actor_limb_unrelated",
      sceneId: before.sceneId,
      baseRevision: before.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [{ op: "scene.title.set", value: "Unrelated title" }],
    };
    const after = applyScenePatch(before, patch).next;
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_limb_unrelated_1",
          kind: "actor-limb-presence",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expectIntentCode(
      () => validateIntentCoverage(report, { before, after, patch }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
    ["other actor", "actor_generic_1", "actor_generic_2"],
    ["prop", "prop_platform_1", "prop_platform_1"],
  ] as const)(
    "rejects exact limb property evidence on a %s",
    (_label, targetId, evidenceEntityId) => {
      const scene = createStructuredTwoActorScene();
      const report = createIntentReport({
        recognizedConstraints: [
          {
            id: "intent_actor_limb_invalid_property_1",
            kind: "actor-limb-presence",
            required: true,
            targets: [targetId],
            evidence: [
              {
                type: "entity-property",
                entityId: evidenceEntityId,
                path: "entity.body.limbPresence.hand_l",
              },
            ],
          },
        ],
      });

      expectIntentCode(
        () => validateIntentCoverage(report, { after: scene }),
        "INTENT_COVERAGE_INCOMPLETE",
      );
    },
  );

  it.each([
    "prosthesis request",
    "replacement limb request",
    "mechanical limb request",
  ])("fails closed for an unsupported %s", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [],
      unsupportedConstraints: [
        {
          code: "UNSUPPORTED_CONSTRAINT",
          targetIds: ["actor_generic_1"],
        },
      ],
      canApplySafely: false,
    });

    expectIntentCode(
      () => validateIntentCoverage(report, { after: scene }),
      "UNSUPPORTED_DESCRIPTION",
    );
  });

  it.each(["rawPrompt", "profilePath", "aliases"])(
    "rejects forbidden top-level key %s",
    (key) => {
      const report = { ...createIntentReport(), [key]: "marker_secret_value" };

      expect(intentReportSchema.safeParse(report).success).toBe(false);
    },
  );

  it("rejects free-form message fields in nested issue and warning objects", () => {
    const report = createIntentReport({
      operation: "modify",
      allowPartial: true,
      unsupportedConstraints: [
        {
          code: "UNSUPPORTED_CONSTRAINT",
          targetIds: ["actor_generic_1"],
          message: "marker_secret_value",
        } as never,
      ],
      warnings: [
        {
          code: "PARTIAL_APPLICATION",
          targetIds: ["actor_generic_1"],
          message: "marker_secret_value",
        } as never,
      ],
    });

    expect(intentReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects unknown constraint kinds, issue codes, warning codes, and evidence paths", () => {
    const invalidValues = [
      createIntentReport({
        recognizedConstraints: [
          {
            ...createIntentReport().recognizedConstraints[0],
            kind: "marker_secret_value",
          } as never,
        ],
      }),
      createIntentReport({
        operation: "modify",
        allowPartial: true,
        unsupportedConstraints: [
          { code: "MARKER_SECRET_VALUE", targetIds: [] } as never,
        ],
      }),
      createIntentReport({
        warnings: [{ code: "MARKER_SECRET_VALUE", targetIds: [] } as never],
      }),
      createIntentReport({
        recognizedConstraints: [
          {
            ...createIntentReport().recognizedConstraints[0],
            evidence: [
              {
                type: "entity-property",
                entityId: "camera_shot_1",
                path: "marker.secret.value",
              },
            ],
          } as never,
        ],
      }),
    ];

    for (const invalid of invalidValues) {
      expect(intentReportSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts patch-operation index 255 and rejects 256", () => {
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_operation_limit_1",
          kind: "output",
          required: true,
          targets: [],
          evidence: [{ type: "patch-operation", operationIndex: 255 }],
        },
      ],
    });
    const beyondLimit = structuredClone(report);
    beyondLimit.recognizedConstraints[0]!.evidence = [
      { type: "patch-operation", operationIndex: 256 },
    ];

    expect(intentReportSchema.safeParse(report).success).toBe(true);
    expect(intentReportSchema.safeParse(beyondLimit).success).toBe(false);
  });

  it.each([1, 2] as const)(
    "retains the IntentReport v%s patch-operation index limit during migration",
    (schemaVersion) => {
      const legacyReport = {
        ...createPatchIntentReport({
          recognizedConstraints: [
            {
              id: "intent_legacy_operation_limit_1",
              kind: "output",
              required: true,
              targets: [],
              evidence: [{ type: "patch-operation", operationIndex: 127 }],
            },
          ],
        }),
        schemaVersion,
      };
      const beyondLegacyLimit = structuredClone(legacyReport);
      beyondLegacyLimit.recognizedConstraints[0]!.evidence = [
        { type: "patch-operation", operationIndex: 128 },
      ];

      expect(parseIntentReportInput(legacyReport).schemaVersion).toBe(4);
      expect(() => parseIntentReportInput(beyondLegacyLimit)).toThrow();
    },
  );

  it("rejects legacy entity.locked in a canonical report", () => {
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_legacy_lock_path_1",
          kind: "visibility",
          required: false,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.locked",
            } as never,
          ],
        },
      ],
    });

    expect(intentReportSchema.safeParse(report).success).toBe(false);
  });

  it("accepts every initial constraint kind", () => {
    const kinds = [
      "environment",
      "entity-presence",
      "entity-removal",
      "actor-slot",
      "pose",
      "relationship",
      "contact",
      "position",
      "rotation",
      "scale",
      "visibility",
      "camera-height",
      "camera-angle",
      "camera-target",
      "focal-length",
      "framing",
      "output",
      "composition-safety",
    ] as const;

    for (const kind of kinds) {
      const report = createIntentReport({
        recognizedConstraints: [
          {
            id: `intent_${kind.replaceAll("-", "_")}_1`,
            kind,
            required: false,
            targets: [],
            evidence: [],
          },
        ],
      });
      expect(intentReportSchema.safeParse(report).success).toBe(true);
    }
  });

  it("accepts generic spatial intent without assigning room semantics", () => {
    const report = {
      ...createIntentReport(),
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
      recognizedConstraints: [
        {
          id: "intent_region_alpha_1",
          kind: "spatial-region",
          required: true,
          targets: ["region_alpha"],
          evidence: [
            {
              type: "scene-property",
              path: "scene.spatialLayout.regions",
            },
          ],
        },
      ],
    };

    expect(intentReportSchema.safeParse(report).success).toBe(true);
  });

  it.each([1, 2] as const)(
    "migrates IntentReport v%s without inventing or reordering semantics",
    (schemaVersion) => {
      const legacyReport = {
        schemaVersion,
        operation: "modify",
        allowPartial: true,
        recognizedConstraints: [
          {
            id: "intent_legacy_visibility_1",
            kind: "visibility",
            required: false,
            targets: ["actor_generic_1"],
            evidence: [
              {
                type: "entity-property",
                entityId: "actor_generic_1",
                path: "entity.locked",
              },
              { type: "patch-operation", operationIndex: 1 },
            ],
          },
          {
            id: "intent_legacy_output_1",
            kind: "output",
            required: true,
            targets: [],
            evidence: [{ type: "patch-operation", operationIndex: 2 }],
          },
        ],
        unsupportedConstraints: [
          {
            code: "UNSUPPORTED_CONSTRAINT",
            targetIds: ["prop_block_1"],
          },
          {
            code: "UNAPPLIED_CONSTRAINT",
            targetIds: ["actor_generic_1"],
          },
        ],
        unresolvedRelations: [
          {
            code: "UNRESOLVED_RELATION",
            targetIds: ["actor_generic_1", "prop_block_1"],
          },
        ],
        warnings: [
          {
            code: "PARTIAL_APPLICATION",
            targetIds: ["actor_generic_1"],
          },
          {
            code: "APPROXIMATE_PLACEMENT",
            targetIds: ["prop_block_1"],
          },
        ],
        canApplySafely: false,
      } as const;

      const migrated = parseIntentReportInput(legacyReport);

      expect(migrated).toEqual({
        ...legacyReport,
        schemaVersion: 4,
        recognizedConstraints: [
          {
            ...legacyReport.recognizedConstraints[0],
            evidence: [
              {
                type: "entity-property",
                entityId: "actor_generic_1",
                path: "entity.lockMode",
              },
              { type: "patch-operation", operationIndex: 1 },
            ],
          },
          legacyReport.recognizedConstraints[1],
        ],
      });
      expect(
        migrated.recognizedConstraints.map(({ kind }) => kind),
      ).not.toContain("lock-protection");
    },
  );

  it("keeps v2 spatial constraints while migrating only the legacy lock path", () => {
    const legacyReport = {
      ...createIntentReport(),
      schemaVersion: 2,
      recognizedConstraints: [
        {
          id: "intent_region_alpha_1",
          kind: "spatial-region",
          required: true,
          targets: ["region_alpha"],
          evidence: [
            {
              type: "scene-property",
              path: "scene.spatialLayout.regions",
            },
          ],
        },
      ],
    };

    expect(parseIntentReportInput(legacyReport)).toEqual({
      ...legacyReport,
      schemaVersion: 4,
    });
  });

  it("rejects mixed legacy paths and unrecognized report versions", () => {
    const canonicalWithLegacyPath = {
      ...createIntentReport(),
      schemaVersion: 4,
      recognizedConstraints: [
        {
          id: "intent_mixed_canonical_1",
          kind: "visibility",
          required: false,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.locked",
            },
          ],
        },
      ],
    };
    const legacyWithCanonicalPath = {
      ...createIntentReport(),
      schemaVersion: 2,
      recognizedConstraints: [
        {
          id: "intent_mixed_legacy_1",
          kind: "visibility",
          required: false,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.lockMode",
            },
          ],
        },
      ],
    };

    expect(() => parseIntentReportInput(canonicalWithLegacyPath)).toThrow();
    expect(() => parseIntentReportInput(legacyWithCanonicalPath)).toThrow();
    expect(() =>
      parseIntentReportInput({
        ...createIntentReport(),
        schemaVersion: 5,
      }),
    ).toThrow();
  });
});
