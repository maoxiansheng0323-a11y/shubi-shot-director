import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import type { IntentReport } from "../src/domain/intent-report";
import { ShotCandidateSession, ShotCandidateSessionError } from "../server/shot-candidate-session";

const fixture = () => {
  const scene = createDefaultScene();
  const room = scene.entities.find((entity) => entity.kind === "environment");
  if (!room || room.kind !== "environment") throw new Error("missing room");
  room.preset.parameters = {
    ...room.preset.parameters,
    widthM: 10,
    depthM: 12,
  };
  const plan = {
    schemaVersion: 1 as const,
    planId: "plan_candidate_session_1",
    operation: "create" as const,
    cameraId: "camera_shot_1",
    primaryTargetIds: ["actor_generic_1"],
    hardConstraints: [
      {
        id: "visibility_actor_face_1",
        kind: "visibility" as const,
        entityId: "actor_generic_1",
        anchor: "face" as const,
        requiredPartIds: ["head"],
        minVisibleRatio: 0.5,
      },
      {
        id: "framing_actor_full_1",
        kind: "framing" as const,
        mode: "full" as const,
        targetEntityIds: ["actor_generic_1"],
      },
    ],
    softPreferences: [
      {
        id: "preference_camera_low_1",
        kind: "camera-height" as const,
        tendency: "low" as const,
        weight: 1,
      },
    ],
    candidateCount: 3,
  };
  const intentReport: IntentReport = {
    schemaVersion: 6,
    operation: "create",
    allowPartial: false,
    recognizedConstraints: [
      {
        id: "visibility_actor_face_1",
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
        id: "framing_actor_full_1",
        kind: "framing",
        required: true,
        targets: ["actor_generic_1"],
        evidence: [
          { type: "scene-property", path: "scene.compositionGoals.framing" },
        ],
      },
    ],
    unsupportedConstraints: [],
    unresolvedRelations: [],
    warnings: [],
    canApplySafely: true,
  };
  return { scene, plan, intentReport };
};

describe("transient semantic shot candidate session", () => {
  it("keeps candidates transient and blocks acceptance until browser verification passes", () => {
    const { scene, plan, intentReport } = fixture();
    const session = new ShotCandidateSession();
    const solve = session.solve({ scene, plan, intentReport }, scene);
    expect(solve.candidates).toHaveLength(3);
    expect(() =>
      session.candidateForAcceptance(solve.solveId, "candidate_a", scene),
    ).toThrowError(ShotCandidateSessionError);

    const candidate = solve.candidates.find(({ candidateId }) => candidateId === "candidate_a");
    if (!candidate) throw new Error("missing candidate");
    const verified = session.verify({
      schemaVersion: 1,
      solveId: solve.solveId,
      candidateId: candidate.candidateId,
      sceneSha256: candidate.sceneSha256,
      width: 320,
      height: 180,
      entities: [
        {
          entityId: "actor_generic_1",
          visiblePixelCount: 900,
          isolatedPixelCount: 1_000,
          boundsPx: { minX: 80, minY: 8, maxX: 240, maxY: 170 },
          centerDepthM: 3,
        },
      ],
      actorParts: [
        {
          actorId: "actor_generic_1",
          partId: "head",
          visiblePixelCount: 90,
          isolatedPixelCount: 100,
          boundsPx: { minX: 140, minY: 8, maxX: 180, maxY: 42 },
          centerDepthM: 3,
        },
      ],
    });
    expect(
      verified.candidates.find(({ candidateId }) => candidateId === "candidate_a")
        ?.renderVerification?.status,
    ).toBe("pass");
    expect(
      session.candidateForAcceptance(solve.solveId, "candidate_a", scene).sceneId,
    ).toBe(scene.sceneId);
  }, 15_000);

  it("re-solves a high-level preference patch and rejects stale generations", () => {
    const { scene, plan, intentReport } = fixture();
    const session = new ShotCandidateSession();
    const solve = session.solve({ scene, plan, intentReport }, scene);
    const revised = session.modify(
      {
        schemaVersion: 1,
        patchId: "patch_semantic_camera_lower_1",
        solveId: solve.solveId,
        baseGeneration: 0,
        operations: [
          {
            op: "soft-preference.set",
            value: {
              id: "preference_camera_low_1",
              kind: "camera-height",
              tendency: "high",
              weight: 1,
            },
          },
        ],
      },
      scene,
    );
    expect(revised.generation).toBe(1);
    expect(revised.candidates.every(({ renderVerification }) => renderVerification === null)).toBe(true);
    expect(() =>
      session.modify(
        {
          schemaVersion: 1,
          patchId: "patch_semantic_stale_1",
          solveId: solve.solveId,
          baseGeneration: 0,
          operations: [
            {
              op: "soft-preference.remove",
              preferenceId: "preference_camera_low_1",
            },
          ],
        },
        scene,
      ),
    ).toThrowError("stale candidate generation");
  }, 15_000);
});
