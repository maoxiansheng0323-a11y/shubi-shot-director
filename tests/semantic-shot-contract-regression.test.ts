import { describe, expect, it } from "vitest";
import { ShotCandidateSession } from "../server/shot-candidate-session";
import { createDefaultScene } from "../src/domain/default-scene";
import { analyzeFinalShotHardConstraints } from "../src/domain/shot-hard-constraint-verifier";
import { semanticPreferencePenalty } from "../src/domain/shot-candidate-preferences";
import { lookAtQuaternion, quaternionFromEulerDegrees } from "../src/domain/scene-math";
import { shotIntentPlanSchema, type ShotIntentPlan } from "../src/domain/shot-intent";
import type { SolvedCameraCandidate } from "../src/domain/camera-solver";
import type { IntentReport } from "../src/domain/intent-report";

const simplePlan = (
  operation: "create" | "modify" = "create",
): ShotIntentPlan => shotIntentPlanSchema.parse({
  schemaVersion: 1,
  planId: "plan_contract_regression_1",
  operation,
  cameraId: "camera_shot_1",
  primaryTargetIds: ["actor_generic_1"],
  hardConstraints: [
    {
      id: "visibility_contract_1",
      kind: "visibility",
      entityId: "actor_generic_1",
      anchor: "face",
      requiredPartIds: ["head"],
      minVisibleRatio: 0.2,
    },
    {
      id: "framing_contract_1",
      kind: "framing",
      mode: "full",
      targetEntityIds: ["actor_generic_1"],
    },
  ],
  softPreferences: [],
  candidateCount: 3,
});

const simpleIntentReport = (
  operation: "create" | "modify" = "create",
): IntentReport => ({
  schemaVersion: 6,
  operation,
  allowPartial: false,
  recognizedConstraints: [
    {
      id: "visibility_contract_1",
      kind: "visibility",
      required: true,
      targets: ["actor_generic_1"],
      evidence: [
        {
          type: "entity-property",
          entityId: "actor_generic_1",
          path: "entity.visible",
        },
      ],
    },
    {
      id: "framing_contract_1",
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
  unsupportedConstraints: [],
  unresolvedRelations: [],
  warnings: [],
  canApplySafely: true,
});

describe("v1 semantic hard-constraint truth", () => {
  it("fails a spatial hard constraint after the solved geometry is moved away", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find(({ id }) => id === "actor_generic_1");
    const prop = scene.entities.find(({ id }) => id === "prop_block_1");
    if (!actor || !prop) throw new Error("missing default entities");
    actor.transform.positionM = [0, actor.transform.positionM[1], 0];
    prop.transform.positionM = [1, actor.transform.positionM[1], 0];
    const plan = shotIntentPlanSchema.parse({
      ...simplePlan(),
      hardConstraints: [
        {
          id: "right_relation_contract_1",
          kind: "spatial-relationship",
          subjectId: prop.id,
          referenceId: actor.id,
          relation: "right-of",
          distance: { minM: 0.9, maxM: 1.1 },
          axisFrame: "world",
        },
      ],
    });

    expect(analyzeFinalShotHardConstraints(scene, plan).status).toBe("pass");
    prop.transform.positionM = [-1, actor.transform.positionM[1], 0];
    const failed = analyzeFinalShotHardConstraints(scene, plan);
    expect(failed.status).toBe("fail");
    expect(failed.checks[0]).toMatchObject({
      id: "right_relation_contract_1",
      status: "fail",
    });
  });
});

describe("v1 weighted semantic preference scoring", () => {
  it("consumes look-room weight instead of leaving the schema preference inert", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find(({ id }) => id === "actor_generic_1");
    const camera = scene.entities.find(({ id }) => id === "camera_shot_1");
    if (!actor || actor.kind !== "actor" || !camera || camera.kind !== "camera") {
      throw new Error("missing camera fixture");
    }
    actor.transform.positionM = [0, 0.9, 0];
    actor.transform.rotation = quaternionFromEulerDegrees([0, 90, 0]);
    camera.transform.positionM = [0, 1.3, 5];
    camera.transform.rotation = lookAtQuaternion(
      camera.transform.positionM,
      [0, 1.1, 0],
    );
    const candidate: SolvedCameraCandidate = {
      candidateId: "candidate_contract_1",
      label: "Contract candidate",
      profile: "balanced",
      scene,
      composition: {
        status: "safe",
        overallStatus: "safe",
        activeCameraId: camera.id,
        anchorSafe: {
          status: "pass",
          required: false,
          approximate: false,
          confidence: 1,
          issueCodes: [],
          evidence: [],
        },
        framingSafe: {
          status: "pass",
          required: false,
          approximate: false,
          confidence: 1,
          issueCodes: [],
          evidence: [],
        },
        captionSafe: {
          status: "pass",
          required: false,
          approximate: false,
          confidence: 1,
          issueCodes: [],
          evidence: [],
        },
        occlusionSafe: {
          status: "pass",
          required: false,
          approximate: false,
          confidence: 1,
          issueCodes: [],
          evidence: [],
        },
        topologySafe: {
          status: "pass",
          required: false,
          approximate: false,
          confidence: 1,
          issueCodes: [],
          evidence: [],
        },
        cameraCollisionSafe: {
          status: "pass",
          required: false,
          approximate: false,
          confidence: 1,
          issueCodes: [],
          evidence: [],
        },
        issues: [],
      },
      metrics: {
        framingFill: 0.6,
        targetCenterNdc: [0, 0],
        headroomFraction: 0.1,
        cameraHeightM: 1.3,
        focalLengthMm: camera.lens.focalLengthMm,
        viewAngleDeg: 90,
        softScore: 90,
        warningCount: 0,
      },
      score: 90,
    };
    const lowWeight = shotIntentPlanSchema.parse({
      ...simplePlan(),
      softPreferences: [
        {
          id: "look_room_contract_1",
          kind: "look-room",
          entityId: actor.id,
          tendency: "generous",
          weight: 0.1,
        },
      ],
    });
    const highWeight = shotIntentPlanSchema.parse({
      ...lowWeight,
      softPreferences: [
        {
          id: "look_room_contract_1",
          kind: "look-room",
          entityId: actor.id,
          tendency: "generous",
          weight: 10,
        },
      ],
    });

    expect(semanticPreferencePenalty(candidate, highWeight)).toBeGreaterThan(
      semanticPreferencePenalty(candidate, lowWeight) * 20,
    );
  });
});

describe("v1 authoritative modify solve binding", () => {
  it("rejects a same-revision modify submission whose SceneSpec is not the authoritative snapshot", () => {
    const authoritative = createDefaultScene();
    const staleCopy = structuredClone(authoritative);
    staleCopy.title = "Stale same-revision copy";
    const session = new ShotCandidateSession();

    expect(() =>
      session.solve(
        {
          scene: staleCopy,
          plan: simplePlan("modify"),
          intentReport: simpleIntentReport("modify"),
        },
        authoritative,
      ),
    ).toThrowError("exact authoritative SceneSession snapshot");
  }, 15_000);
});
