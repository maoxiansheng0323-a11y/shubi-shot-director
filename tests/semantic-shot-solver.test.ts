import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { rotateVector, quaternionFromEulerDegrees } from "../src/domain/scene-math";
import {
  SceneRelationshipError,
  solveSceneRelationships,
} from "../src/domain/scene-relationship-solver";
import {
  shotIntentPlanSchema,
  type ShotIntentPlan,
} from "../src/domain/shot-intent";
import { solveSemanticShot } from "../src/domain/shot-solver";

const widenRoom = () => {
  const scene = createDefaultScene();
  const room = scene.entities.find((entity) => entity.kind === "environment");
  if (!room || room.kind !== "environment") throw new Error("missing room");
  room.preset.parameters = {
    ...room.preset.parameters,
    widthM: 10,
    depthM: 12,
  };
  return scene;
};

const cameraPlan = (overrides: Partial<ShotIntentPlan> = {}): ShotIntentPlan =>
  shotIntentPlanSchema.parse({
    schemaVersion: 1,
    planId: "plan_camera_solver_1",
    operation: "create",
    cameraId: "camera_shot_1",
    primaryTargetIds: ["actor_generic_1"],
    hardConstraints: [
      {
        id: "visibility_actor_face_1",
        kind: "visibility",
        entityId: "actor_generic_1",
        anchor: "face",
        requiredPartIds: ["head"],
        minVisibleRatio: 0.5,
      },
      {
        id: "framing_actor_full_1",
        kind: "framing",
        mode: "full",
        targetEntityIds: ["actor_generic_1"],
      },
      {
        id: "camera_clearance_1",
        kind: "camera-clearance",
        minimumEntityDistanceM: 0.05,
      },
    ],
    softPreferences: [
      {
        id: "preference_camera_low_1",
        kind: "camera-height",
        tendency: "low",
        weight: 1,
      },
      {
        id: "preference_three_quarter_1",
        kind: "view-angle",
        tendency: "three-quarter",
        side: "either",
        weight: 1,
      },
      {
        id: "preference_actor_right_1",
        kind: "screen-placement",
        entityId: "actor_generic_1",
        horizontal: "right",
        weight: 1,
      },
      {
        id: "preference_lens_wide_1",
        kind: "lens",
        tendency: "mild-wide",
        weight: 1,
      },
    ],
    candidateCount: 3,
    ...overrides,
  });

describe("ShotIntentPlan", () => {
  it("keeps hard constraints and soft preferences explicit and rejects raw wording", () => {
    const plan = cameraPlan();
    expect(plan.hardConstraints).toHaveLength(3);
    expect(plan.softPreferences).toHaveLength(4);
    expect(() => shotIntentPlanSchema.parse({ ...plan, prompt: "raw wording" })).toThrow();
  });

  it("applies reference-local relationships on rotated geometry", () => {
    const scene = widenRoom();
    const actor = scene.entities.find((entity) => entity.id === "actor_generic_1");
    if (!actor) throw new Error("missing actor");
    actor.transform.rotation = quaternionFromEulerDegrees([0, 90, 0]);
    const plan = cameraPlan({
      hardConstraints: [
        {
          id: "relationship_support_behind_1",
          kind: "spatial-relationship",
          subjectId: "prop_block_1",
          referenceId: "actor_generic_1",
          relation: "behind",
          distance: { minM: 1, maxM: 1 },
          axisFrame: "reference",
        },
      ],
      softPreferences: [],
    });
    const solved = solveSceneRelationships(scene, plan).scene;
    const prop = solved.entities.find((entity) => entity.id === "prop_block_1");
    expect(prop?.transform.positionM[0]).toBeCloseTo(actor.transform.positionM[0] - 1, 5);
    expect(prop?.transform.positionM[2]).toBeCloseTo(actor.transform.positionM[2], 5);
  });

  it("fails contradictory hard relationships instead of guessing", () => {
    const plan = cameraPlan({
      hardConstraints: [
        {
          id: "relationship_left_1",
          kind: "spatial-relationship",
          subjectId: "actor_generic_1",
          referenceId: "prop_block_1",
          relation: "left-of",
          distance: { minM: 1, maxM: 1 },
          axisFrame: "world",
        },
        {
          id: "relationship_right_1",
          kind: "spatial-relationship",
          subjectId: "actor_generic_1",
          referenceId: "prop_block_1",
          relation: "right-of",
          distance: { minM: 1, maxM: 1 },
          axisFrame: "world",
        },
      ],
      softPreferences: [],
    });
    expect(() => solveSceneRelationships(widenRoom(), plan)).toThrowError(
      SceneRelationshipError,
    );
  });
});

describe("deterministic camera candidate solving", () => {
  it("returns three diverse, hard-valid candidates without authored camera quaternions", () => {
    const scene = widenRoom();
    const plan = cameraPlan();
    const first = solveSemanticShot(scene, plan);
    const second = solveSemanticShot(scene, plan);
    expect(first.candidates).toHaveLength(3);
    expect(first).toEqual(second);
    expect(first.candidates.map(({ profile }) => profile)).toEqual([
      "dramatic-low",
      "balanced",
      "environmental",
    ]);
    for (const candidate of first.candidates) {
      expect(candidate.composition.issues.filter(({ severity }) => severity === "error")).toEqual([]);
      expect(candidate.worldDiagnostics.pose.status).not.toBe("fail");
      expect(candidate.metrics.targetCenterNdc[0]).toBeGreaterThan(0.15);
      const camera = candidate.scene.entities.find(
        (entity) => entity.kind === "camera" && entity.id === candidate.scene.activeCameraId,
      );
      expect(camera?.transform.rotation).not.toEqual(
        scene.entities.find((entity) => entity.kind === "camera")?.transform.rotation,
      );
    }
  }, 15_000);

  it("fails an impossible camera request when every legal sample collides", () => {
    const scene = createDefaultScene();
    const blocker = scene.entities.find((entity) => entity.id === "prop_block_1");
    if (!blocker || blocker.kind !== "prop") throw new Error("missing blocker");
    blocker.transform.positionM = [0, 0, 0];
    blocker.geometry.sizeM = [100, 100, 100];
    expect(() => solveSemanticShot(scene, cameraPlan())).toThrowError(
      "No camera candidate satisfies all hard shot constraints.",
    );
  });

  it("keeps a facing relationship physically directed at its target", () => {
    const scene = widenRoom();
    const actor = scene.entities.find((entity) => entity.id === "actor_generic_1");
    const prop = scene.entities.find((entity) => entity.id === "prop_block_1");
    if (!actor || !prop) throw new Error("missing fixture entities");
    const plan = cameraPlan({
      hardConstraints: [
        {
          id: "facing_prop_1",
          kind: "facing",
          subjectId: actor.id,
          targetEntityId: prop.id,
        },
      ],
      softPreferences: [],
    });
    const solved = solveSceneRelationships(scene, plan).scene;
    const solvedActor = solved.entities.find((entity) => entity.id === actor.id);
    if (!solvedActor) throw new Error("missing solved actor");
    const forward = rotateVector([0, 0, 1], solvedActor.transform.rotation);
    const toTarget = [
      prop.transform.positionM[0] - solvedActor.transform.positionM[0],
      prop.transform.positionM[1] - solvedActor.transform.positionM[1],
      prop.transform.positionM[2] - solvedActor.transform.positionM[2],
    ] as const;
    const dot = forward[0] * toTarget[0] + forward[1] * toTarget[1] + forward[2] * toTarget[2];
    expect(dot).toBeGreaterThan(0);
  });
});
