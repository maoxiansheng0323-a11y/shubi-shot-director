import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import { sceneSpecSchema, type SceneSpec } from "../src/domain/scene-schema";
import { solveSemanticShot } from "../src/domain/shot-solver";
import { shotIntentPlanSchema, type ShotIntentPlan } from "../src/domain/shot-intent";
import { createStructuredTwoActorScene } from "./helpers/structured-fixtures";

const wideRoomScene = (sceneId: string): SceneSpec => {
  const scene = createDefaultScene();
  scene.sceneId = sceneId;
  scene.title = "Generic semantic shot acceptance";
  const room = scene.entities.find((entity) => entity.kind === "environment");
  if (!room || room.kind !== "environment") throw new Error("missing room");
  room.preset.parameters = {
    ...room.preset.parameters,
    widthM: 14,
    depthM: 14,
    heightM: 4,
  };
  return sceneSpecSchema.parse(scene);
};

const baseHard = (
  actorId = "actor_generic_1",
  mode: "close" | "medium-close" | "medium" | "full" = "full",
) => [
  {
    id: `visibility_${actorId}_1`,
    kind: "visibility" as const,
    entityId: actorId,
    anchor: "face" as const,
    requiredPartIds: ["head"],
    minVisibleRatio: 0.35,
  },
  {
    id: `framing_${actorId}_1`,
    kind: "framing" as const,
    mode,
    targetEntityIds: [actorId],
  },
  {
    id: "camera_clearance_generic_1",
    kind: "camera-clearance" as const,
    minimumEntityDistanceM: 0.04,
  },
];

const plan = (
  planId: string,
  hardConstraints: ShotIntentPlan["hardConstraints"],
  softPreferences: ShotIntentPlan["softPreferences"] = [],
  primaryTargetIds = ["actor_generic_1"],
): ShotIntentPlan => shotIntentPlanSchema.parse({
  schemaVersion: 1,
  planId,
  operation: "create",
  cameraId: "camera_shot_1",
  primaryTargetIds,
  hardConstraints,
  softPreferences,
  candidateCount: 3,
});

const expectUsable = (
  scene: SceneSpec,
  shotPlan: ShotIntentPlan,
  requirePosePass = true,
) => {
  const result = solveSemanticShot(scene, shotPlan);
  expect(result.candidates.length).toBeGreaterThan(0);
  for (const candidate of result.candidates) {
    expect(candidate.composition.issues.filter(({ severity }) => severity === "error")).toEqual([]);
    expect(candidate.worldDiagnostics.pose.status).toBe(requirePosePass ? "pass" : expect.any(String));
  }
  return result;
};

const seatedSupportFixture = () => {
  const scene = wideRoomScene("scene_accept_seated_support");
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const support = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !support || support.kind !== "prop") {
    throw new Error("missing seated fixture");
  }
  actor.transform.positionM = [0, 0.4, 0.05];
  support.id = "prop_support_1";
  support.transform.positionM = [0, 0.8, -0.6];
  support.geometry = { primitive: "box", sizeM: [1.3, 1.6, 0.3] };
  const seat = structuredClone(support);
  seat.id = "prop_seat_1";
  seat.label = "Generic seat support";
  seat.transform.positionM = [0, 0.45, -0.2];
  seat.geometry = { primitive: "box", sizeM: [0.28, 0.2, 0.5] };
  scene.entities.push(seat);
  const blocking = {
    schemaVersion: 1 as const,
    planId: "blocking_seated_support_1",
    actorId: actor.id,
    seedPose: { registry: "builtin" as const, id: "pose.seated-v1", version: 1 as const },
    trunk: { lean: { direction: "backward" as const, angleDeg: 10 } },
    legPosture: "bent-resting" as const,
    contacts: [
      {
        constraintId: "contact_pelvis_seat_1",
        bodySite: "pelvis" as const,
        surfaceEntityId: seat.id,
        surfaceFace: "top" as const,
        role: "support" as const,
      },
      {
        constraintId: "contact_upper_back_support_1",
        bodySite: "upper-back" as const,
        surfaceEntityId: support.id,
        surfaceFace: "front" as const,
        role: "support" as const,
      },
    ],
    relaxedLimbs: [{ constraintId: "relaxed_arm_r_seated_1", limb: "arm-r" as const }],
  };
  return { scene: sceneSpecSchema.parse(scene), blocking };
};

const groundRestingFixture = () => {
  const scene = wideRoomScene("scene_accept_ground_resting");
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const support = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !support || support.kind !== "prop") {
    throw new Error("missing ground fixture");
  }
  actor.transform.positionM = [0, 0.1, 0];
  if ("body" in actor) {
    actor.body.limbPresence.upper_arm_l = "absent";
    actor.body.limbPresence.forearm_l = "absent";
    actor.body.limbPresence.hand_l = "absent";
  }
  support.id = "prop_back_support_ground_1";
  support.transform.positionM = [0, 0.5, -0.5];
  support.geometry = { primitive: "box", sizeM: [1.4, 0.5, 0.3] };
  const blocking = {
    schemaVersion: 1 as const,
    planId: "blocking_ground_resting_1",
    actorId: actor.id,
    trunk: { lean: { direction: "backward" as const, angleDeg: 20 } },
    legPosture: "bent-resting" as const,
    contacts: [
      {
        constraintId: "contact_pelvis_ground_1",
        bodySite: "pelvis" as const,
        surfaceEntityId: null,
        surfaceFace: "top" as const,
        role: "support" as const,
      },
      {
        constraintId: "contact_back_low_box_1",
        bodySite: "upper-back" as const,
        surfaceEntityId: support.id,
        surfaceFace: "front" as const,
        role: "support" as const,
      },
    ],
    relaxedLimbs: [
      {
        constraintId: "relaxed_arm_r_ground_1",
        limb: "arm-r" as const,
        restSurface: { surfaceEntityId: null, surfaceFace: "top" as const },
      },
    ],
  };
  return { scene: sceneSpecSchema.parse(scene), blocking };
};

const lyingRaisedFixture = () => {
  const scene = wideRoomScene("scene_accept_lying_raised");
  scene.constraints = [];
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const platform = scene.entities.find((entity) => entity.kind === "prop");
  if (!actor || actor.kind !== "actor" || !platform || platform.kind !== "prop") {
    throw new Error("missing lying fixture");
  }
  actor.transform.positionM = [0, 1, 0];
  platform.id = "prop_raised_surface_1";
  platform.transform.positionM = [0, 0.4, 0];
  platform.geometry = { primitive: "box", sizeM: [3, 0.8, 2] };
  return {
    scene: sceneSpecSchema.parse(scene),
    blocking: {
      schemaVersion: 1 as const,
      planId: "blocking_lying_raised_1",
      actorId: actor.id,
      seedPose: { registry: "builtin" as const, id: "pose.lying-supine-v1", version: 1 as const },
      contacts: [
        {
          constraintId: "contact_upper_back_raised_1",
          bodySite: "upper-back" as const,
          surfaceEntityId: platform.id,
          surfaceFace: "top" as const,
          role: "support" as const,
        },
      ],
      relaxedLimbs: [],
    },
  };
};

const twoActorScene = (): SceneSpec => {
  const scene = createStructuredTwoActorScene();
  const room = scene.entities.find((entity) => entity.kind === "environment");
  if (room?.kind === "environment") {
    room.preset.parameters = { ...room.preset.parameters, widthM: 14, depthM: 14, heightM: 4 };
  }
  return sceneSpecSchema.parse(scene);
};

const doorwayScene = (): SceneSpec => {
  const base = createDefaultScene();
  const actor = base.entities.find((entity) => entity.kind === "actor");
  const camera = base.entities.find((entity) => entity.kind === "camera");
  if (!actor || actor.kind !== "actor" || !camera || camera.kind !== "camera") {
    throw new Error("missing doorway fixture");
  }
  actor.transform.positionM = [2, actor.transform.positionM[1], 0];
  actor.transform.rotation = quaternionFromEulerDegrees([0, -90, 0]);
  camera.transform.positionM = [-2, 1.4, 0];
  return sceneSpecSchema.parse({
    ...base,
    sceneId: "scene_accept_doorway",
    entities: [actor, camera],
    constraints: [],
    spatialLayout: {
      floorY: 0,
      regions: [
        { id: "region_alpha", label: "Alpha", footprintXZ: [[-4, -2], [0, -2], [0, 2], [-4, 2]], heightM: 3, visible: true },
        { id: "region_beta", label: "Beta", footprintXZ: [[0, -2], [4, -2], [4, 2], [0, 2]], heightM: 3, visible: true },
      ],
      boundaries: [
        { id: "boundary_alpha_beta", label: "Shared boundary", regionIds: ["region_alpha", "region_beta"], startXZ: [0, -2], endXZ: [0, 2], heightM: 3, thicknessM: 0.1, visible: true },
      ],
      openings: [
        { id: "opening_alpha_beta", label: "Generic doorway", boundaryId: "boundary_alpha_beta", offsetM: 1.4, widthM: 1.2, bottomM: 0, heightM: 2.2, visible: true },
      ],
      connections: [
        { id: "connection_alpha_beta", label: "Doorway connection", regionIds: ["region_alpha", "region_beta"], openingId: "opening_alpha_beta", allowsPassage: true, allowsSight: true, enabled: true },
      ],
      memberships: [
        { entityId: actor.id, regionId: "region_beta" },
        { entityId: camera.id, regionId: "region_alpha" },
      ],
    },
  });
};

describe("v1 generic semantic shot black-box corpus", () => {
  it("01 seats one actor with pelvis and upper-back support", () => {
    const { scene, blocking } = seatedSupportFixture();
    const result = expectUsable(scene, plan("plan_case_01", [
      { id: "blocking_case_01", kind: "actor-blocking", plan: blocking },
      ...baseHard(),
    ], [{ id: "camera_low_case_01", kind: "camera-height", tendency: "low", weight: 1 }]));
    expect(result.candidates[0].worldDiagnostics.pose.checkedContactCount).toBe(2);
  });

  it("02 rests one actor against a box on world ground", () => {
    const { scene, blocking } = groundRestingFixture();
    const result = expectUsable(scene, plan("plan_case_02", [
      { id: "blocking_case_02", kind: "actor-blocking", plan: blocking },
      ...baseHard(),
    ]));
    expect(result.candidates[0].worldDiagnostics.pose.contacts).toHaveLength(2);
  });

  it("03 lies one actor on a raised support surface", () => {
    const { scene, blocking } = lyingRaisedFixture();
    const result = expectUsable(scene, plan("plan_case_03", [
      { id: "blocking_case_03", kind: "actor-blocking", plan: blocking },
      ...baseHard(),
    ]));
    expect(result.candidates[0].worldDiagnostics.pose.contacts[0]?.status).toBe("pass");
  });

  it("04 preserves a missing limb chain through a supported pose", () => {
    const { scene, blocking } = groundRestingFixture();
    const result = expectUsable(scene, plan("plan_case_04", [
      { id: "blocking_case_04", kind: "actor-blocking", plan: blocking },
      ...baseHard(),
    ]));
    const actor = result.candidates[0].scene.entities.find((entity) => entity.id === "actor_generic_1");
    expect(actor).toMatchObject({ body: { limbPresence: { upper_arm_l: "absent", forearm_l: "absent", hand_l: "absent" } } });
  });

  it("05 solves an available relaxed arm onto world ground", () => {
    const { scene, blocking } = groundRestingFixture();
    const result = expectUsable(scene, plan("plan_case_05", [
      { id: "blocking_case_05", kind: "actor-blocking", plan: blocking },
      ...baseHard(),
    ]));
    expect(result.candidates[0].worldDiagnostics.pose.relaxedLimbs[0]).toMatchObject({ mode: "surface-resting", status: "pass" });
  });

  it("06 places two actors facing each other", () => {
    const scene = twoActorScene();
    const hard = [
      { id: "relation_case_06", kind: "spatial-relationship" as const, subjectId: "actor_generic_2", referenceId: "actor_generic_1", relation: "right-of" as const, distance: { minM: 1.4, maxM: 1.6 }, axisFrame: "world" as const },
      { id: "facing_primary_case_06", kind: "facing" as const, subjectId: "actor_generic_1", targetEntityId: "actor_generic_2" },
      { id: "facing_secondary_case_06", kind: "facing" as const, subjectId: "actor_generic_2", targetEntityId: "actor_generic_1" },
      { id: "framing_pair_case_06", kind: "framing" as const, mode: "full" as const, targetEntityIds: ["actor_generic_1", "actor_generic_2"] },
      { id: "visible_primary_case_06", kind: "visibility" as const, entityId: "actor_generic_1", anchor: "face" as const, requiredPartIds: ["head"], minVisibleRatio: 0.25 },
      { id: "visible_secondary_case_06", kind: "visibility" as const, entityId: "actor_generic_2", anchor: "face" as const, requiredPartIds: ["head"], minVisibleRatio: 0.25 },
    ];
    expectUsable(scene, plan("plan_case_06", hard, [], ["actor_generic_1", "actor_generic_2"]));
  });

  it("07 composes one actor above another", () => {
    const scene = twoActorScene();
    const result = expectUsable(scene, plan("plan_case_07", [
      { id: "above_case_07", kind: "spatial-relationship", subjectId: "actor_generic_1", referenceId: "actor_generic_2", relation: "above", distance: { minM: 1.1, maxM: 1.3 }, axisFrame: "world" },
      { id: "framing_pair_case_07", kind: "framing", mode: "full", targetEntityIds: ["actor_generic_1", "actor_generic_2"] },
      { id: "visible_primary_case_07", kind: "visibility", entityId: "actor_generic_1", anchor: "face", requiredPartIds: ["head"], minVisibleRatio: 0.2 },
      { id: "visible_secondary_case_07", kind: "visibility", entityId: "actor_generic_2", anchor: "face", requiredPartIds: ["head"], minVisibleRatio: 0.2 },
    ], [], ["actor_generic_1", "actor_generic_2"]));
    const first = result.candidates[0].scene.entities.find(({ id }) => id === "actor_generic_1");
    const second = result.candidates[0].scene.entities.find(({ id }) => id === "actor_generic_2");
    expect((first?.transform.positionM[1] ?? 0) - (second?.transform.positionM[1] ?? 0)).toBeGreaterThan(1);
  });

  it("08 enforces required two-actor separation", () => {
    const scene = twoActorScene();
    const result = expectUsable(scene, plan("plan_case_08", [
      { id: "separation_case_08", kind: "spatial-relationship", subjectId: "actor_generic_2", referenceId: "actor_generic_1", relation: "separated", distance: { minM: 2, maxM: 2.2 }, axisFrame: "world" },
      { id: "framing_pair_case_08", kind: "framing", mode: "full", targetEntityIds: ["actor_generic_1", "actor_generic_2"] },
    ], [], ["actor_generic_1", "actor_generic_2"]));
    const first = result.candidates[0].scene.entities.find(({ id }) => id === "actor_generic_1");
    const second = result.candidates[0].scene.entities.find(({ id }) => id === "actor_generic_2");
    expect(Math.hypot(
      (first?.transform.positionM[0] ?? 0) - (second?.transform.positionM[0] ?? 0),
      (first?.transform.positionM[2] ?? 0) - (second?.transform.positionM[2] ?? 0),
    )).toBeGreaterThanOrEqual(2);
  });

  it("09 keeps a key prop in front of its actor", () => {
    const scene = wideRoomScene("scene_accept_depth_order");
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!prop || prop.kind !== "prop") throw new Error("missing prop");
    prop.transform.positionM = [0.8, 0.5, 1.2];
    const result = expectUsable(scene, plan("plan_case_09", [
      ...baseHard(),
      { id: "visible_prop_case_09", kind: "visibility", entityId: prop.id, requiredPartIds: [], minVisibleRatio: 0.2 },
      { id: "depth_order_case_09", kind: "depth-ordering", foregroundEntityId: prop.id, backgroundEntityId: "actor_generic_1", minimumDepthSeparationM: 0.2 },
    ], [], ["actor_generic_1", prop.id]));
    expect(result.candidates).toHaveLength(3);
  });

  it("10 frames an actor through a connected-layout doorway", () => {
    const scene = doorwayScene();
    const result = expectUsable(scene, plan("plan_case_10", [
      ...baseHard("actor_generic_1", "medium"),
      { id: "camera_region_case_10", kind: "inside-region", entityId: "camera_shot_1", regionId: "region_alpha", marginM: 0.1 },
    ], [
      { id: "frontal_case_10", kind: "view-angle", tendency: "frontal", side: "either", weight: 2 },
    ]));
    expect(result.candidates[0].composition.topologySafe.issueCodes).not.toContain("SIGHTLINE_INTERSECTS_WALL");
  });

  it("11 produces a full-body low-angle candidate", () => {
    const result = expectUsable(wideRoomScene("scene_accept_low_full"), plan("plan_case_11", baseHard(), [
      { id: "low_case_11", kind: "camera-height", tendency: "low", weight: 2 },
      { id: "frontal_case_11", kind: "view-angle", tendency: "frontal", side: "either", weight: 1 },
    ]));
    expect(Math.min(...result.candidates.map(({ metrics }) => metrics.cameraHeightM))).toBeLessThan(1);
  });

  it("12 produces an eye-level medium shot", () => {
    const result = expectUsable(wideRoomScene("scene_accept_eye_medium"), plan("plan_case_12", baseHard("actor_generic_1", "medium"), [
      { id: "eye_case_12", kind: "camera-height", tendency: "eye-level", weight: 2 },
    ]));
    expect(result.candidates.some(({ profile }) => profile === "balanced")).toBe(true);
  });

  it("13 produces a wider environmental alternative", () => {
    const result = expectUsable(wideRoomScene("scene_accept_environment"), plan("plan_case_13", baseHard(), [
      { id: "environment_case_13", kind: "environment-context", tendency: "wide", weight: 2 },
    ]));
    const environmental = result.candidates.find(({ profile }) => profile === "environmental");
    const balanced = result.candidates.find(({ profile }) => profile === "balanced");
    expect(environmental?.metrics.framingFill ?? 1).toBeLessThan(balanced?.metrics.framingFill ?? 0);
  });

  it("14 places a subject on the right third", () => {
    const result = expectUsable(wideRoomScene("scene_accept_right_third"), plan("plan_case_14", baseHard(), [
      { id: "right_case_14", kind: "screen-placement", entityId: "actor_generic_1", horizontal: "right", weight: 2 },
    ]));
    expect(result.candidates[0].metrics.targetCenterNdc[0]).toBeGreaterThan(0.15);
  });

  it("15 frames two subjects together", () => {
    const scene = twoActorScene();
    const result = expectUsable(scene, plan("plan_case_15", [
      { id: "framing_pair_case_15", kind: "framing", mode: "full", targetEntityIds: ["actor_generic_1", "actor_generic_2"] },
      { id: "visible_primary_case_15", kind: "visibility", entityId: "actor_generic_1", anchor: "face", requiredPartIds: ["head"], minVisibleRatio: 0.2 },
      { id: "visible_secondary_case_15", kind: "visibility", entityId: "actor_generic_2", anchor: "face", requiredPartIds: ["head"], minVisibleRatio: 0.2 },
    ], [], ["actor_generic_1", "actor_generic_2"]));
    expect(result.candidates[0].scene.compositionGoals?.framing?.targetEntityIds).toHaveLength(2);
  });

  it("16 requires face and head visibility", () => {
    const result = expectUsable(wideRoomScene("scene_accept_face_visible"), plan("plan_case_16", baseHard("actor_generic_1", "medium-close"), [
      { id: "face_read_case_16", kind: "face-readability", actorId: "actor_generic_1", weight: 2 },
    ]));
    expect(result.candidates[0].scene.constraints.some((constraint) => constraint.type === "keep-visible" && constraint.subjectEntityId === "actor_generic_1")).toBe(true);
  });

  it("17 solves a caption-safe composition", () => {
    const result = expectUsable(wideRoomScene("scene_accept_caption_safe"), plan("plan_case_17", [
      ...baseHard("actor_generic_1", "medium"),
      { id: "caption_safe_case_17", kind: "safe-area", captionBottomFraction: 0.18 },
    ]));
    expect(result.candidates[0].composition.captionSafe.issueCodes).not.toContain("SUBJECT_OVERLAPS_CAPTION_ZONE");
  });

  it("18 rejects an impossible body-contact request", () => {
    const scene = wideRoomScene("scene_accept_impossible_contact");
    scene.constraints = [];
    const actor = scene.entities.find((entity) => entity.kind === "actor");
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!actor || actor.kind !== "actor" || !prop || prop.kind !== "prop") throw new Error("missing fixture");
    actor.transform.positionM = [0, 0.1, 0];
    prop.id = "prop_unreachable_arm_rest_1";
    prop.transform.positionM = [0, 0.4, 0];
    prop.geometry = { primitive: "box", sizeM: [2.4, 0.2, 2.4] };
    const impossible = plan("plan_case_18", [
      {
        id: "blocking_case_18",
        kind: "actor-blocking",
        plan: {
          schemaVersion: 1,
          planId: "blocking_unreachable_case_18",
          actorId: actor.id,
          contacts: [],
          relaxedLimbs: [
            { constraintId: "relaxed_unreachable_case_18", limb: "arm-r", restSurface: { surfaceEntityId: prop.id, surfaceFace: "top" } },
          ],
        },
      },
      ...baseHard(),
    ]);
    expect(() => solveSemanticShot(sceneSpecSchema.parse(scene), impossible)).toThrowError("deterministic pose or contact failure");
  });

  it("19 rejects contradictory spatial relationships", () => {
    const impossible = plan("plan_case_19", [
      { id: "left_case_19", kind: "spatial-relationship", subjectId: "actor_generic_1", referenceId: "prop_block_1", relation: "left-of", distance: { minM: 1, maxM: 1 }, axisFrame: "world" },
      { id: "right_case_19", kind: "spatial-relationship", subjectId: "actor_generic_1", referenceId: "prop_block_1", relation: "right-of", distance: { minM: 1, maxM: 1 }, axisFrame: "world" },
      ...baseHard(),
    ]);
    expect(() => solveSemanticShot(wideRoomScene("scene_accept_contradiction"), impossible)).toThrowError("incompatible directions");
  });

  it("20 rejects an impossible camera collision case", () => {
    const scene = wideRoomScene("scene_accept_camera_collision");
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!prop || prop.kind !== "prop") throw new Error("missing prop");
    prop.transform.positionM = [0, 0, 0];
    prop.geometry.sizeM = [100, 100, 100];
    expect(() => solveSemanticShot(sceneSpecSchema.parse(scene), plan("plan_case_20", baseHard()))).toThrowError("No camera candidate satisfies all hard shot constraints");
  });
});
