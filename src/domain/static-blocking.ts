import { actorStatureHeightM } from "./actor-stature";
import { enforceBodyContacts } from "./body-contacts";
import { mutationBlockedByLock } from "./entity-lock";
import { assertPoseDiagnostics } from "./pose-diagnostics";
import { materializePose } from "./presets/pose-presets";
import {
  materializeFreeHangingArm,
  materializeSurfaceRestingArm,
} from "./relaxed-arm";
import { quaternionFromEulerDegrees } from "./scene-math";
import {
  isBlueprintActorEntity,
  sceneSpecSchema,
  type AnyActorEntity,
  type SceneSpec,
} from "./scene-schema";
import {
  BODY_CONTACT_TOLERANCE_M,
  staticBlockingPlanSchema,
  type StaticBlockingPlan,
} from "./static-blocking-schema";

export type StaticBlockingErrorCode =
  | "STATIC_BLOCKING_ACTOR_NOT_FOUND"
  | "STATIC_BLOCKING_CONSTRAINT_CONFLICT"
  | "STATIC_BLOCKING_POSE_PRESET_INVALID"
  | "USER_LOCKED"
  | "WORKFLOW_LOCKED";

export class StaticBlockingError extends Error {
  readonly code: StaticBlockingErrorCode;

  constructor(code: StaticBlockingErrorCode, message: string) {
    super(message);
    this.name = "StaticBlockingError";
    this.code = code;
  }
}

const actorById = (
  scene: SceneSpec,
  actorId: string,
): AnyActorEntity | undefined =>
  scene.entities.find(
    (entity): entity is AnyActorEntity =>
      entity.kind === "actor" && entity.id === actorId,
  );

const assertConstraintSlotsAvailable = (
  scene: SceneSpec,
  plan: StaticBlockingPlan,
): void => {
  if (
    plan.contacts.length > 0 &&
    scene.constraints.some(
      (constraint) =>
        constraint.type === "ground-contact" &&
        constraint.enabled &&
        constraint.entityId === plan.actorId,
    )
  ) {
    throw new StaticBlockingError(
      "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
      "Static body contact cannot share control with ground contact.",
    );
  }
  for (const contact of plan.contacts) {
    const existingId = scene.constraints.find(
      ({ id }) => id === contact.constraintId,
    );
    if (
      existingId &&
      (existingId.type !== "body-contact" ||
        existingId.actorId !== plan.actorId ||
        existingId.bodySite !== contact.bodySite)
    ) {
      throw new StaticBlockingError(
        "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
        "The body-contact constraint ID is already owned by another goal.",
      );
    }
    const conflict = scene.constraints.find(
      (constraint) =>
        constraint.type === "body-contact" &&
        constraint.enabled &&
        constraint.actorId === plan.actorId &&
        constraint.bodySite === contact.bodySite &&
        constraint.id !== contact.constraintId,
    );
    if (conflict) {
      throw new StaticBlockingError(
        "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
        "The actor body site already has an enabled contact.",
      );
    }
  }
  for (const relaxed of plan.relaxedLimbs) {
    const existingId = scene.constraints.find(
      ({ id }) => id === relaxed.constraintId,
    );
    if (
      existingId &&
      (existingId.type !== "relaxed-limb" ||
        existingId.actorId !== plan.actorId ||
        existingId.limb !== relaxed.limb)
    ) {
      throw new StaticBlockingError(
        "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
        "The relaxed-limb constraint ID is already owned by another goal.",
      );
    }
    const conflict = scene.constraints.find(
      (constraint) =>
        constraint.type === "relaxed-limb" &&
        constraint.enabled &&
        constraint.actorId === plan.actorId &&
        constraint.limb === relaxed.limb &&
        constraint.id !== relaxed.constraintId,
    );
    if (conflict) {
      throw new StaticBlockingError(
        "STATIC_BLOCKING_CONSTRAINT_CONFLICT",
        "The actor limb already has an enabled relaxed goal.",
      );
    }
  }
};

const upsertConstraint = (
  scene: SceneSpec,
  value: SceneSpec["constraints"][number],
): void => {
  const index = scene.constraints.findIndex(({ id }) => id === value.id);
  if (index === -1) {
    scene.constraints.push(value);
  } else {
    scene.constraints[index] = value;
  }
};

export const materializeStaticBlockingPlan = (
  sceneInput: SceneSpec,
  planInput: StaticBlockingPlan,
  options: { preserveLock?: boolean } = {},
): SceneSpec => {
  const plan = staticBlockingPlanSchema.parse(planInput);
  const scene = structuredClone(sceneInput);
  const actor = actorById(scene, plan.actorId);
  if (!actor) {
    throw new StaticBlockingError(
      "STATIC_BLOCKING_ACTOR_NOT_FOUND",
      "The static blocking actor does not exist.",
    );
  }
  const lockError = mutationBlockedByLock(
    actor.lockMode,
    options.preserveLock === true,
  );
  if (lockError !== null) {
    throw new StaticBlockingError(
      lockError,
      "The static blocking actor is protected.",
    );
  }
  assertConstraintSlotsAvailable(scene, plan);

  if (plan.seedPose) {
    try {
      actor.pose = materializePose(
        actor,
        plan.seedPose.id,
        isBlueprintActorEntity(actor)
          ? actorStatureHeightM(scene, actor)
          : undefined,
      );
    } catch {
      throw new StaticBlockingError(
        "STATIC_BLOCKING_POSE_PRESET_INVALID",
        "The static blocking pose seed is invalid.",
      );
    }
  }

  if (plan.trunk) {
    const leanDeg = plan.trunk.lean
      ? plan.trunk.lean.angleDeg *
        (plan.trunk.lean.direction === "forward" ? 1 : -1)
      : 0;
    actor.pose.joints.spine = quaternionFromEulerDegrees([
      plan.trunk.lean ? leanDeg : 0,
      plan.trunk.twistDeg ?? 0,
      plan.trunk.sideBendDeg ?? 0,
    ]);
    if (plan.trunk.lean) {
      actor.pose.joints.neck = quaternionFromEulerDegrees([
        -leanDeg,
        0,
        0,
      ]);
    }
  }

  if (plan.legPosture === "bent-resting") {
    actor.pose.joints.upper_leg_l = quaternionFromEulerDegrees([-122, 0, 8]);
    actor.pose.joints.lower_leg_l = quaternionFromEulerDegrees([55, 0, 0]);
    actor.pose.joints.foot_l = quaternionFromEulerDegrees([0, 0, 0]);
    actor.pose.joints.upper_leg_r = quaternionFromEulerDegrees([-122, 0, -8]);
    actor.pose.joints.lower_leg_r = quaternionFromEulerDegrees([55, 0, 0]);
    actor.pose.joints.foot_r = quaternionFromEulerDegrees([0, 0, 0]);
  }

  actor.pose.preset = {
    ...actor.pose.preset,
    id: "pose.static-blocking-v1",
  };

  for (const contact of plan.contacts) {
    upsertConstraint(scene, {
      id: contact.constraintId,
      type: "body-contact",
      actorId: actor.id,
      bodySite: contact.bodySite,
      surfaceEntityId: contact.surfaceEntityId,
      surfaceFace: contact.surfaceFace,
      role: contact.role,
      toleranceM: BODY_CONTACT_TOLERANCE_M,
      enabled: true,
    });
  }
  const projected = enforceBodyContacts(
    sceneSpecSchema.parse(scene),
    new Set([
      actor.id,
      ...plan.contacts.flatMap(({ surfaceEntityId }) =>
        surfaceEntityId === null ? [] : [surfaceEntityId],
      ),
    ]),
    options,
  );
  const projectedActor = actorById(projected, actor.id);
  if (!projectedActor) {
    throw new StaticBlockingError(
      "STATIC_BLOCKING_ACTOR_NOT_FOUND",
      "The static blocking actor does not exist after contact projection.",
    );
  }
  for (const relaxed of plan.relaxedLimbs) {
    materializeFreeHangingArm(projected, projectedActor, relaxed.limb);
    if (relaxed.restSurface) {
      materializeSurfaceRestingArm(
        projected,
        projectedActor,
        relaxed.limb,
        relaxed.restSurface,
      );
    }
    upsertConstraint(projected, {
      id: relaxed.constraintId,
      type: "relaxed-limb",
      actorId: projectedActor.id,
      limb: relaxed.limb,
      gravityDirection: [0, -1, 0],
      maxDeviationDeg: 20,
      ...(relaxed.restSurface
        ? { restSurface: relaxed.restSurface }
        : {}),
      enabled: true,
    });
  }

  const materialized = sceneSpecSchema.parse(projected);
  assertPoseDiagnostics(materialized);
  return materialized;
};

export const materializeStaticBlockingPlans = (
  sceneInput: SceneSpec,
  plansInput: readonly StaticBlockingPlan[],
): SceneSpec => {
  let scene = sceneSpecSchema.parse(sceneInput);
  for (const plan of plansInput) {
    scene = materializeStaticBlockingPlan(scene, plan);
  }
  return scene;
};
