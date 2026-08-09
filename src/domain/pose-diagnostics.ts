import {
  BodyContactError,
  measureBodyContact,
  resolveContactSurface,
  type BodyContactMeasurement,
} from "./body-contacts";
import {
  canonicalPuppetJointIds,
  type CanonicalPuppetJointId,
} from "./actor-joints";
import {
  resolveActorProjection,
  type ActorProjectionPrimitive,
} from "./actor-projection";
import {
  diagnoseJointLimits,
  jointEulerDegrees,
  type JointLimitViolation,
} from "./joint-constraints";
import type {
  AnyActorEntity,
  SceneSpec,
  Vec3,
} from "./scene-schema";
import { rotateVector } from "./scene-math";

export const poseDiagnosticStatuses = ["pass", "check", "fail"] as const;
export type PoseDiagnosticStatus =
  (typeof poseDiagnosticStatuses)[number];

export type PoseDiagnosticIssueCode =
  | "JOINT_LIMIT_EXCEEDED"
  | "JOINT_BEND_REVERSED"
  | "BODY_CONTACT_GAP"
  | "BODY_CONTACT_PENETRATION"
  | "BODY_CONTACT_OUT_OF_BOUNDS"
  | "BODY_CONTACT_SURFACE_INVALID"
  | "BODY_CONTACT_SITE_UNAVAILABLE"
  | "ACTOR_SURFACE_PENETRATION"
  | "SUPPORT_DIRECTION_INVALID"
  | "RELAXED_LIMB_UNAVAILABLE"
  | "RELAXED_LIMB_DIRECTION";

export interface PoseDiagnosticIssue {
  readonly code: PoseDiagnosticIssueCode;
  readonly status: "check" | "fail";
  readonly actorId: string;
  readonly constraintId?: string;
  readonly jointId?: CanonicalPuppetJointId;
  readonly axis?: "x" | "y" | "z";
  readonly measured?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly tolerance?: number;
}

export interface ActorJointDiagnostic {
  readonly actorId: string;
  readonly jointId: CanonicalPuppetJointId;
  readonly eulerDeg: Vec3;
}

export interface ContactDiagnostic extends BodyContactMeasurement {
  readonly constraintId: string;
  readonly role: "contact" | "support";
  readonly toleranceM: number;
  readonly status: PoseDiagnosticStatus;
}

export interface RelaxedLimbDiagnostic {
  readonly constraintId: string;
  readonly actorId: string;
  readonly limb: "arm-l" | "arm-r";
  readonly gravityDirection: Vec3;
  readonly upperDeviationDeg: number | null;
  readonly lowerDeviationDeg: number | null;
  readonly maxDeviationDeg: number;
  readonly status: PoseDiagnosticStatus;
}

export interface PoseDiagnosticsReport {
  readonly status: PoseDiagnosticStatus;
  readonly actorCount: number;
  readonly checkedJointCount: number;
  readonly checkedContactCount: number;
  readonly checkedRelaxedLimbCount: number;
  readonly joints: ActorJointDiagnostic[];
  readonly jointViolations: Array<JointLimitViolation & { actorId: string }>;
  readonly contacts: ContactDiagnostic[];
  readonly relaxedLimbs: RelaxedLimbDiagnostic[];
  readonly issues: PoseDiagnosticIssue[];
}

export class PoseDiagnosticsError extends Error {
  readonly code = "POSE_DIAGNOSTICS_FAILED" as const;
  readonly report: PoseDiagnosticsReport;

  constructor(report: PoseDiagnosticsReport) {
    super("The scene contains a deterministic pose or contact failure.");
    this.name = "PoseDiagnosticsError";
    this.report = report;
  }
}

const dot = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const normalized = (vector: Vec3): Vec3 | null => {
  const length = Math.hypot(...vector);
  return length <= 1e-9
    ? null
    : [vector[0] / length, vector[1] / length, vector[2] / length];
};

const deviationDegrees = (direction: Vec3, target: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(direction, target)))) *
  (180 / Math.PI);

const maximumStatus = (
  left: PoseDiagnosticStatus,
  right: PoseDiagnosticStatus,
): PoseDiagnosticStatus => {
  const rank = { pass: 0, check: 1, fail: 2 } as const;
  return rank[right] > rank[left] ? right : left;
};

const thresholdStatus = (
  magnitude: number,
  tolerance: number,
): PoseDiagnosticStatus =>
  magnitude <= tolerance
    ? "pass"
    : magnitude <= tolerance * 2
      ? "check"
      : "fail";

const contactDiagnosticStatus = (
  measurement: BodyContactMeasurement,
  toleranceM: number,
): PoseDiagnosticStatus => {
  let status = thresholdStatus(Math.abs(measurement.gapM), toleranceM);
  status = maximumStatus(
    status,
    thresholdStatus(measurement.boundsOverflowM, toleranceM),
  );
  if (measurement.actorMinGapM < -toleranceM) {
    status = maximumStatus(
      status,
      thresholdStatus(-measurement.actorMinGapM, toleranceM),
    );
  }
  return status;
};

const primitive = (
  primitives: readonly ActorProjectionPrimitive[],
  id: string,
): ActorProjectionPrimitive | undefined =>
  primitives.find((candidate) => candidate.id === id);

const relaxedLimbDirections = (
  scene: SceneSpec,
  actor: AnyActorEntity,
  limb: "arm-l" | "arm-r",
): { upper: Vec3; lower: Vec3 } | null => {
  const side = limb === "arm-l" ? "l" : "r";
  const projection = resolveActorProjection(scene, actor);
  const upper = primitive(projection.primitives, `upper_arm_${side}`);
  const middle = primitive(projection.primitives, `forearm_${side}`);
  const terminal = primitive(projection.primitives, `hand_${side}`);
  if (!upper || !middle || !terminal) return null;
  const upperDirection = normalized(
    subtract(middle.frame.position, upper.frame.position),
  );
  const lowerDirection = normalized(
    subtract(terminal.frame.position, middle.frame.position),
  );
  if (!upperDirection || !lowerDirection) return null;
  return {
    upper: rotateVector(upperDirection, actor.transform.rotation),
    lower: rotateVector(lowerDirection, actor.transform.rotation),
  };
};

export const analyzePoseDiagnostics = (
  scene: SceneSpec,
): PoseDiagnosticsReport => {
  const actors = scene.entities.filter(
    (entity): entity is AnyActorEntity => entity.kind === "actor",
  );
  const joints: ActorJointDiagnostic[] = [];
  const jointViolations: Array<JointLimitViolation & { actorId: string }> = [];
  const contacts: ContactDiagnostic[] = [];
  const relaxedLimbs: RelaxedLimbDiagnostic[] = [];
  const issues: PoseDiagnosticIssue[] = [];

  for (const actor of actors) {
    for (const jointId of canonicalPuppetJointIds) {
      joints.push({
        actorId: actor.id,
        jointId,
        eulerDeg: jointEulerDegrees(actor.pose.joints[jointId]),
      });
    }
    for (const violation of diagnoseJointLimits(actor.pose)) {
      jointViolations.push({ actorId: actor.id, ...violation });
      issues.push({
        code: violation.code,
        status: "fail",
        actorId: actor.id,
        jointId: violation.jointId,
        axis: violation.axis,
        measured: violation.angleDeg,
        minimum: violation.minDeg,
        maximum: violation.maxDeg,
      });
    }
  }

  for (const constraint of scene.constraints) {
    if (constraint.type === "body-contact" && constraint.enabled) {
      try {
        const measurement = measureBodyContact(scene, constraint);
        const status = contactDiagnosticStatus(
          measurement,
          constraint.toleranceM,
        );
        contacts.push({
          ...measurement,
          constraintId: constraint.id,
          role: constraint.role,
          toleranceM: constraint.toleranceM,
          status,
        });
        const gapStatus = thresholdStatus(
          Math.abs(measurement.gapM),
          constraint.toleranceM,
        );
        if (gapStatus !== "pass") {
          issues.push({
            code:
              measurement.gapM < 0
                ? "BODY_CONTACT_PENETRATION"
                : "BODY_CONTACT_GAP",
            status: gapStatus,
            actorId: constraint.actorId,
            constraintId: constraint.id,
            measured: measurement.gapM,
            tolerance: constraint.toleranceM,
          });
        }
        const boundsStatus = thresholdStatus(
          measurement.boundsOverflowM,
          constraint.toleranceM,
        );
        if (boundsStatus !== "pass") {
          issues.push({
            code: "BODY_CONTACT_OUT_OF_BOUNDS",
            status: boundsStatus,
            actorId: constraint.actorId,
            constraintId: constraint.id,
            measured: measurement.boundsOverflowM,
            tolerance: constraint.toleranceM,
          });
        }
        if (measurement.actorMinGapM < -constraint.toleranceM) {
          const penetrationStatus = thresholdStatus(
            -measurement.actorMinGapM,
            constraint.toleranceM,
          );
          issues.push({
            code: "ACTOR_SURFACE_PENETRATION",
            status:
              penetrationStatus === "pass" ? "check" : penetrationStatus,
            actorId: constraint.actorId,
            constraintId: constraint.id,
            measured: measurement.actorMinGapM,
            tolerance: constraint.toleranceM,
          });
        }
        if (constraint.role === "support") {
          const surface = resolveContactSurface(
            scene,
            constraint.surfaceEntityId,
            constraint.surfaceFace,
          );
          const gravityDown: Vec3 = [0, -1, 0];
          if (dot(surface.normal, gravityDown) > 0.5) {
            issues.push({
              code: "SUPPORT_DIRECTION_INVALID",
              status: "fail",
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: dot(surface.normal, gravityDown),
              maximum: 0.5,
            });
          }
        }
      } catch (error) {
        const unavailable =
          error instanceof BodyContactError &&
          error.code === "BODY_CONTACT_SITE_UNAVAILABLE";
        issues.push({
          code: unavailable
            ? "BODY_CONTACT_SITE_UNAVAILABLE"
            : "BODY_CONTACT_SURFACE_INVALID",
          status: "fail",
          actorId: constraint.actorId,
          constraintId: constraint.id,
        });
      }
    }

    if (constraint.type === "relaxed-limb" && constraint.enabled) {
      const actor = actors.find(({ id }) => id === constraint.actorId);
      const directions = actor
        ? relaxedLimbDirections(scene, actor, constraint.limb)
        : null;
      if (!directions) {
        relaxedLimbs.push({
          constraintId: constraint.id,
          actorId: constraint.actorId,
          limb: constraint.limb,
          gravityDirection: constraint.gravityDirection,
          upperDeviationDeg: null,
          lowerDeviationDeg: null,
          maxDeviationDeg: constraint.maxDeviationDeg,
          status: "fail",
        });
        issues.push({
          code: "RELAXED_LIMB_UNAVAILABLE",
          status: "fail",
          actorId: constraint.actorId,
          constraintId: constraint.id,
        });
        continue;
      }
      const upperDeviationDeg = deviationDegrees(
        directions.upper,
        constraint.gravityDirection,
      );
      const lowerDeviationDeg = deviationDegrees(
        directions.lower,
        constraint.gravityDirection,
      );
      const maximumDeviation = Math.max(
        upperDeviationDeg,
        lowerDeviationDeg,
      );
      const status = thresholdStatus(
        maximumDeviation,
        constraint.maxDeviationDeg,
      );
      relaxedLimbs.push({
        constraintId: constraint.id,
        actorId: constraint.actorId,
        limb: constraint.limb,
        gravityDirection: constraint.gravityDirection,
        upperDeviationDeg,
        lowerDeviationDeg,
        maxDeviationDeg: constraint.maxDeviationDeg,
        status,
      });
      if (status !== "pass") {
        issues.push({
          code: "RELAXED_LIMB_DIRECTION",
          status,
          actorId: constraint.actorId,
          constraintId: constraint.id,
          measured: maximumDeviation,
          maximum: constraint.maxDeviationDeg,
        });
      }
    }
  }

  const status: PoseDiagnosticStatus = issues.some(
    (issue) => issue.status === "fail",
  )
    ? "fail"
    : issues.some((issue) => issue.status === "check")
      ? "check"
      : "pass";
  return {
    status,
    actorCount: actors.length,
    checkedJointCount: joints.length,
    checkedContactCount: contacts.length,
    checkedRelaxedLimbCount: relaxedLimbs.length,
    joints,
    jointViolations,
    contacts,
    relaxedLimbs,
    issues,
  };
};

export const assertPoseDiagnostics = (
  scene: SceneSpec,
): PoseDiagnosticsReport => {
  const report = analyzePoseDiagnostics(scene);
  if (report.status === "fail") {
    throw new PoseDiagnosticsError(report);
  }
  return report;
};
