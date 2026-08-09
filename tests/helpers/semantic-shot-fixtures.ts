import { createDefaultScene } from "../../src/domain/default-scene";
import {
  intentReportSchema,
  type IntentConstraint,
  type IntentReport,
} from "../../src/domain/intent-report";
import { quaternionFromEulerDegrees } from "../../src/domain/scene-math";
import { sceneSpecSchema, type SceneSpec } from "../../src/domain/scene-schema";
import {
  shotIntentPlanSchema,
  type ShotIntentPlan,
} from "../../src/domain/shot-intent";
import type { ShotSolveSubmission } from "../../src/domain/shot-solve-submission";

const ACTOR_ID = "actor_generic_1";
const SUPPORT_ID = "prop_back_support_1";
const CAMERA_ID = "camera_shot_1";

const createFlagshipScene = (sideOn: boolean): SceneSpec => {
  const scene = createDefaultScene();
  scene.sceneId = sideOn
    ? "scene_semantic_flagship_side_on_negative"
    : "scene_semantic_flagship_1";
  scene.title = sideOn
    ? "Generic semantic flagship side-on negative"
    : "Generic semantic flagship shot";
  scene.constraints = [];
  const environment = scene.entities.find((entity) => entity.kind === "environment");
  const actor = scene.entities.find((entity) => entity.kind === "actor");
  const support = scene.entities.find((entity) => entity.kind === "prop");
  if (
    !environment || environment.kind !== "environment" ||
    !actor || actor.kind !== "actor" ||
    !support || support.kind !== "prop"
  ) {
    throw new Error("The default scene is missing the semantic flagship fixtures.");
  }
  environment.label = "Generic graybox room";
  environment.preset.parameters = {
    ...environment.preset.parameters,
    widthM: 10,
    depthM: 10,
    heightM: 3.5,
  };
  actor.label = "Generic partial-limb actor";
  actor.transform.positionM = [0, 0.5, 0];
  actor.transform.rotation = sideOn
    ? quaternionFromEulerDegrees([0, 90, 0])
    : [0, 0, 0, 1];
  actor.body.limbPresence.upper_arm_l = "absent";
  actor.body.limbPresence.forearm_l = "absent";
  actor.body.limbPresence.hand_l = "absent";
  support.id = SUPPORT_ID;
  support.label = "Generic low back support";
  support.transform.positionM = [0, 0.5, -0.5];
  support.geometry = { primitive: "box", sizeM: [1.4, 0.5, 0.3] };
  return sceneSpecSchema.parse(scene);
};

const createFlagshipPlan = (sideOn: boolean): ShotIntentPlan =>
  shotIntentPlanSchema.parse({
    schemaVersion: 1,
    planId: sideOn
      ? "plan_semantic_flagship_side_on_negative"
      : "plan_semantic_flagship_1",
    operation: "create",
    cameraId: CAMERA_ID,
    primaryTargetIds: [ACTOR_ID],
    hardConstraints: [
      {
        id: "flagship_support_behind_1",
        kind: "spatial-relationship",
        subjectId: SUPPORT_ID,
        referenceId: ACTOR_ID,
        relation: "behind",
        distance: { minM: 0.2, maxM: 0.9 },
        axisFrame: "reference",
      },
      {
        id: "flagship_blocking_1",
        kind: "actor-blocking",
        plan: {
          schemaVersion: 1,
          planId: "blocking_semantic_flagship_1",
          actorId: ACTOR_ID,
          trunk: { lean: { direction: "backward", angleDeg: 20 } },
          legPosture: "bent-resting",
          contacts: [
            {
              constraintId: "contact_flagship_pelvis_ground_1",
              bodySite: "pelvis",
              surfaceEntityId: null,
              surfaceFace: "top",
              role: "support",
            },
            {
              constraintId: "contact_flagship_upper_back_support_1",
              bodySite: "upper-back",
              surfaceEntityId: SUPPORT_ID,
              surfaceFace: "front",
              role: "support",
            },
          ],
          relaxedLimbs: [
            {
              constraintId: "relaxed_flagship_arm_r_ground_1",
              limb: "arm-r",
              restSurface: { surfaceEntityId: null, surfaceFace: "top" },
            },
          ],
        },
      },
      {
        id: "flagship_visibility_face_1",
        kind: "visibility",
        entityId: ACTOR_ID,
        anchor: "face",
        requiredPartIds: ["head"],
        minVisibleRatio: 0.35,
      },
      {
        id: "flagship_framing_full_1",
        kind: "framing",
        mode: "full",
        targetEntityIds: [ACTOR_ID],
      },
      {
        id: "flagship_camera_clearance_1",
        kind: "camera-clearance",
        minimumEntityDistanceM: 0.05,
      },
    ],
    softPreferences: [
      {
        id: "flagship_camera_low_1",
        kind: "camera-height",
        tendency: "low",
        weight: 1,
      },
      {
        id: "flagship_actor_right_1",
        kind: "screen-placement",
        entityId: ACTOR_ID,
        horizontal: "right",
        weight: 1,
      },
      {
        id: "flagship_view_three_quarter_1",
        kind: "view-angle",
        tendency: "three-quarter",
        side: "either",
        weight: 0.8,
      },
      {
        id: "flagship_lens_normal_1",
        kind: "lens",
        tendency: "normal",
        weight: 0.6,
      },
      {
        id: "flagship_face_readability_1",
        kind: "face-readability",
        actorId: ACTOR_ID,
        weight: 1,
      },
    ],
    candidateCount: 3,
  });

const intentConstraint = (
  value: IntentConstraint,
): IntentConstraint => value;

const createFlagshipIntentReport = (): IntentReport => intentReportSchema.parse({
  schemaVersion: 6,
  operation: "create",
  allowPartial: false,
  recognizedConstraints: [
    intentConstraint({
      id: "flagship_support_behind_1",
      kind: "relationship",
      required: true,
      targets: [ACTOR_ID, SUPPORT_ID],
      evidence: [
        {
          type: "scene-constraint",
          constraintId: "contact_flagship_upper_back_support_1",
        },
      ],
    }),
    intentConstraint({
      id: "flagship_blocking_1",
      kind: "contact",
      required: true,
      targets: [ACTOR_ID, SUPPORT_ID],
      evidence: [
        {
          type: "scene-constraint",
          constraintId: "contact_flagship_pelvis_ground_1",
        },
        {
          type: "scene-constraint",
          constraintId: "contact_flagship_upper_back_support_1",
        },
      ],
    }),
    intentConstraint({
      id: "flagship_visibility_face_1",
      kind: "composition-safety",
      required: true,
      targets: [CAMERA_ID, ACTOR_ID],
      evidence: [
        {
          type: "scene-constraint",
          constraintId: "flagship_visibility_face_1",
        },
      ],
    }),
    intentConstraint({
      id: "flagship_framing_full_1",
      kind: "framing",
      required: true,
      targets: [ACTOR_ID],
      evidence: [
        { type: "scene-property", path: "scene.compositionGoals.framing" },
      ],
    }),
    intentConstraint({
      id: "flagship_camera_clearance_1",
      kind: "composition-safety",
      required: true,
      targets: [CAMERA_ID],
      evidence: [
        { type: "scene-property", path: "scene.activeCameraId" },
      ],
    }),
    intentConstraint({
      id: "flagship_partial_limb_1",
      kind: "actor-limb-presence",
      required: true,
      targets: [ACTOR_ID],
      evidence: [
        {
          type: "entity-property",
          entityId: ACTOR_ID,
          path: "entity.body.limbPresence.upper_arm_l",
        },
        {
          type: "entity-property",
          entityId: ACTOR_ID,
          path: "entity.body.limbPresence.forearm_l",
        },
        {
          type: "entity-property",
          entityId: ACTOR_ID,
          path: "entity.body.limbPresence.hand_l",
        },
      ],
    }),
  ],
  unsupportedConstraints: [],
  unresolvedRelations: [],
  warnings: [],
  canApplySafely: true,
});

export const createFlagshipShotSubmission = (
  sideOn = false,
): ShotSolveSubmission => ({
  intentReport: createFlagshipIntentReport(),
  scene: createFlagshipScene(sideOn),
  plan: createFlagshipPlan(sideOn),
});
