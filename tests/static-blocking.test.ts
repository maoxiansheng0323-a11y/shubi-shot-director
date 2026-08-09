import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyScenePatch,
  SceneDomainError,
} from "../src/domain/apply-scene-patch";
import { enforceBodyContacts } from "../src/domain/body-contacts";
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
import { SceneSession } from "../server/scene-session";
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
  prop.transform.positionM = [0, 0.8, -0.6];
  prop.geometry = {
    primitive: "box",
    sizeM: [1.3, 1.6, 0.3],
  };
  const seat = structuredClone(prop);
  seat.id = "prop_seat_1";
  seat.label = "Generic pelvis support";
  seat.transform.positionM = [0, 0.45, -0.2];
  seat.geometry = {
    primitive: "box",
    sizeM: [0.28, 0.2, 0.5],
  };
  scene.entities.push(seat);
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
    lean: { direction: "backward", angleDeg: 10 },
  },
  legPosture: "bent-resting",
  contacts: [
    {
      constraintId: "contact_pelvis_floor_1",
      bodySite: "pelvis",
      surfaceEntityId: "prop_seat_1",
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

const createDirectionalContactScene = (
  bodySite: "upper-back" | "chest",
  actorYawDeg = 0,
  propYawDeg = 0,
): SceneSpec => {
  const scene = createDefaultScene();
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const prop = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !prop || prop.kind !== "prop") {
    throw new Error("Directional contact fixture is incomplete.");
  }
  actor.transform.positionM = [0, 0.9, 0.2];
  actor.transform.rotation = quaternionFromEulerDegrees([0, actorYawDeg, 0]);
  prop.id = "prop_directional_surface_1";
  prop.transform.positionM = [0, 1.25, -0.4];
  prop.transform.rotation = quaternionFromEulerDegrees([0, propYawDeg, 0]);
  prop.geometry = { primitive: "box", sizeM: [2.4, 0.7, 0.2] };
  scene.constraints.push({
    id: `contact_${bodySite.replace("-", "_")}_direction_1`,
    type: "body-contact",
    actorId: actor.id,
    bodySite,
    surfaceEntityId: prop.id,
    surfaceFace: "front",
    role: "support",
    toleranceM: 0.012,
    enabled: true,
  });
  return enforceBodyContacts(sceneSpecSchema.parse(scene));
};

const createLowArmScene = (
  surfaceHeightM = 0,
  surfaceEntityId: string | null = null,
): SceneSpec => {
  const scene = createDefaultScene();
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const prop = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !prop || prop.kind !== "prop") {
    throw new Error("Low arm fixture is incomplete.");
  }
  actor.transform.positionM = [0, 0.1, 0];
  if (surfaceEntityId !== null) {
    prop.id = surfaceEntityId;
    prop.label = "Generic arm rest surface";
    prop.transform.positionM = [0, surfaceHeightM - 0.1, 0];
    prop.transform.rotation = [0, 0, 0, 1];
    prop.geometry = {
      primitive: "box",
      sizeM: [2.4, 0.2, 2.4],
    };
  }
  return sceneSpecSchema.parse(scene);
};

const restingArmPlan = (
  limb: "arm-l" | "arm-r",
  surfaceEntityId: string | null = null,
): StaticBlockingPlan => ({
  schemaVersion: 1,
  planId: `blocking_rest_${limb.replace("-", "_")}_1`,
  actorId: "actor_generic_1",
  contacts: [],
  relaxedLimbs: [
    {
      constraintId: `relaxed_rest_${limb.replace("-", "_")}_1`,
      limb,
      restSurface: {
        surfaceEntityId,
        surfaceFace: "top",
      },
    },
  ],
});

const createGroundRestingProductionScene = (): SceneSpec => {
  const scene = createDefaultScene();
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const prop = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !prop || prop.kind !== "prop") {
    throw new Error("Ground resting production fixture is incomplete.");
  }
  actor.transform.positionM = [0, 0.1, 0];
  if ("body" in actor) {
    actor.body.limbPresence.upper_arm_l = "absent";
    actor.body.limbPresence.forearm_l = "absent";
    actor.body.limbPresence.hand_l = "absent";
  }
  prop.id = "prop_back_support_ground_1";
  prop.label = "Generic low back support";
  prop.transform.positionM = [0, 0.5, -0.5];
  prop.transform.rotation = [0, 0, 0, 1];
  prop.geometry = {
    primitive: "box",
    sizeM: [1.4, 0.5, 0.3],
  };
  return sceneSpecSchema.parse(scene);
};

const groundRestingProductionPlan = (): StaticBlockingPlan => ({
  schemaVersion: 1,
  planId: "blocking_ground_resting_production_1",
  actorId: "actor_generic_1",
  trunk: {
    lean: { direction: "backward", angleDeg: 20 },
  },
  legPosture: "bent-resting",
  contacts: [
    {
      constraintId: "contact_pelvis_world_ground_1",
      bodySite: "pelvis",
      surfaceEntityId: null,
      surfaceFace: "top",
      role: "support",
    },
    {
      constraintId: "contact_upper_back_low_box_1",
      bodySite: "upper-back",
      surfaceEntityId: "prop_back_support_ground_1",
      surfaceFace: "front",
      role: "support",
    },
  ],
  relaxedLimbs: [
    {
      constraintId: "relaxed_arm_r_world_ground_1",
      limb: "arm-r",
      restSurface: {
        surfaceEntityId: null,
        surfaceFace: "top",
      },
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
            orientationDeviationDeg: contact.orientationDeviationDeg,
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
        orientationDeviationDeg: expect.closeTo(10, 5),
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
    expect(report.relaxedLimbs[0]?.lowerDeviationDeg).toBeCloseTo(12, 4);
    expect(report.relaxedLimbs[0]?.maxDeviationDeg).toBe(20);
  });

  it("passes upper-back contact only when the anatomical back faces the surface", () => {
    const report = analyzePoseDiagnostics(
      createDirectionalContactScene("upper-back"),
    );
    const contact = report.contacts[0];

    expect(report.status).toBe("pass");
    expect(contact?.status).toBe("pass");
    expect(Math.abs(contact?.gapM ?? 1)).toBeLessThan(1e-6);
    expect(contact?.orientationDeviationDeg).toBeCloseTo(0, 5);
  });

  it("does not pass upper-back contact when the same actor is side-on", () => {
    const report = analyzePoseDiagnostics(
      createDirectionalContactScene("upper-back", 90),
    );
    const contact = report.contacts[0];

    expect(Math.abs(contact?.gapM ?? 1)).toBeLessThan(1e-6);
    expect(contact?.orientationDeviationDeg).toBeCloseTo(90, 5);
    expect(contact?.status).not.toBe("pass");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BODY_CONTACT_ORIENTATION" }),
      ]),
    );
  });

  it("distinguishes chest-facing contact from upper-back contact", () => {
    const backReport = analyzePoseDiagnostics(
      createDirectionalContactScene("upper-back", 180),
    );
    const chestReport = analyzePoseDiagnostics(
      createDirectionalContactScene("chest", 180),
    );

    expect(backReport.contacts[0]?.orientationDeviationDeg).toBeCloseTo(180, 5);
    expect(backReport.contacts[0]?.status).toBe("fail");
    expect(chestReport.status).toBe("pass");
    expect(chestReport.contacts[0]?.orientationDeviationDeg).toBeCloseTo(0, 5);
    expect(chestReport.contacts[0]?.status).toBe("pass");
  });

  it("keeps anatomical contact orientation correct on a rotated box face", () => {
    const report = analyzePoseDiagnostics(
      createDirectionalContactScene("upper-back", 90, 90),
    );

    expect(report.status).toBe("pass");
    expect(report.contacts[0]?.orientationDeviationDeg).toBeCloseTo(0, 5);
    expect(report.contacts[0]?.status).toBe("pass");
  });

  it.each(["arm-l", "arm-r"] as const)(
    "solves %s with both arm segments close to gravity",
    (limb) => {
      const scene = createDefaultScene();
      scene.constraints = [];
      const solved = materializeStaticBlockingPlan(scene, {
        schemaVersion: 1,
        planId: `blocking_${limb.replace("-", "_")}_1`,
        actorId: "actor_generic_1",
        contacts: [],
        relaxedLimbs: [
          {
            constraintId: `relaxed_${limb.replace("-", "_")}_1`,
            limb,
          },
        ],
      });
      const relaxed = analyzePoseDiagnostics(solved).relaxedLimbs[0];

      expect(relaxed?.status).toBe("pass");
      expect(relaxed?.mode).toBe("free-hanging");
      expect(relaxed?.upperDeviationDeg).toBeLessThan(1);
      expect(relaxed?.lowerDeviationDeg).toBeCloseTo(12, 4);
      expect(relaxed?.maxDeviationDeg).toBe(20);
    },
  );

  it.each(["arm-l", "arm-r"] as const)(
    "solves a low %s onto world ground without arm penetration",
    (limb) => {
      const solved = materializeStaticBlockingPlan(
        createLowArmScene(),
        restingArmPlan(limb),
      );
      const report = analyzePoseDiagnostics(solved);
      const relaxed = report.relaxedLimbs[0];

      expect(report.status).toBe("pass");
      expect(report.jointViolations).toEqual([]);
      expect(relaxed).toMatchObject({
        limb,
        mode: "surface-resting",
        restSurfaceEntityId: null,
        restSurfaceFace: "top",
        terminalBodySite: limb === "arm-l" ? "hand-l" : "hand-r",
        status: "pass",
      });
      expect(Math.abs(relaxed?.terminalGapM ?? 1)).toBeLessThan(1e-6);
      expect(relaxed?.terminalPenetrationM).toBeLessThan(1e-6);
      expect(relaxed?.armMinGapM).toBeGreaterThanOrEqual(-0.00001);
      expect(relaxed?.elbowBendDeg).toBeLessThan(-1);
      expect(relaxed?.upperGravityAlignment).toBeGreaterThan(0);
      expect(relaxed?.terminalDropM).toBeGreaterThan(0);
    },
  );

  it("solves a surface-resting arm on a box top", () => {
    const surfaceId = "prop_arm_rest_surface_1";
    const solved = materializeStaticBlockingPlan(
      createLowArmScene(0.06, surfaceId),
      restingArmPlan("arm-r", surfaceId),
    );
    const relaxed = analyzePoseDiagnostics(solved).relaxedLimbs[0];

    expect(relaxed).toMatchObject({
      mode: "surface-resting",
      restSurfaceEntityId: surfaceId,
      restSurfaceFace: "top",
      boundsOverflowM: 0,
      status: "pass",
    });
    expect(Math.abs(relaxed?.terminalGapM ?? 1)).toBeLessThan(1e-6);
    expect(relaxed?.armMinGapM).toBeGreaterThanOrEqual(-0.00001);
  });

  it("solves a sub-contact-tolerance penetration instead of accepting it", () => {
    const surfaceId = "prop_shallow_arm_intercept_1";
    const solved = materializeStaticBlockingPlan(
      createLowArmScene(-0.15, surfaceId),
      restingArmPlan("arm-r", surfaceId),
    );
    const relaxed = analyzePoseDiagnostics(solved).relaxedLimbs[0];

    expect(relaxed?.status).toBe("pass");
    expect(Math.abs(relaxed?.terminalGapM ?? 1)).toBeLessThan(1e-6);
    expect(relaxed?.armMinGapM).toBeGreaterThanOrEqual(-0.00001);
    expect(relaxed?.elbowBendDeg).not.toBeCloseTo(-12, 3);
  });

  it("changes elbow bend deterministically with rest-surface height", () => {
    const surfaceId = "prop_variable_arm_rest_1";
    const low = materializeStaticBlockingPlan(
      createLowArmScene(0.02, surfaceId),
      restingArmPlan("arm-r", surfaceId),
    );
    const high = materializeStaticBlockingPlan(
      createLowArmScene(0.14, surfaceId),
      restingArmPlan("arm-r", surfaceId),
    );
    const lowElbow = analyzePoseDiagnostics(low).relaxedLimbs[0]?.elbowBendDeg;
    const highElbow = analyzePoseDiagnostics(high).relaxedLimbs[0]?.elbowBendDeg;

    expect(lowElbow).toBeTypeOf("number");
    expect(highElbow).toBeTypeOf("number");
    expect(Math.abs(highElbow ?? 0)).toBeGreaterThan(
      Math.abs(lowElbow ?? 0) + 5,
    );
    expect(high).toEqual(
      materializeStaticBlockingPlan(
        createLowArmScene(0.14, surfaceId),
        restingArmPlan("arm-r", surfaceId),
      ),
    );
  });

  it("solves the generic ground-resting production geometry without an elevated pelvis", () => {
    const solved = materializeStaticBlockingPlan(
      createGroundRestingProductionScene(),
      groundRestingProductionPlan(),
    );
    const report = analyzePoseDiagnostics(solved);
    const relaxed = report.relaxedLimbs[0];
    const actor = solved.entities.find(
      (entity) => entity.id === "actor_generic_1",
    );

    expect(report.status).toBe("pass");
    expect(report.contacts).toEqual([
      expect.objectContaining({
        constraintId: "contact_pelvis_world_ground_1",
        gapM: expect.closeTo(0, 8),
        actorMinGapM: expect.closeTo(0, 8),
        status: "pass",
      }),
      expect.objectContaining({
        constraintId: "contact_upper_back_low_box_1",
        gapM: expect.closeTo(0, 8),
        orientationDeviationDeg: expect.closeTo(20, 5),
        status: "pass",
      }),
    ]);
    expect(relaxed).toMatchObject({
      mode: "surface-resting",
      terminalGapM: expect.closeTo(0, 6),
      elbowBendDeg: expect.closeTo(-76.8495, 4),
      status: "pass",
    });
    expect(report.jointViolations).toEqual([]);
    expect(actor).toMatchObject({
      body: {
        limbPresence: {
          upper_arm_l: "absent",
          forearm_l: "absent",
          hand_l: "absent",
        },
      },
    });
  });

  it("fails an unreachable rest surface without forcing extreme joints", () => {
    const surfaceId = "prop_unreachable_arm_rest_1";
    let failure: unknown;
    try {
      materializeStaticBlockingPlan(
        createLowArmScene(0.5, surfaceId),
        restingArmPlan("arm-r", surfaceId),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "POSE_DIAGNOSTICS_FAILED",
      report: {
        status: "fail",
        relaxedLimbs: [
          expect.objectContaining({
            mode: "surface-resting",
            status: "fail",
          }),
        ],
      },
    });
    const report = (failure as { report: ReturnType<typeof analyzePoseDiagnostics> })
      .report;
    expect(report.jointViolations).toEqual([]);
  });

  it.each([
    ["forearm_r", 35, "JOINT_BEND_REVERSED"],
    ["upper_arm_r", 145, "JOINT_LIMIT_EXCEEDED"],
  ] as const)(
    "keeps a surface-resting arm failed after a %s violation",
    (jointId, angleDeg, code) => {
      const solved = materializeStaticBlockingPlan(
        createLowArmScene(),
        restingArmPlan("arm-r"),
      );
      const actor = solved.entities.find(
        (entity) => entity.id === "actor_generic_1",
      );
      if (!actor || actor.kind !== "actor") {
        throw new Error("Solved arm actor is missing.");
      }
      actor.pose.joints[jointId] = quaternionFromEulerDegrees([
        angleDeg,
        0,
        0,
      ]);
      const report = analyzePoseDiagnostics(solved);

      expect(report.status).toBe("fail");
      expect(report.jointViolations).toEqual(
        expect.arrayContaining([expect.objectContaining({ jointId, code })]),
      );
      expect(report.relaxedLimbs[0]?.status).toBe("fail");
    },
  );

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
      expect(
        loaded.constraints.find(
          (constraint) => constraint.type === "relaxed-limb",
        ),
      ).not.toHaveProperty("restSurface");
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

  it.each([
    ["lower_leg_r", -35],
    ["forearm_r", 35],
  ] as const)("rejects an explicitly reversed %s before visual QA", (jointId, angleDeg) => {
    const scene = createDefaultScene();
    expect(() =>
      applyScenePatch(scene, {
        schemaVersion: PATCH_SCHEMA_VERSION,
        patchId: `patch_reverse_${jointId}_1`,
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "natural-language",
        preserveLock: true,
        operations: [
          {
            op: "actor.pose.joints.set",
            actorId: "actor_generic_1",
            updates: {
              [jointId]: quaternionFromEulerDegrees([angleDeg, 0, 0]),
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

  it("rejects a newly solved static-blocking pose outside joint limits", () => {
    const scene = createDefaultScene();
    scene.constraints = [];
    expect(() =>
      materializeStaticBlockingPlan(scene, {
        schemaVersion: 1,
        planId: "blocking_illegal_trunk_1",
        actorId: "actor_generic_1",
        trunk: {
          lean: { direction: "backward", angleDeg: 80 },
        },
        contacts: [],
        relaxedLimbs: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "POSE_DIAGNOSTICS_FAILED" }),
    );
  });

  it("rejects an unsatisfiable multi-contact plan instead of forcing a pose", () => {
    const scene = createDefaultScene();
    scene.constraints = [];
    expect(() =>
      materializeStaticBlockingPlan(scene, {
        schemaVersion: 1,
        planId: "blocking_conflicting_contacts_1",
        actorId: "actor_generic_1",
        contacts: [
          {
            constraintId: "contact_pelvis_ground_conflict_1",
            bodySite: "pelvis",
            surfaceEntityId: null,
            surfaceFace: "top",
            role: "support",
          },
          {
            constraintId: "contact_head_ground_conflict_1",
            bodySite: "head",
            surfaceEntityId: null,
            surfaceFace: "top",
            role: "contact",
          },
        ],
        relaxedLimbs: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "POSE_DIAGNOSTICS_FAILED" }),
    );
  });

  it("allows an unrelated edit over a historical diagnostic failure without normalizing it", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    const camera = scene.entities.find((entity) => entity.kind === "camera");
    if (!actor || actor.kind !== "actor" || !camera || camera.kind !== "camera") {
      throw new Error("Historical pose fixture is incomplete.");
    }
    actor.pose.preset.id = "pose.custom-v1";
    actor.pose.joints.lower_leg_r = quaternionFromEulerDegrees([-35, 0, 0]);
    const historicalPose = structuredClone(actor.pose);

    const applied = applyScenePatch(sceneSpecSchema.parse(scene), {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_historical_pose_camera_1",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      preserveLock: true,
      operations: [
        {
          op: "camera.lens.set",
          entityId: camera.id,
          value: { ...camera.lens, focalLengthMm: camera.lens.focalLengthMm + 5 },
        },
      ],
    });
    const appliedActor = applied.next.entities.find(
      (entity) => entity.id === actor.id,
    );

    expect(analyzePoseDiagnostics(applied.next).status).toBe("fail");
    expect(appliedActor).toMatchObject({ pose: historicalPose });
    expect(() => new SceneSession(applied.next)).not.toThrow();
  });
});
