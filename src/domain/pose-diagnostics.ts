import {
  BODY_CONTACT_ORIENTATION_TOLERANCE_DEG,
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
import {
  measureSurfaceRestingArm,
  RELAXED_ARM_SURFACE_EPSILON_M,
} from "./relaxed-arm";
import type {
  AnyActorEntity,
  SceneSpec,
  Vec3,
} from "./scene-schema";
import { rotateVector } from "./scene-math";
import {
  BODY_CONTACT_TOLERANCE_M,
  type ContactSurfaceFace,
} from "./static-blocking-schema";

export const poseDiagnosticStatuses = ["pass", "check", "fail"] as const;
export type PoseDiagnosticStatus =
  (typeof poseDiagnosticStatuses)[number];

export type PoseDiagnosticIssueCode =
  | "JOINT_LIMIT_EXCEEDED"
  | "JOINT_BEND_REVERSED"
  | "BODY_CONTACT_GAP"
  | "BODY_CONTACT_PENETRATION"
  | "BODY_CONTACT_OUT_OF_BOUNDS"
  | "BODY_CONTACT_ORIENTATION"
  | "BODY_CONTACT_SURFACE_INVALID"
  | "BODY_CONTACT_SITE_UNAVAILABLE"
  | "ACTOR_SURFACE_PENETRATION"
  | "SUPPORT_DIRECTION_INVALID"
  | "RELAXED_LIMB_UNAVAILABLE"
  | "RELAXED_LIMB_DIRECTION"
  | "RELAXED_LIMB_SURFACE_INVALID"
  | "RELAXED_LIMB_SURFACE_GAP"
  | "RELAXED_LIMB_SURFACE_PENETRATION"
  | "RELAXED_LIMB_SURFACE_OUT_OF_BOUNDS"
  | "RELAXED_LIMB_ELBOW_BEND"
  | "RELAXED_LIMB_GRAVITY_RELATION";

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
  readonly orientationToleranceDeg: number | null;
  readonly status: PoseDiagnosticStatus;
}

export interface RelaxedLimbDiagnostic {
  readonly constraintId: string;
  readonly actorId: string;
  readonly limb: "arm-l" | "arm-r";
  readonly mode: "free-hanging" | "surface-resting";
  readonly gravityDirection: Vec3;
  readonly upperDeviationDeg: number | null;
  readonly lowerDeviationDeg: number | null;
  readonly maxDeviationDeg: number;
  readonly restSurfaceEntityId: string | null;
  readonly restSurfaceFace: ContactSurfaceFace | null;
  readonly terminalBodySite: "hand-l" | "hand-r" | null;
  readonly terminalPointWorld: Vec3 | null;
  readonly terminalGapM: number | null;
  readonly terminalPenetrationM: number | null;
  readonly boundsOverflowM: number | null;
  readonly armMinGapM: number | null;
  readonly elbowBendDeg: number | null;
  readonly terminalDropM: number | null;
  readonly upperGravityAlignment: number | null;
  readonly surfaceGravityOpposition: number | null;
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
  if (measurement.orientationDeviationDeg !== null) {
    status = maximumStatus(
      status,
      thresholdStatus(
        measurement.orientationDeviationDeg,
        BODY_CONTACT_ORIENTATION_TOLERANCE_DEG,
      ),
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
          orientationToleranceDeg:
            measurement.orientationDeviationDeg === null
              ? null
              : BODY_CONTACT_ORIENTATION_TOLERANCE_DEG,
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
        if (measurement.orientationDeviationDeg !== null) {
          const orientationStatus = thresholdStatus(
            measurement.orientationDeviationDeg,
            BODY_CONTACT_ORIENTATION_TOLERANCE_DEG,
          );
          if (orientationStatus !== "pass") {
            issues.push({
              code: "BODY_CONTACT_ORIENTATION",
              status: orientationStatus,
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: measurement.orientationDeviationDeg,
              maximum: BODY_CONTACT_ORIENTATION_TOLERANCE_DEG,
            });
          }
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
      const mode = constraint.restSurface
        ? "surface-resting"
        : "free-hanging";
      if (!directions) {
        relaxedLimbs.push({
          constraintId: constraint.id,
          actorId: constraint.actorId,
          limb: constraint.limb,
          mode,
          gravityDirection: constraint.gravityDirection,
          upperDeviationDeg: null,
          lowerDeviationDeg: null,
          maxDeviationDeg: constraint.maxDeviationDeg,
          restSurfaceEntityId:
            constraint.restSurface?.surfaceEntityId ?? null,
          restSurfaceFace: constraint.restSurface?.surfaceFace ?? null,
          terminalBodySite: null,
          terminalPointWorld: null,
          terminalGapM: null,
          terminalPenetrationM: null,
          boundsOverflowM: null,
          armMinGapM: null,
          elbowBendDeg: null,
          terminalDropM: null,
          upperGravityAlignment: null,
          surfaceGravityOpposition: null,
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
      if (constraint.restSurface && actor) {
        const forearmId = constraint.limb === "arm-l"
          ? "forearm_l"
          : "forearm_r";
        const elbowBendDeg = jointEulerDegrees(
          actor.pose.joints[forearmId],
        )[0];
        try {
          const measurement = measureSurfaceRestingArm(
            scene,
            actor,
            constraint.limb,
            constraint.restSurface,
          );
          const upperGravityAlignment = Math.cos(
            (upperDeviationDeg * Math.PI) / 180,
          );
          let status: PoseDiagnosticStatus = "pass";
          const gapStatus = thresholdStatus(
            Math.abs(measurement.terminalGapM),
            BODY_CONTACT_TOLERANCE_M,
          );
          status = maximumStatus(status, gapStatus);
          if (gapStatus !== "pass") {
            issues.push({
              code: "RELAXED_LIMB_SURFACE_GAP",
              status: gapStatus,
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: measurement.terminalGapM,
              tolerance: BODY_CONTACT_TOLERANCE_M,
            });
          }
          const penetrationStatus: PoseDiagnosticStatus =
            measurement.armMinGapM >= -RELAXED_ARM_SURFACE_EPSILON_M
              ? "pass"
              : "fail";
          status = maximumStatus(status, penetrationStatus);
          if (penetrationStatus !== "pass") {
            issues.push({
              code: "RELAXED_LIMB_SURFACE_PENETRATION",
              status: penetrationStatus,
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: measurement.armMinGapM,
              tolerance: RELAXED_ARM_SURFACE_EPSILON_M,
            });
          }
          const boundsStatus = thresholdStatus(
            measurement.boundsOverflowM,
            BODY_CONTACT_TOLERANCE_M,
          );
          status = maximumStatus(status, boundsStatus);
          if (boundsStatus !== "pass") {
            issues.push({
              code: "RELAXED_LIMB_SURFACE_OUT_OF_BOUNDS",
              status: boundsStatus,
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: measurement.boundsOverflowM,
              tolerance: BODY_CONTACT_TOLERANCE_M,
            });
          }
          if (elbowBendDeg > -1 || elbowBendDeg < -150) {
            status = "fail";
            issues.push({
              code: "RELAXED_LIMB_ELBOW_BEND",
              status: "fail",
              actorId: constraint.actorId,
              constraintId: constraint.id,
              jointId: forearmId,
              axis: "x",
              measured: elbowBendDeg,
              minimum: -150,
              maximum: -1,
            });
          }
          if (upperGravityAlignment <= 0) {
            status = "fail";
            issues.push({
              code: "RELAXED_LIMB_GRAVITY_RELATION",
              status: "fail",
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: upperGravityAlignment,
              minimum: 0,
            });
          }
          if (measurement.terminalDropM <= BODY_CONTACT_TOLERANCE_M) {
            status = "fail";
            issues.push({
              code: "RELAXED_LIMB_GRAVITY_RELATION",
              status: "fail",
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: measurement.terminalDropM,
              minimum: BODY_CONTACT_TOLERANCE_M,
            });
          }
          if (measurement.surfaceGravityOpposition < 0.5) {
            status = "fail";
            issues.push({
              code: "RELAXED_LIMB_GRAVITY_RELATION",
              status: "fail",
              actorId: constraint.actorId,
              constraintId: constraint.id,
              measured: measurement.surfaceGravityOpposition,
              minimum: 0.5,
            });
          }
          relaxedLimbs.push({
            constraintId: constraint.id,
            actorId: constraint.actorId,
            limb: constraint.limb,
            mode,
            gravityDirection: constraint.gravityDirection,
            upperDeviationDeg,
            lowerDeviationDeg,
            maxDeviationDeg: constraint.maxDeviationDeg,
            restSurfaceEntityId: constraint.restSurface.surfaceEntityId,
            restSurfaceFace: constraint.restSurface.surfaceFace,
            terminalBodySite: measurement.terminalBodySite,
            terminalPointWorld: measurement.terminalPointWorld,
            terminalGapM: measurement.terminalGapM,
            terminalPenetrationM: measurement.terminalPenetrationM,
            boundsOverflowM: measurement.boundsOverflowM,
            armMinGapM: measurement.armMinGapM,
            elbowBendDeg,
            terminalDropM: measurement.terminalDropM,
            upperGravityAlignment,
            surfaceGravityOpposition:
              measurement.surfaceGravityOpposition,
            status,
          });
        } catch {
          relaxedLimbs.push({
            constraintId: constraint.id,
            actorId: constraint.actorId,
            limb: constraint.limb,
            mode,
            gravityDirection: constraint.gravityDirection,
            upperDeviationDeg,
            lowerDeviationDeg,
            maxDeviationDeg: constraint.maxDeviationDeg,
            restSurfaceEntityId: constraint.restSurface.surfaceEntityId,
            restSurfaceFace: constraint.restSurface.surfaceFace,
            terminalBodySite: null,
            terminalPointWorld: null,
            terminalGapM: null,
            terminalPenetrationM: null,
            boundsOverflowM: null,
            armMinGapM: null,
            elbowBendDeg,
            terminalDropM: null,
            upperGravityAlignment: null,
            surfaceGravityOpposition: null,
            status: "fail",
          });
          issues.push({
            code: "RELAXED_LIMB_SURFACE_INVALID",
            status: "fail",
            actorId: constraint.actorId,
            constraintId: constraint.id,
          });
        }
        continue;
      }
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
        mode,
        gravityDirection: constraint.gravityDirection,
        upperDeviationDeg,
        lowerDeviationDeg,
        maxDeviationDeg: constraint.maxDeviationDeg,
        restSurfaceEntityId: null,
        restSurfaceFace: null,
        terminalBodySite: null,
        terminalPointWorld: null,
        terminalGapM: null,
        terminalPenetrationM: null,
        boundsOverflowM: null,
        armMinGapM: null,
        elbowBendDeg: null,
        terminalDropM: null,
        upperGravityAlignment: null,
        surfaceGravityOpposition: null,
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

const diagnosticIssueKey = (issue: PoseDiagnosticIssue): string =>
  [
    issue.code,
    issue.actorId,
    issue.constraintId ?? "",
    issue.jointId ?? "",
    issue.axis ?? "",
  ].join(":");

const diagnosticFailureExcess = (issue: PoseDiagnosticIssue): number => {
  if (issue.measured === undefined) return Number.POSITIVE_INFINITY;
  if (issue.tolerance !== undefined) {
    return Math.max(0, Math.abs(issue.measured) - issue.tolerance);
  }
  if (issue.minimum !== undefined || issue.maximum !== undefined) {
    return Math.max(
      0,
      (issue.minimum ?? Number.NEGATIVE_INFINITY) - issue.measured,
      issue.measured - (issue.maximum ?? Number.POSITIVE_INFINITY),
    );
  }
  return Number.POSITIVE_INFINITY;
};

export const assertNoNewPoseDiagnosticFailures = (
  before: SceneSpec,
  after: SceneSpec,
): PoseDiagnosticsReport => {
  const beforeFailures = new Map(
    analyzePoseDiagnostics(before).issues
      .filter(({ status }) => status === "fail")
      .map((issue) => [diagnosticIssueKey(issue), diagnosticFailureExcess(issue)]),
  );
  const report = analyzePoseDiagnostics(after);
  const hasNewOrWorseFailure = report.issues
    .filter(({ status }) => status === "fail")
    .some((issue) => {
      const previousExcess = beforeFailures.get(diagnosticIssueKey(issue));
      return (
        previousExcess === undefined ||
        diagnosticFailureExcess(issue) > previousExcess + 1e-6
      );
    });
  if (hasNewOrWorseFailure) {
    throw new PoseDiagnosticsError(report);
  }
  return report;
};
