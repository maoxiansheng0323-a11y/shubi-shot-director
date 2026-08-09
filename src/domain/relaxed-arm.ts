import { Matrix4, Quaternion, Vector3 } from "three";
import { actorVisiblePrimitivePointClouds } from "./actor-visible-bounds";
import {
  resolveActorJointParentRotations,
  resolveActorProjection,
} from "./actor-projection";
import {
  measureBodyContact,
  resolveContactSurface,
} from "./body-contacts";
import { diagnoseJointLimits } from "./joint-constraints";
import {
  quaternionFromEulerDegrees,
  transformPoint,
} from "./scene-math";
import type {
  AnyActorEntity,
  QuaternionTuple,
  SceneSpec,
  Vec3,
} from "./scene-schema";
import {
  BODY_CONTACT_TOLERANCE_M,
  type RelaxedLimb,
  type StaticBlockingPlan,
} from "./static-blocking-schema";

export type RelaxedArmRestSurface = NonNullable<
  StaticBlockingPlan["relaxedLimbs"][number]["restSurface"]
>;

export const RELAXED_ARM_SURFACE_EPSILON_M = 0.00001;

export interface SurfaceRestingArmMeasurement {
  readonly terminalBodySite: "hand-l" | "hand-r";
  readonly terminalPointWorld: Vec3;
  readonly surfacePointWorld: Vec3;
  readonly terminalGapM: number;
  readonly terminalPenetrationM: number;
  readonly boundsOverflowM: number;
  readonly armMinGapM: number;
  readonly shoulderPointWorld: Vec3;
  readonly wristPointWorld: Vec3;
  readonly terminalDropM: number;
  readonly surfaceGravityOpposition: number;
}

const gravityDirection: Vec3 = [0, -1, 0];
const baseBoneDirection = new Vector3(0, -1, 0);
const terminalJointIdentity: QuaternionTuple = [0, 0, 0, 1];

const dot = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const addScaled = (point: Vec3, direction: Vec3, scale: number): Vec3 => [
  point[0] + direction[0] * scale,
  point[1] + direction[1] * scale,
  point[2] + direction[2] * scale,
];

const normalized = (value: Vector3): Vector3 | null =>
  value.lengthSq() <= 1e-18 ? null : value.normalize();

const quaternionTuple = (value: Quaternion): QuaternionTuple => [
  value.x,
  value.y,
  value.z,
  value.w,
];

const jointIdsFor = (limb: RelaxedLimb) => {
  const side = limb === "arm-l" ? "l" : "r";
  return {
    side,
    upperId: `upper_arm_${side}` as const,
    forearmId: `forearm_${side}` as const,
    handId: `hand_${side}` as const,
    shoulderId: `shoulder_${side}` as const,
    elbowId: `elbow_${side}` as const,
    wristId: `wrist_${side}` as const,
    terminalBodySite: `hand-${side}` as const,
  };
};

const desiredDirectionInParent = (
  actor: AnyActorEntity,
  parentRotation: QuaternionTuple,
  worldDirection: Vec3,
): Vector3 => {
  const actorRotation = new Quaternion(...actor.transform.rotation);
  const parent = new Quaternion(...parentRotation);
  return new Vector3(...worldDirection)
    .applyQuaternion(actorRotation.multiply(parent).invert())
    .normalize();
};

export const materializeFreeHangingArm = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  limb: RelaxedLimb,
): void => {
  const { upperId, forearmId, handId } = jointIdsFor(limb);
  const parents = resolveActorJointParentRotations(scene, actor);
  const desired = desiredDirectionInParent(
    actor,
    parents[upperId],
    gravityDirection,
  );
  const upper = new Quaternion().setFromUnitVectors(
    baseBoneDirection,
    desired,
  );
  actor.pose.joints[upperId] = quaternionTuple(upper.normalize());
  actor.pose.joints[forearmId] = quaternionFromEulerDegrees([-12, 0, 0]);
  actor.pose.joints[handId] = terminalJointIdentity;
};

const actorLocalPoint = (
  actor: AnyActorEntity,
  worldPoint: Vec3,
): Vector3 => {
  const local = new Vector3(
    worldPoint[0] - actor.transform.positionM[0],
    worldPoint[1] - actor.transform.positionM[1],
    worldPoint[2] - actor.transform.positionM[2],
  ).applyQuaternion(
    new Quaternion(...actor.transform.rotation).normalize().invert(),
  );
  local.set(
    local.x / actor.transform.scale[0],
    local.y / actor.transform.scale[1],
    local.z / actor.transform.scale[2],
  );
  return local;
};

const perpendicularReference = (
  targetDirection: Vector3,
  reference: Vector3,
): Vector3 | null =>
  normalized(
    reference
      .clone()
      .addScaledVector(
        targetDirection,
        -reference.dot(targetDirection),
      ),
  );

const clearsDeclaredBodyContactSurfaces = (
  scene: SceneSpec,
  actorId: string,
): boolean =>
  scene.constraints
    .filter(
      (constraint): constraint is Extract<
        SceneSpec["constraints"][number],
        { type: "body-contact" }
      > =>
        constraint.type === "body-contact" &&
        constraint.enabled &&
        constraint.actorId === actorId,
    )
    .every((constraint) => {
      try {
        return (
          measureBodyContact(scene, constraint).actorMinGapM >=
          -constraint.toleranceM
        );
      } catch {
        return false;
      }
    });

const solveTwoBoneToWrist = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  limb: RelaxedLimb,
  wristTargetWorld: Vec3,
): boolean => {
  const {
    side,
    upperId,
    forearmId,
    handId,
    shoulderId,
  } = jointIdsFor(limb);
  const projection = resolveActorProjection(scene, actor);
  const shoulder = new Vector3(
    ...projection.mountFrames[shoulderId].position,
  );
  const target = actorLocalPoint(actor, wristTargetWorld);
  const shoulderToTarget = target.clone().sub(shoulder);
  const targetDistance = shoulderToTarget.length();
  const upperLength = projection.dimensions.upperArmLength;
  const lowerLength = projection.dimensions.forearmLength;
  if (
    targetDistance <= 1e-8 ||
    targetDistance >= upperLength + lowerLength - 1e-6 ||
    targetDistance <= Math.abs(upperLength - lowerLength) + 1e-6
  ) {
    return false;
  }

  const elbowAngleRad = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        (targetDistance * targetDistance -
          upperLength * upperLength -
          lowerLength * lowerLength) /
          (2 * upperLength * lowerLength),
      ),
    ),
  );
  const elbowAngleDeg = (elbowAngleRad * 180) / Math.PI;
  if (elbowAngleDeg < 1 || elbowAngleDeg > 149.5) return false;

  const targetDirection = shoulderToTarget.normalize();
  const shoulderAngleRad = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        (upperLength * upperLength +
          targetDistance * targetDistance -
          lowerLength * lowerLength) /
          (2 * upperLength * targetDistance),
      ),
    ),
  );
  const parentRotation = new Quaternion(
    ...resolveActorJointParentRotations(scene, actor)[upperId],
  ).normalize();
  const references = [
    new Vector3(0, 0, -1).applyQuaternion(parentRotation),
    new Vector3(side === "l" ? 1 : -1, 0, 0).applyQuaternion(
      parentRotation,
    ),
    new Vector3(0, 0, 1).applyQuaternion(parentRotation),
  ];
  const previous = {
    upper: actor.pose.joints[upperId],
    forearm: actor.pose.joints[forearmId],
    hand: actor.pose.joints[handId],
  };

  for (const reference of references) {
    const elbowOffset = perpendicularReference(targetDirection, reference);
    if (!elbowOffset) continue;
    const upperDirection = targetDirection
      .clone()
      .multiplyScalar(Math.cos(shoulderAngleRad))
      .addScaledVector(elbowOffset, Math.sin(shoulderAngleRad))
      .normalize();
    const elbow = shoulder
      .clone()
      .addScaledVector(upperDirection, upperLength);
    const lowerDirection = target.clone().sub(elbow).normalize();
    const bendDirection = normalized(
      lowerDirection
        .clone()
        .addScaledVector(
          upperDirection,
          -lowerDirection.dot(upperDirection),
        ),
    );
    if (!bendDirection) continue;

    const yAxis = upperDirection.clone().negate();
    const zAxis = bendDirection;
    const xAxis = normalized(new Vector3().crossVectors(yAxis, zAxis));
    if (!xAxis) continue;
    const globalUpper = new Quaternion()
      .setFromRotationMatrix(
        new Matrix4().makeBasis(xAxis, yAxis, zAxis),
      )
      .normalize();
    const localUpper = parentRotation
      .clone()
      .invert()
      .multiply(globalUpper)
      .normalize();
    actor.pose.joints[upperId] = quaternionTuple(localUpper);
    actor.pose.joints[forearmId] = quaternionFromEulerDegrees([
      -elbowAngleDeg,
      0,
      0,
    ]);
    actor.pose.joints[handId] = terminalJointIdentity;

    const invalidCandidate = diagnoseJointLimits(actor.pose).some(
      ({ jointId }) =>
        jointId === upperId ||
        jointId === forearmId ||
        jointId === handId,
    );
    if (
      !invalidCandidate &&
      clearsDeclaredBodyContactSurfaces(scene, actor.id)
    ) {
      return true;
    }
  }

  actor.pose.joints[upperId] = previous.upper;
  actor.pose.joints[forearmId] = previous.forearm;
  actor.pose.joints[handId] = previous.hand;
  return false;
};

export const measureSurfaceRestingArm = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  limb: RelaxedLimb,
  restSurface: RelaxedArmRestSurface,
): SurfaceRestingArmMeasurement => {
  const {
    side,
    shoulderId,
    wristId,
    terminalBodySite,
  } = jointIdsFor(limb);
  const terminal = measureBodyContact(scene, {
    id: `diagnostic_${actor.id}_${limb}`,
    type: "body-contact",
    actorId: actor.id,
    bodySite: terminalBodySite,
    surfaceEntityId: restSurface.surfaceEntityId,
    surfaceFace: restSurface.surfaceFace,
    role: "contact",
    toleranceM: BODY_CONTACT_TOLERANCE_M,
    enabled: true,
  });
  const surface = resolveContactSurface(
    scene,
    restSurface.surfaceEntityId,
    restSurface.surfaceFace,
  );
  const projection = resolveActorProjection(scene, actor);
  const shoulderPointWorld = transformPoint(
    actor.transform,
    projection.mountFrames[shoulderId].position,
  );
  const wristPointWorld = transformPoint(
    actor.transform,
    projection.mountFrames[wristId].position,
  );
  const armPrimitiveIds = new Set([
    `upper_arm_${side}`,
    `elbow_${side}`,
    `forearm_${side}`,
    `hand_${side}`,
  ]);
  const armPoints = actorVisiblePrimitivePointClouds(scene, actor).flatMap(
    ({ primitiveId, worldPoints }) =>
      armPrimitiveIds.has(primitiveId) ? worldPoints : [],
  );
  const armMinGapM = Math.min(
    ...armPoints.map((point) =>
      dot(subtract(point, surface.point), surface.normal),
    ),
  );

  return {
    terminalBodySite,
    terminalPointWorld: terminal.bodyPointWorld,
    surfacePointWorld: terminal.surfacePointWorld,
    terminalGapM: terminal.gapM,
    terminalPenetrationM: terminal.penetrationM,
    boundsOverflowM: terminal.boundsOverflowM,
    armMinGapM,
    shoulderPointWorld,
    wristPointWorld,
    terminalDropM: dot(
      subtract(terminal.bodyPointWorld, shoulderPointWorld),
      gravityDirection,
    ),
    surfaceGravityOpposition: -dot(surface.normal, gravityDirection),
  };
};

export const materializeSurfaceRestingArm = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  limb: RelaxedLimb,
  restSurface: RelaxedArmRestSurface,
): boolean => {
  const initial = measureSurfaceRestingArm(scene, actor, limb, restSurface);
  if (
    initial.surfaceGravityOpposition < 0.5 ||
    (initial.terminalGapM >= -RELAXED_ARM_SURFACE_EPSILON_M &&
      initial.armMinGapM >= -RELAXED_ARM_SURFACE_EPSILON_M)
  ) {
    return false;
  }

  const surface = resolveContactSurface(
    scene,
    restSurface.surfaceEntityId,
    restSurface.surfaceFace,
  );
  const denominator = dot(gravityDirection, surface.normal);
  if (denominator >= -0.5) return false;
  const rayDistance =
    dot(subtract(surface.point, initial.shoulderPointWorld), surface.normal) /
    denominator;
  if (rayDistance <= 0) return false;

  const contactTarget = addScaled(
    initial.shoulderPointWorld,
    gravityDirection,
    rayDistance,
  );
  const initialWristClearance = Math.max(
    0.001,
    dot(
      subtract(initial.wristPointWorld, initial.terminalPointWorld),
      surface.normal,
    ),
  );
  let wristTarget = addScaled(
    contactTarget,
    surface.normal,
    initialWristClearance,
  );

  for (let iteration = 0; iteration < 12; iteration += 1) {
    if (!solveTwoBoneToWrist(scene, actor, limb, wristTarget)) return false;
    const measurement = measureSurfaceRestingArm(
      scene,
      actor,
      limb,
      restSurface,
    );
    if (Math.abs(measurement.terminalGapM) <= 1e-7) break;
    wristTarget = addScaled(
      wristTarget,
      surface.normal,
      -measurement.terminalGapM,
    );
  }

  const solved = measureSurfaceRestingArm(scene, actor, limb, restSurface);
  return (
    Math.abs(solved.terminalGapM) <= RELAXED_ARM_SURFACE_EPSILON_M &&
    solved.boundsOverflowM <= BODY_CONTACT_TOLERANCE_M &&
    solved.armMinGapM >= -RELAXED_ARM_SURFACE_EPSILON_M &&
    solved.terminalDropM > BODY_CONTACT_TOLERANCE_M
  );
};
