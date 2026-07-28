import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { SceneSession } from "../server/scene-session";
import { validateIntentCoverage } from "../src/domain/intent-coverage";
import { INTENT_REPORT_SCHEMA_VERSION } from "../src/domain/intent-report";
import type { SceneOperation } from "../src/domain/scene-patch";
import {
  IntentSubmissionError,
  normalizePatchSubmissionInput,
  parsePatchSubmission,
  parseSceneSubmission,
} from "../src/domain/scene-submission";
import {
  createIntentReport,
  createPatchIntentReport,
  createPatchSubmission,
  createSceneSubmission,
  createStructuredPatch,
  createStructuredScene,
} from "./helpers/structured-fixtures";

const expectSubmissionCode = (
  action: () => unknown,
  code: IntentSubmissionError["code"],
): void => {
  try {
    action();
    throw new Error("Expected submission to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(IntentSubmissionError);
    expect(error).toMatchObject({ code });
  }
};

describe("structured scene submission policy", () => {
  it("parses a valid scene submission and validates its evidence", () => {
    const submission = createSceneSubmission();

    expect(parseSceneSubmission(submission)).toEqual(submission);
  });

  it("maps strict schema failures to INTENT_REPORT_INVALID", () => {
    const submission = {
      ...createSceneSubmission(),
      intentReport: {
        ...createIntentReport(),
        rawPrompt: "marker_secret_value",
      },
    };

    expectSubmissionCode(
      () => parseSceneSubmission(submission),
      "INTENT_REPORT_INVALID",
    );
  });

  it("preserves scene payload ZodError when the intent report is valid", () => {
    const submission = createSceneSubmission();
    submission.scene = { ...submission.scene, title: "" };

    expect(() => parseSceneSubmission(submission)).toThrowError(ZodError);
  });

  it("preserves patch payload ZodError when the intent report is valid", () => {
    const submission = createPatchSubmission();
    submission.patch = { ...submission.patch, baseRevision: -1 };

    expect(() => parsePatchSubmission(submission)).toThrowError(ZodError);
  });

  it("preserves strict envelope ZodError for unknown submission keys", () => {
    expect(() =>
      parseSceneSubmission({
        ...createSceneSubmission(),
        rawPrompt: "marker_secret_value",
      }),
    ).toThrowError(ZodError);
    expect(() =>
      parsePatchSubmission({
        ...createPatchSubmission(),
        profilePath: "marker_secret_value",
      }),
    ).toThrowError(ZodError);
  });

  it("rejects partial create reports", () => {
    const submission = createSceneSubmission();
    submission.intentReport = createIntentReport({ allowPartial: true });

    expectSubmissionCode(
      () => parseSceneSubmission(submission),
      "INTENT_REPORT_INVALID",
    );
  });

  it("checks unsafe policy before invalid coverage", () => {
    const submission = createSceneSubmission();
    submission.intentReport = createIntentReport({
      canApplySafely: false,
      recognizedConstraints: [
        {
          id: "intent_invalid_coverage_1",
          kind: "camera-height",
          required: true,
          targets: ["marker_missing_entity"],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => parseSceneSubmission(submission),
      "UNSUPPORTED_DESCRIPTION",
    );
  });

  it("rejects unapplied issues when partial application is disabled", () => {
    for (const field of [
      "unsupportedConstraints",
      "unresolvedRelations",
    ] as const) {
      const submission = createSceneSubmission();
      submission.intentReport = createIntentReport({
        [field]: [
          {
            code:
              field === "unsupportedConstraints"
                ? "UNSUPPORTED_CONSTRAINT"
                : "UNRESOLVED_RELATION",
            targetIds: ["actor_generic_1"],
          },
        ],
      });

      expectSubmissionCode(
        () => parseSceneSubmission(submission),
        "UNSUPPORTED_DESCRIPTION",
      );
    }
  });

  it("allows structured unapplied issue codes for explicitly partial modify reports", () => {
    const submission = createPatchSubmission();
    submission.intentReport = createPatchIntentReport({
      allowPartial: true,
      unsupportedConstraints: [
        {
          code: "UNSUPPORTED_CONSTRAINT",
          targetIds: ["actor_generic_1"],
        },
      ],
      unresolvedRelations: [
        {
          code: "UNRESOLVED_RELATION",
          targetIds: ["actor_generic_1"],
        },
      ],
      warnings: [
        {
          code: "PARTIAL_APPLICATION",
          targetIds: ["actor_generic_1"],
        },
      ],
    });

    expect(parsePatchSubmission(submission)).toEqual(submission);
  });

  it.each([1, 2] as const)(
    "migrates v%s report evidence and preserves every patch operation index",
    (schemaVersion) => {
      const scene = createStructuredScene();
      const legacyOperations = [
        {
          op: "entity.transform.translate",
          entityId: "actor_generic_1",
          deltaM: [0.25, 0, 0],
          referenceSpace: "world",
        },
        {
          op: "entity.flags.set",
          entityId: "actor_generic_1",
          visible: false,
          locked: true,
        },
        {
          op: "scene.output.set",
          value: {
            aspect: { width: 16, height: 9 },
            resolutionPx: { width: 1280, height: 720 },
          },
        },
      ] as const;
      const legacySubmission = {
        intentReport: {
          schemaVersion,
          operation: "modify",
          allowPartial: false,
          recognizedConstraints: [
            {
              id: "intent_legacy_position_1",
              kind: "position",
              required: true,
              targets: ["actor_generic_1"],
              evidence: [{ type: "patch-operation", operationIndex: 0 }],
            },
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
          unsupportedConstraints: [],
          unresolvedRelations: [],
          warnings: [],
          canApplySafely: true,
        },
        patch: {
          schemaVersion,
          patchId: `patch_legacy_submission_v${schemaVersion}`,
          sceneId: scene.sceneId,
          baseRevision: scene.revision,
          source: "natural-language",
          operations: legacyOperations,
        },
      } as const;

      const migrated = normalizePatchSubmissionInput(legacySubmission);
      const operationIndexes = migrated.intentReport.recognizedConstraints
        .flatMap(({ evidence }) => evidence)
        .filter(
          (
            evidence,
          ): evidence is Extract<
            (typeof evidence),
            { type: "patch-operation" }
          > => evidence.type === "patch-operation",
        )
        .map(({ operationIndex }) => operationIndex);

      expect(migrated.intentReport.schemaVersion).toBe(
        INTENT_REPORT_SCHEMA_VERSION,
      );
      expect(
        migrated.intentReport.recognizedConstraints[1]!.evidence[0],
      ).toEqual({
        type: "entity-property",
        entityId: "actor_generic_1",
        path: "entity.lockMode",
      });
      expect(operationIndexes).toEqual([0, 1, 2]);
      for (const operationIndex of operationIndexes) {
        expect(migrated.patch.operations[operationIndex]!.op).toBe(
          legacyOperations[operationIndex]!.op,
        );
      }
      expect(migrated.patch.operations[1]).toEqual({
        op: "entity.flags.set",
        entityId: "actor_generic_1",
        visible: false,
        lockMode: "workflow",
      });
    },
  );
});

describe("deterministic intent coverage", () => {
  it("uses entity.flags.set visible only as visibility evidence", () => {
    const scene = createStructuredScene();
    const patch = {
      ...createStructuredPatch(scene),
      operations: [
        {
          op: "entity.flags.set" as const,
          entityId: "actor_generic_1",
          visible: false,
        },
      ],
    };
    const visibilityReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_visibility_flag_1",
          kind: "visibility",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });
    const lockReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_lock_flag_missing_1",
          kind: "lock-protection",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(visibilityReport, {
        before: scene,
        after: structuredClone(scene),
        patch,
      }),
    ).not.toThrow();
    expectSubmissionCode(
      () =>
        validateIntentCoverage(lockReport, {
          before: scene,
          after: structuredClone(scene),
          patch,
        }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("uses entity.flags.set lockMode only as lock-protection evidence", () => {
    const scene = createStructuredScene();
    const patch = {
      ...createStructuredPatch(scene),
      operations: [
        {
          op: "entity.flags.set" as const,
          entityId: "actor_generic_1",
          lockMode: "workflow" as const,
        },
      ],
    };
    const lockReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_lock_flag_1",
          kind: "lock-protection",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });
    const visibilityReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_visibility_flag_missing_1",
          kind: "visibility",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(lockReport, {
        before: scene,
        after: structuredClone(scene),
        patch,
      }),
    ).not.toThrow();
    expectSubmissionCode(
      () =>
        validateIntentCoverage(visibilityReport, {
          before: scene,
          after: structuredClone(scene),
          patch,
        }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("requires evidence for every required recognized constraint", () => {
    const submission = createSceneSubmission();
    submission.intentReport = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_camera_height_1",
          kind: "camera-height",
          required: true,
          targets: ["camera_shot_1"],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => parseSceneSubmission(submission),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
    {
      type: "entity",
      entityId: "marker_missing_entity",
    },
    {
      type: "entity-property",
      entityId: "marker_missing_entity",
      path: "entity.transform.positionM",
    },
    {
      type: "entity-property",
      entityId: "actor_generic_1",
      path: "camera.heightM",
    },
    {
      type: "scene-property",
      path: "scene.compositionGoals",
    },
    {
      type: "scene-constraint",
      constraintId: "marker_missing_constraint",
    },
  ] as const)("rejects invalid $type evidence", (evidence) => {
    const submission = createSceneSubmission();
    submission.intentReport = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_invalid_evidence_1",
          kind: "position",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [evidence],
        },
      ],
    });

    expectSubmissionCode(
      () => parseSceneSubmission(submission),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("validates target ids against the submitted scene", () => {
    const submission = createSceneSubmission();
    submission.intentReport = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_missing_target_1",
          kind: "entity-presence",
          required: true,
          targets: ["marker_missing_entity"],
          evidence: [
            {
              type: "entity",
              entityId: "actor_generic_1",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => parseSceneSubmission(submission),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("validates patch-operation evidence indices without interpreting text", () => {
    const scene = createStructuredScene();
    const patch = createStructuredPatch(scene);
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_patch_operation_1",
          kind: "output",
          required: true,
          targets: [],
          evidence: [{ type: "patch-operation", operationIndex: 2 }],
        },
      ],
    });

    expectSubmissionCode(
      () =>
        validateIntentCoverage(report, {
          before: scene,
          after: scene,
          patch,
        }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("does not echo marker values in stable coverage errors", () => {
    const marker = "marker_secret_value";
    const submission = createSceneSubmission();
    submission.intentReport = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_marker_1",
          kind: "entity-presence",
          required: true,
          targets: [marker],
          evidence: [{ type: "entity", entityId: marker }],
        },
      ],
    });

    try {
      parseSceneSubmission(submission);
      throw new Error("Expected submission to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(IntentSubmissionError);
      expect((error as Error).message).not.toContain(marker);
      expect(error).toMatchObject({ code: "INTENT_COVERAGE_INCOMPLETE" });
    }
  });

  it("rejects a create target that exists only in an incorrectly supplied before scene", () => {
    const before = createStructuredScene();
    const after = {
      ...structuredClone(before),
      entities: before.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_before_only_target_1",
          kind: "entity-presence",
          required: true,
          targets: ["prop_block_1"],
          evidence: [{ type: "entity", entityId: "actor_generic_1" }],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
    { type: "entity", entityId: "prop_block_1" },
    {
      type: "entity-property",
      entityId: "prop_block_1",
      path: "entity.transform.positionM",
    },
  ] as const)(
    "rejects create $type evidence that exists only in an incorrectly supplied before scene",
    (evidence) => {
      const before = createStructuredScene();
      const after = {
        ...structuredClone(before),
        entities: before.entities.filter(
          (entity) => entity.id !== "prop_block_1",
        ),
      };
      const report = createIntentReport({
        recognizedConstraints: [
          {
            id: "intent_before_only_entity_evidence_1",
            kind: "position",
            required: true,
            targets: ["actor_generic_1"],
            evidence: [evidence],
          },
        ],
      });

      expectSubmissionCode(
        () => validateIntentCoverage(report, { before, after }),
        "INTENT_COVERAGE_INCOMPLETE",
      );
    },
  );

  it("rejects create scene-property evidence that exists only in an incorrectly supplied before scene", () => {
    const before = createStructuredScene();
    before.compositionGoals = {
      framing: {
        mode: "medium",
        targetEntityIds: ["actor_generic_1"],
      },
    };
    const after = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_before_only_scene_property_1",
          kind: "framing",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            { type: "scene-property", path: "scene.compositionGoals" },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("rejects create constraint evidence that exists only in an incorrectly supplied before scene", () => {
    const before = createStructuredScene();
    const after = { ...structuredClone(before), constraints: [] };
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_before_only_constraint_1",
          kind: "contact",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "scene-constraint",
              constraintId: "constraint_ground_actor_1",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("allows modify removal evidence that exists only in the before scene", () => {
    const before = createStructuredScene();
    const after = {
      ...structuredClone(before),
      entities: before.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_removed_entity_1",
          kind: "entity-removal",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.kind",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { before, after })).not.toThrow();
  });

  it("rejects actor-slot evidence from an actor outside the declared prop target", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_slot_wrong_target_1",
          kind: "actor-slot",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "actor.slot",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("rejects a title patch operation as focal-length evidence", () => {
    const scene = createStructuredScene();
    const patch = {
      ...createStructuredPatch(scene),
      operations: [
        {
          op: "scene.title.set" as const,
          value: "Unrelated title",
        },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_focal_title_mismatch_1",
          kind: "focal-length",
          required: true,
          targets: ["camera_shot_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before: scene, after: scene, patch }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("rejects camera lens evidence that operates on a different camera", () => {
    const before = createStructuredScene();
    const firstCamera = before.entities.find(
      (entity) => entity.id === "camera_shot_1" && entity.kind === "camera",
    );
    if (!firstCamera || firstCamera.kind !== "camera") {
      throw new Error("Fixture camera is missing.");
    }
    const secondCamera = {
      ...structuredClone(firstCamera),
      id: "camera_shot_2",
      label: "Second shot camera",
    };
    before.entities.push(secondCamera);
    const patch = {
      ...createStructuredPatch(before),
      operations: [
        {
          op: "camera.lens.set" as const,
          entityId: "camera_shot_2",
          value: { ...secondCamera.lens, focalLengthMm: 70 },
        },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_focal_other_camera_1",
          kind: "focal-length",
          required: true,
          targets: ["camera_shot_1"],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expectSubmissionCode(
      () =>
        validateIntentCoverage(report, {
          before,
          after: structuredClone(before),
          patch,
        }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("does not use a before actor when the final entity with that id is a prop", () => {
    const before = createStructuredScene();
    const replacementProp = before.entities.find(
      (entity) => entity.id === "prop_block_1" && entity.kind === "prop",
    );
    if (!replacementProp || replacementProp.kind !== "prop") {
      throw new Error("Fixture prop is missing.");
    }
    const after = structuredClone(before);
    after.entities = after.entities.map((entity) =>
      entity.id === "actor_generic_1"
        ? {
            ...structuredClone(replacementProp),
            id: "actor_generic_1",
            label: "Replacement prop",
          }
        : entity,
    );
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_final_actor_kind_1",
          kind: "actor-slot",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "actor.slot",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("requires primary kind-specific evidence for required constraints", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_relationship_support_only_1",
          kind: "relationship",
          required: true,
          targets: ["actor_generic_1", "prop_block_1"],
          evidence: [
            { type: "entity", entityId: "actor_generic_1" },
            { type: "entity", entityId: "prop_block_1" },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("requires every declared target to be covered by derived evidence ids", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_relationship_missing_target_1",
          kind: "relationship",
          required: true,
          targets: ["actor_generic_1", "prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.transform.positionM",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("accepts focal-length evidence from camera.lens.set on the declared camera", () => {
    const scene = createStructuredScene();
    const camera = scene.entities.find(
      (entity) => entity.id === "camera_shot_1" && entity.kind === "camera",
    );
    if (!camera || camera.kind !== "camera") {
      throw new Error("Fixture camera is missing.");
    }
    const patch = {
      ...createStructuredPatch(scene),
      operations: [
        {
          op: "camera.lens.set" as const,
          entityId: camera.id,
          value: { ...camera.lens, focalLengthMm: 70 },
        },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_focal_correct_camera_1",
          kind: "focal-length",
          required: true,
          targets: [camera.id],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, {
        before: scene,
        after: structuredClone(scene),
        patch,
      }),
    ).not.toThrow();
  });

  it("accepts entity-removal evidence from the before entity and remove operation", () => {
    const before = createStructuredScene();
    const after = {
      ...structuredClone(before),
      entities: before.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const patch = {
      ...createStructuredPatch(before),
      operations: [
        { op: "entity.remove" as const, entityId: "prop_block_1" },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_remove_operation_1",
          kind: "entity-removal",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            { type: "entity", entityId: "prop_block_1" },
            { type: "patch-operation", operationIndex: 0 },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });

  it("accepts scene.output.set as output evidence", () => {
    const scene = createStructuredScene();
    const patch = {
      ...createStructuredPatch(scene),
      operations: [
        {
          op: "scene.output.set" as const,
          value: {
            aspect: { width: 16 as const, height: 9 as const },
            resolutionPx: { width: 1280, height: 720 },
          },
        },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_output_operation_1",
          kind: "output",
          required: true,
          targets: [],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, {
        before: scene,
        after: structuredClone(scene),
        patch,
      }),
    ).not.toThrow();
  });

  it("accepts entity.add typed transform evidence for its relationship target", () => {
    const before = createStructuredScene();
    const sourceProp = before.entities.find(
      (entity) => entity.id === "prop_block_1" && entity.kind === "prop",
    );
    if (!sourceProp || sourceProp.kind !== "prop") {
      throw new Error("Fixture prop is missing.");
    }
    const addedProp = {
      ...structuredClone(sourceProp),
      id: "prop_block_2",
      label: "Second blocking prop",
    };
    const after = structuredClone(before);
    after.entities.push(addedProp);
    const patch = {
      ...createStructuredPatch(before),
      operations: [{ op: "entity.add" as const, value: addedProp }],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_added_relationship_target_1",
          kind: "relationship",
          required: true,
          targets: ["actor_generic_1", "prop_block_2"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.transform.positionM",
            },
            { type: "patch-operation", operationIndex: 0 },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });

  it("allows modify position evidence to fall back to a before-only target", () => {
    const before = createStructuredScene();
    const after = {
      ...structuredClone(before),
      entities: before.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_before_fallback_position_1",
          kind: "position",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.transform.positionM",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { before, after })).not.toThrow();
  });

  it("rejects create entity-removal evidence that exists only in caller before", () => {
    const before = createStructuredScene();
    const after = {
      ...structuredClone(before),
      entities: before.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_create_before_removal_1",
          kind: "entity-removal",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.kind",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
    "entity.transform.set",
    "entity.transform.translate",
    "entity.transform.rotate",
  ] as const)("accepts %s as relationship evidence", (operationName) => {
    const before = createStructuredScene();
    const actor = before.entities.find(
      (entity) => entity.id === "actor_generic_1" && entity.kind === "actor",
    );
    if (!actor || actor.kind !== "actor") {
      throw new Error("Fixture actor is missing.");
    }
    let operation: SceneOperation;
    switch (operationName) {
      case "entity.transform.set":
        operation = {
          op: operationName,
          entityId: actor.id,
          value: structuredClone(actor.transform),
        };
        break;
      case "entity.transform.translate":
        operation = {
          op: operationName,
          entityId: actor.id,
          deltaM: [0.25, 0, 0],
          referenceSpace: "world",
        };
        break;
      case "entity.transform.rotate":
        operation = {
          op: operationName,
          entityId: actor.id,
          deltaRotation: [0, 0, 0, 1],
          referenceSpace: "world",
        };
        break;
    }
    const patch = {
      ...createStructuredPatch(before),
      operations: [operation],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: `intent_${operationName.replaceAll(".", "_")}_relationship_1`,
          kind: "relationship",
          required: true,
          targets: ["actor_generic_1", "prop_block_1"],
          evidence: [
            { type: "patch-operation", operationIndex: 0 },
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.transform.positionM",
            },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, {
        before,
        after: structuredClone(before),
        patch,
      }),
    ).not.toThrow();
  });

  it("allows same-target generic entity support beside primary focal evidence", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_focal_entity_support_1",
          kind: "focal-length",
          required: true,
          targets: ["camera_shot_1"],
          evidence: [
            { type: "entity", entityId: "camera_shot_1" },
            {
              type: "entity-property",
              entityId: "camera_shot_1",
              path: "camera.lens.focalLengthMm",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("rejects generic entity support as the only required focal evidence", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_focal_entity_only_1",
          kind: "focal-length",
          required: true,
          targets: ["camera_shot_1"],
          evidence: [{ type: "entity", entityId: "camera_shot_1" }],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("allows an optional entity-scoped constraint with no evidence", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_optional_position_1",
          kind: "position",
          required: false,
          targets: ["actor_generic_1"],
          evidence: [],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("does not require optional evidence to cover every valid target", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_optional_relationship_partial_1",
          kind: "relationship",
          required: false,
          targets: ["actor_generic_1", "prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.transform.positionM",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("rejects optional evidence that references an unrelated target", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_optional_unrelated_evidence_1",
          kind: "position",
          required: false,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.transform.positionM",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
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
  ] as const)("rejects empty targets for non-scene-level %s", (kind) => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: `intent_empty_${kind.replaceAll("-", "_")}_1`,
          kind,
          required: false,
          targets: [],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each(["output", "composition-safety"] as const)(
    "allows empty targets for scene-level %s",
    (kind) => {
      const scene = createStructuredScene();
      const report = createIntentReport({
        recognizedConstraints: [
          {
            id: `intent_empty_${kind.replaceAll("-", "_")}_1`,
            kind,
            required: false,
            targets: [],
            evidence: [],
          },
        ],
      });

      expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
    },
  );

  it("requires at least two relationship targets", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_relationship_one_target_1",
          kind: "relationship",
          required: false,
          targets: ["actor_generic_1"],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("requires contact targets to include an actor", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_contact_without_actor_1",
          kind: "contact",
          required: false,
          targets: ["environment_room_1"],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
    ["actor and camera", ["actor_generic_1", "camera_shot_1"], false],
    ["two actors", ["actor_generic_1", "actor_generic_2"], true],
    [
      "three targets",
      ["actor_generic_1", "environment_room_1", "prop_block_1"],
      false,
    ],
  ] as const)("rejects contact target shape with %s", (_label, targets, addActor) => {
    const scene = createStructuredScene();
    if (addActor) {
      const actor = scene.entities.find(
        (entity) => entity.id === "actor_generic_1" && entity.kind === "actor",
      );
      if (!actor || actor.kind !== "actor") {
        throw new Error("Fixture actor is missing.");
      }
      scene.entities.push({
        ...structuredClone(actor),
        id: "actor_generic_2",
        label: "Second generic actor",
        slot: "actor_generic_2",
      });
    }
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_invalid_contact_shape_1",
          kind: "contact",
          required: false,
          targets: [...targets],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it.each([
    ["actor only", ["actor_generic_1"]],
    ["actor then environment", ["actor_generic_1", "environment_room_1"]],
    ["environment then actor", ["environment_room_1", "actor_generic_1"]],
    ["actor then prop", ["actor_generic_1", "prop_block_1"]],
    ["prop then actor", ["prop_block_1", "actor_generic_1"]],
  ] as const)("accepts contact target shape with %s", (_label, targets) => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_valid_contact_shape_1",
          kind: "contact",
          required: false,
          targets: [...targets],
          evidence: [],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("requires framing targets to be actors or props", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_framing_camera_target_1",
          kind: "framing",
          required: false,
          targets: ["camera_shot_1"],
          evidence: [],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("rejects entity-removal when the target still exists after modification", () => {
    const before = createStructuredScene();
    const after = structuredClone(before);
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_removal_still_present_1",
          kind: "entity-removal",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.kind",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("rejects entity-removal when a removed target is re-added with the same id", () => {
    const before = createStructuredScene();
    const prop = before.entities.find(
      (entity) => entity.id === "prop_block_1" && entity.kind === "prop",
    );
    if (!prop || prop.kind !== "prop") {
      throw new Error("Fixture prop is missing.");
    }
    const after = structuredClone(before);
    const patch = {
      ...createStructuredPatch(before),
      operations: [
        { op: "entity.remove" as const, entityId: prop.id },
        { op: "entity.add" as const, value: structuredClone(prop) },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_removal_readded_1",
          kind: "entity-removal",
          required: true,
          targets: [prop.id],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after, patch }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("rejects entity-presence when the target exists only before modification", () => {
    const before = createStructuredScene();
    const after = {
      ...structuredClone(before),
      entities: before.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_presence_before_only_1",
          kind: "entity-presence",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.kind",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("accepts entity-presence when the target exists after modification", () => {
    const after = createStructuredScene();
    const before = {
      ...structuredClone(after),
      entities: after.entities.filter(
        (entity) => entity.id !== "prop_block_1",
      ),
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_presence_after_1",
          kind: "entity-presence",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "prop_block_1",
              path: "entity.kind",
            },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { before, after })).not.toThrow();
  });

  it("rejects actor rotation as the only primary camera-target evidence", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_actor_rotation_camera_target_1",
          kind: "camera-target",
          required: true,
          targets: ["camera_shot_1", "actor_generic_1"],
          evidence: [
            { type: "entity", entityId: "camera_shot_1" },
            {
              type: "entity-property",
              entityId: "actor_generic_1",
              path: "entity.transform.rotation",
            },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { after: scene }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("accepts camera rotation primary evidence with actor support", () => {
    const scene = createStructuredScene();
    const report = createIntentReport({
      recognizedConstraints: [
        {
          id: "intent_camera_rotation_target_1",
          kind: "camera-target",
          required: true,
          targets: ["camera_shot_1", "actor_generic_1"],
          evidence: [
            {
              type: "entity-property",
              entityId: "camera_shot_1",
              path: "entity.transform.rotation",
            },
            { type: "entity", entityId: "actor_generic_1" },
          ],
        },
      ],
    });

    expect(() => validateIntentCoverage(report, { after: scene })).not.toThrow();
  });

  it("accepts camera.look-at primary evidence with actor support", () => {
    const scene = createStructuredScene();
    const patch = {
      ...createStructuredPatch(scene),
      operations: [
        {
          op: "camera.look-at" as const,
          entityId: "camera_shot_1",
          target: {
            type: "entity-anchor" as const,
            entityId: "actor_generic_1",
            anchor: "face" as const,
          },
        },
      ],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_camera_look_at_target_1",
          kind: "camera-target",
          required: true,
          targets: ["camera_shot_1", "actor_generic_1"],
          evidence: [
            { type: "patch-operation", operationIndex: 0 },
            { type: "entity", entityId: "actor_generic_1" },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, {
        before: scene,
        after: structuredClone(scene),
        patch,
      }),
    ).not.toThrow();
  });

  it("rejects entity.add actor as camera-target primary evidence", () => {
    const before = createStructuredScene();
    const actor = before.entities.find(
      (entity) => entity.id === "actor_generic_1" && entity.kind === "actor",
    );
    if (!actor || actor.kind !== "actor") {
      throw new Error("Fixture actor is missing.");
    }
    const addedActor = {
      ...structuredClone(actor),
      id: "actor_generic_2",
      label: "Second generic actor",
      slot: "actor_generic_2" as const,
    };
    const after = structuredClone(before);
    after.entities.push(addedActor);
    const patch = {
      ...createStructuredPatch(before),
      operations: [{ op: "entity.add" as const, value: addedActor }],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_added_actor_camera_target_1",
          kind: "camera-target",
          required: true,
          targets: ["camera_shot_1", "actor_generic_2"],
          evidence: [
            { type: "entity", entityId: "camera_shot_1" },
            { type: "patch-operation", operationIndex: 0 },
          ],
        },
      ],
    });

    expectSubmissionCode(
      () => validateIntentCoverage(report, { before, after, patch }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("accepts entity.add camera as camera-target primary evidence", () => {
    const before = createStructuredScene();
    const camera = before.entities.find(
      (entity) => entity.id === "camera_shot_1" && entity.kind === "camera",
    );
    if (!camera || camera.kind !== "camera") {
      throw new Error("Fixture camera is missing.");
    }
    const addedCamera = {
      ...structuredClone(camera),
      id: "camera_shot_2",
      label: "Second shot camera",
    };
    const after = structuredClone(before);
    after.entities.push(addedCamera);
    const patch = {
      ...createStructuredPatch(before),
      operations: [{ op: "entity.add" as const, value: addedCamera }],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_added_camera_target_1",
          kind: "camera-target",
          required: true,
          targets: ["camera_shot_2", "actor_generic_1"],
          evidence: [
            { type: "patch-operation", operationIndex: 0 },
            { type: "entity", entityId: "actor_generic_1" },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });

  it("accepts entity.add actor as support when camera-target has camera primary evidence", () => {
    const before = createStructuredScene();
    const actor = before.entities.find(
      (entity) => entity.id === "actor_generic_1" && entity.kind === "actor",
    );
    if (!actor || actor.kind !== "actor") {
      throw new Error("Fixture actor is missing.");
    }
    const addedActor = {
      ...structuredClone(actor),
      id: "actor_generic_2",
      label: "Second generic actor",
      slot: "actor_generic_2" as const,
    };
    const after = structuredClone(before);
    after.entities.push(addedActor);
    const patch = {
      ...createStructuredPatch(before),
      operations: [{ op: "entity.add" as const, value: addedActor }],
    };
    const report = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_added_actor_support_1",
          kind: "camera-target",
          required: true,
          targets: ["camera_shot_1", "actor_generic_2"],
          evidence: [
            {
              type: "entity-property",
              entityId: "camera_shot_1",
              path: "entity.transform.rotation",
            },
            { type: "patch-operation", operationIndex: 0 },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(report, { before, after, patch }),
    ).not.toThrow();
  });

  it("uses the after version of a same-id scene constraint", () => {
    const before = createStructuredScene();
    const after = structuredClone(before);
    after.constraints = after.constraints.map((constraint) =>
      constraint.id === "constraint_ground_actor_1" &&
      constraint.type === "ground-contact"
        ? { ...constraint, surfaceEntityId: "prop_block_1" }
        : constraint,
    );
    const afterReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_after_constraint_targets_1",
          kind: "contact",
          required: true,
          targets: ["actor_generic_1", "prop_block_1"],
          evidence: [
            {
              type: "scene-constraint",
              constraintId: "constraint_ground_actor_1",
            },
          ],
        },
      ],
    });
    const beforeReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_old_constraint_targets_1",
          kind: "contact",
          required: true,
          targets: ["actor_generic_1", "environment_room_1"],
          evidence: [
            {
              type: "scene-constraint",
              constraintId: "constraint_ground_actor_1",
            },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(afterReport, { before, after }),
    ).not.toThrow();
    expectSubmissionCode(
      () => validateIntentCoverage(beforeReport, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });

  it("uses the after value of a scene property path before falling back", () => {
    const before = createStructuredScene();
    before.compositionGoals = {
      framing: {
        mode: "medium",
        targetEntityIds: ["actor_generic_1"],
      },
    };
    const after = structuredClone(before);
    after.compositionGoals = {
      framing: {
        mode: "whole-prop",
        targetEntityIds: ["prop_block_1"],
      },
    };
    const afterReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_after_framing_targets_1",
          kind: "framing",
          required: true,
          targets: ["prop_block_1"],
          evidence: [
            {
              type: "scene-property",
              path: "scene.compositionGoals.framing",
            },
          ],
        },
      ],
    });
    const beforeReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_old_framing_targets_1",
          kind: "framing",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [
            {
              type: "scene-property",
              path: "scene.compositionGoals.framing",
            },
          ],
        },
      ],
    });

    expect(() =>
      validateIntentCoverage(afterReport, { before, after }),
    ).not.toThrow();
    expectSubmissionCode(
      () => validateIntentCoverage(beforeReport, { before, after }),
      "INTENT_COVERAGE_INCOMPLETE",
    );
  });
});

describe("intent coverage dependency direction", () => {
  it("does not import the higher-level scene submission module", () => {
    const source = readFileSync(
      new URL("../src/domain/intent-coverage.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/from\s+["']\.\/scene-submission["']/);
  });
});

describe("SceneSession structured submission atomicity", () => {
  it("submits a valid scene only after coverage validation", () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const submission = createSceneSubmission();
    submission.scene = {
      ...submission.scene,
      sceneId: "scene_submitted_1",
      title: "Submitted generic scene",
    };

    const after = session.submitScene(submission);

    expect(after).toMatchObject({
      sceneId: "scene_submitted_1",
      revision: initial.revision + 1,
      title: "Submitted generic scene",
    });
  });

  it("submits a valid patch as one revision", () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);

    const after = session.submitPatch(createPatchSubmission(initial));

    expect(after).toMatchObject({
      sceneId: initial.sceneId,
      revision: initial.revision + 1,
      title: "Revised generic shot",
    });
  });

  it("keeps scene, history, and events unchanged after invalid coverage", () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const listener = vi.fn();
    session.subscribe(listener);
    const submission = createPatchSubmission(initial);
    submission.intentReport = createPatchIntentReport({
      recognizedConstraints: [
        {
          id: "intent_invalid_patch_coverage_1",
          kind: "position",
          required: true,
          targets: ["actor_generic_1"],
          evidence: [{ type: "patch-operation", operationIndex: 4 }],
        },
      ],
    });

    expectSubmissionCode(
      () => session.submitPatch(submission),
      "INTENT_COVERAGE_INCOMPLETE",
    );
    expect(session.snapshot()).toEqual(initial);
    expect(session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps scene, history, and events unchanged after a stale revision", () => {
    const initial = createStructuredScene();
    const session = new SceneSession(initial);
    const listener = vi.fn();
    session.subscribe(listener);
    const submission = createPatchSubmission(initial);
    submission.patch = {
      ...submission.patch,
      baseRevision: initial.revision + 1,
    };

    expect(() => session.submitPatch(submission)).toThrowError(
      expect.objectContaining({ code: "STALE_REVISION" }),
    );
    expect(session.snapshot()).toEqual(initial);
    expect(session.historyStatus()).toEqual({
      canUndo: false,
      canRedo: false,
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
