import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { analyzePoseDiagnostics } from "../src/domain/pose-diagnostics";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import { sceneSpecSchema, type SceneSpec } from "../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  materializeStaticBlockingPlan,
  StaticBlockingError,
} from "../src/domain/static-blocking";
import type { StaticBlockingPlan } from "../src/domain/static-blocking-schema";
import { parseSceneSubmission } from "../src/domain/scene-submission";
import { ScenePersistence } from "../server/scene-persistence";
import { createIntentReport } from "./helpers/structured-fixtures";

const createBlockingScene = (): SceneSpec => {
  const scene = createDefaultScene();
  scene.sceneId = "scene_static_blocking";
  scene.title = "Generic static blocking study";
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const prop = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !prop || prop.kind !== "prop") {
    throw new Error("Static blocking fixture is incomplete.");
  }
  actor.transform.positionM = [0, 0.4, 0.05];
  if ("body" in actor) {
    actor.body.limbPresence.forearm_l = "absent";
    actor.body.limbPresence.hand_l = "absent";
  }
  prop.id = "prop_support_1";
  prop.label = "Generic back support";
  prop.transform.positionM = [0, 0.3, -0.6];
  prop.geometry = {
    primitive: "box",
    sizeM: [1.3, 0.6, 0.3],
  };
  return sceneSpecSchema.parse(scene);
};

const blockingPlan = (): StaticBlockingPlan => ({
  schemaVersion: 1,
  planId: "blocking_plan_1",
  actorId: "actor_generic_1",
  seedPose: {
    registry: "builtin",
    id: "pose.seated-v1",
    version: 1,
  },
  trunk: {
    lean: { direction: "backward", angleDeg: 35 },
  },
  legPosture: "bent-resting",
  contacts: [
    {
      constraintId: "contact_pelvis_floor_1",
      bodySite: "pelvis",
      surfaceEntityId: null,
      surfaceFace: "top",
      role: "support",
    },
    {
      constraintId: "contact_back_prop_1",
      bodySite: "upper-back",
      surfaceEntityId: "prop_support_1",
      surfaceFace: "front",
      role: "support",
    },
  ],
  relaxedLimbs: [
    {
      constraintId: "relaxed_arm_r_1",
      limb: "arm-r",
    },
  ],
});

describe("deterministic static blocking", () => {
  it("materializes two body contacts and a gravity-down relaxed arm", () => {
    let solved: SceneSpec;
    try {
      solved = materializeStaticBlockingPlan(
        createBlockingScene(),
        blockingPlan(),
      );
    } catch (error) {
      if (error instanceof Error && "report" in error) {
        console.error(JSON.stringify(error.report, null, 2));
      }
      throw error;
    }
    const report = analyzePoseDiagnostics(solved);

    expect(report.status).toBe("pass");
    expect(report.jointViolations).toEqual([]);
    expect(report.contacts).toHaveLength(2);
    expect(
      Object.fromEntries(
        report.contacts.map((contact) => [
          contact.constraintId,
          {
            gapM: contact.gapM,
            actorMinGapM: contact.actorMinGapM,
            boundsOverflowM: contact.boundsOverflowM,
            status: contact.status,
          },
        ]),
      ),
    ).toMatchObject({
      contact_pelvis_floor_1: {
        status: "pass",
        boundsOverflowM: 0,
      },
      contact_back_prop_1: {
        status: "pass",
        boundsOverflowM: 0,
      },
    });
    for (const contact of report.contacts) {
      expect(Math.abs(contact.gapM)).toBeLessThan(1e-6);
      expect(contact.actorMinGapM).toBeGreaterThanOrEqual(
        -contact.toleranceM,
      );
    }
    expect(report.relaxedLimbs).toEqual([
      expect.objectContaining({
        actorId: "actor_generic_1",
        limb: "arm-r",
        status: "pass",
      }),
    ]);
    expect(report.relaxedLimbs[0]?.upperDeviationDeg).toBeLessThan(1);
    expect(report.relaxedLimbs[0]?.lowerDeviationDeg).toBeLessThan(72);
  });

  it("applies a blocking plan as one atomic Patch revision", () => {
    const scene = createBlockingScene();
    const applied = applyScenePatch(scene, {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_static_blocking_1",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: true,
      operations: [
        {
          op: "actor.blocking.solve",
          plan: blockingPlan(),
        },
      ],
    });

    expect(applied.next.revision).toBe(scene.revision + 1);
    expect(analyzePoseDiagnostics(applied.next).status).toBe("pass");
    expect(applied.next.constraints.map(({ id }) => id)).toEqual([
      "contact_pelvis_floor_1",
      "contact_back_prop_1",
      "relaxed_arm_r_1",
    ]);
  });

  it("materializes a transient create plan without persisting the plan", () => {
    const scene = createBlockingScene();
    const parsed = parseSceneSubmission({
      intentReport: createIntentReport(),
      scene,
      blockingPlans: [blockingPlan()],
    });

    expect(analyzePoseDiagnostics(parsed.scene).status).toBe("pass");
    expect(parsed.scene.constraints.map(({ id }) => id)).toEqual([
      "contact_pelvis_floor_1",
      "contact_back_prop_1",
      "relaxed_arm_r_1",
    ]);
    expect(parsed.scene).not.toHaveProperty("blockingPlans");
  });

  it("keeps the materialized result stable across persistence reload", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "static-blocking-persistence-"),
    );
    try {
      const solved = materializeStaticBlockingPlan(
        createBlockingScene(),
        blockingPlan(),
      );
      const persistence = new ScenePersistence(directory);
      await persistence.persist(solved);
      const loaded = await persistence.load();

      expect(loaded).toEqual(solved);
      expect(analyzePoseDiagnostics(loaded).status).toBe("pass");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a blocking constraint ID owned by another goal", () => {
    const scene = createBlockingScene();
    scene.constraints.push({
      id: "contact_pelvis_floor_1",
      type: "keep-visible",
      cameraId: scene.activeCameraId,
      subjectEntityId: "actor_generic_1",
      anchor: "face",
      enabled: true,
    });

    expect(() =>
      materializeStaticBlockingPlan(sceneSpecSchema.parse(scene), blockingPlan()),
    ).toThrowError(
      expect.objectContaining<Partial<StaticBlockingError>>({
        code: "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
      }),
    );
  });

  it("rejects an explicitly reversed knee before visual QA", () => {
    const scene = createDefaultScene();
    expect(() =>
      applyScenePatch(scene, {
        schemaVersion: PATCH_SCHEMA_VERSION,
        patchId: "patch_reverse_knee_1",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "natural-language",
        preserveLock: true,
        operations: [
          {
            op: "actor.pose.joints.set",
            actorId: "actor_generic_1",
            updates: {
              lower_leg_r: quaternionFromEulerDegrees([-35, 0, 0]),
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SceneDomainError>>({
        code: "POSE_DIAGNOSTICS_FAILED",
      }),
    );
  });
});
