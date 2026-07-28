import {
  ACTOR_LIMB_CHAINS,
  deriveActorAnatomyDimensions,
  type ActorLimbPartId,
} from "./actor-anatomy";
import {
  multiplyQuaternions,
  rotateVector,
  transformPoint,
} from "./scene-math";
import type {
  ActorEntity,
  QuaternionTuple,
  Vec3,
} from "./scene-schema";

export type ActorAnchor =
  | "face"
  | "head"
  | "chest"
  | "pelvis"
  | "root";

export type ActorRigPrimitiveId =
  | "pelvis"
  | "torso"
  | "head"
  | "face"
  | "shoulder_l"
  | "elbow_l"
  | "hip_l"
  | "knee_l"
  | "shoulder_r"
  | "elbow_r"
  | "hip_r"
  | "knee_r"
  | ActorLimbPartId;

export interface ActorRigFrame {
  readonly position: Vec3;
  readonly rotation: QuaternionTuple;
}

interface ActorRigPrimitiveBase {
  readonly id: ActorRigPrimitiveId;
  readonly frame: ActorRigFrame;
  readonly center: Vec3;
}

export interface ActorRigSpherePrimitive extends ActorRigPrimitiveBase {
  readonly kind: "sphere";
  readonly radius: number;
  readonly widthSegments: number;
  readonly heightSegments: number;
}

export interface ActorRigCapsulePrimitive extends ActorRigPrimitiveBase {
  readonly kind: "capsule";
  readonly length: number;
  readonly cylinderLength: number;
  readonly radius: number;
  readonly capSegments: number;
  readonly radialSegments: number;
}

export interface ActorRigBoxPrimitive extends ActorRigPrimitiveBase {
  readonly kind: "box";
  readonly size: readonly [number, number, number];
}

export type ActorRigPrimitive =
  | ActorRigSpherePrimitive
  | ActorRigCapsulePrimitive
  | ActorRigBoxPrimitive;

export interface ActorRigProjection {
  readonly primitives: readonly ActorRigPrimitive[];
}

const identityRotation: QuaternionTuple = [0, 0, 0, 1];

const add = (left: Vec3, right: Vec3): Vec3 => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
];

const jointRotation = (
  actor: ActorEntity,
  ...jointIds: string[]
): QuaternionTuple => {
  for (const jointId of jointIds) {
    const rotation = actor.pose.joints[jointId];
    if (rotation) {
      return rotation;
    }
  }
  return identityRotation;
};

const framePoint = (frame: ActorRigFrame, point: Vec3): Vec3 =>
  add(frame.position, rotateVector(point, frame.rotation));

const childFrame = (
  parent: ActorRigFrame,
  position: Vec3,
  rotation: QuaternionTuple = identityRotation,
): ActorRigFrame => ({
  position: framePoint(parent, position),
  rotation: multiplyQuaternions(parent.rotation, rotation),
});

const capsuleCylinderLength = (
  length: number,
  radius: number,
): number => Math.max(0.01, length - radius * 2);

// Actors face local +Z, so their anatomical left is +X.
const anatomicalSideDirectionX = (side: "l" | "r"): number =>
  side === "l" ? 1 : -1;

export const deriveActorRigProjection = (
  actor: ActorEntity,
): ActorRigProjection => {
  const dimensions = deriveActorAnatomyDimensions(actor.body);
  const primitives: ActorRigPrimitive[] = [];
  const pelvisFrame: ActorRigFrame = {
    position: [0, 0, 0],
    rotation: jointRotation(actor, "pelvis", "root"),
  };
  primitives.push({
    id: "pelvis",
    kind: "box",
    frame: pelvisFrame,
    center: [0, 0, 0],
    size: [
      dimensions.pelvisWidth,
      dimensions.pelvisHeight,
      dimensions.pelvisDepth,
    ],
  });

  const spineFrame = childFrame(
    pelvisFrame,
    [0, dimensions.spineOriginY, 0],
    jointRotation(actor, "spine", "chest"),
  );
  primitives.push({
    id: "torso",
    kind: "capsule",
    frame: spineFrame,
    center: [0, dimensions.torsoLength / 2, 0],
    length: dimensions.torsoLength,
    cylinderLength: dimensions.torsoCapsuleLength,
    radius: dimensions.torsoRadius,
    capSegments: 8,
    radialSegments: 16,
  });

  const headFrame = childFrame(
    spineFrame,
    [0, dimensions.headOriginY, 0],
    jointRotation(actor, "neck", "head"),
  );
  primitives.push(
    {
      id: "head",
      kind: "sphere",
      frame: headFrame,
      center: [0, 0, 0],
      radius: dimensions.headRadius,
      widthSegments: 20,
      heightSegments: 14,
    },
    {
      id: "face",
      kind: "sphere",
      frame: headFrame,
      center: [...dimensions.faceOffset],
      radius: dimensions.faceRadius,
      widthSegments: 12,
      heightSegments: 8,
    },
  );

  for (const side of ["l", "r"] as const) {
    const direction = anatomicalSideDirectionX(side);
    const [upperId, middleId, terminalId] =
      ACTOR_LIMB_CHAINS[side === "l" ? "leftArm" : "rightArm"];
    const shoulderId = `shoulder_${side}` as const;
    const elbowId = `elbow_${side}` as const;
    if (actor.body.limbPresence[upperId] !== "present") continue;

    const shoulderFrame = childFrame(spineFrame, [
      direction * dimensions.shoulderOffsetX,
      dimensions.shoulderOriginY,
      0,
    ]);
    primitives.push({
      id: shoulderId,
      kind: "sphere",
      frame: shoulderFrame,
      center: [0, 0, 0],
      radius: dimensions.shoulderRadius,
      widthSegments: 12,
      heightSegments: 8,
    });
    const upperFrame = childFrame(
      shoulderFrame,
      [0, 0, 0],
      jointRotation(actor, upperId, shoulderId),
    );
    primitives.push({
      id: upperId,
      kind: "capsule",
      frame: upperFrame,
      center: [0, -dimensions.upperArmLength / 2, 0],
      length: dimensions.upperArmLength,
      cylinderLength: capsuleCylinderLength(
        dimensions.upperArmLength,
        dimensions.armRadius,
      ),
      radius: dimensions.armRadius,
      capSegments: 6,
      radialSegments: 12,
    });
    if (actor.body.limbPresence[middleId] !== "present") continue;

    const elbowBaseFrame = childFrame(upperFrame, [
      0,
      -dimensions.upperArmLength,
      0,
    ]);
    const middleFrame = childFrame(
      elbowBaseFrame,
      [0, 0, 0],
      jointRotation(actor, middleId, elbowId),
    );
    primitives.push({
      id: elbowId,
      kind: "sphere",
      frame: middleFrame,
      center: [0, 0, 0],
      radius: dimensions.elbowRadius,
      widthSegments: 12,
      heightSegments: 8,
    });
    primitives.push({
      id: middleId,
      kind: "capsule",
      frame: middleFrame,
      center: [0, -dimensions.forearmLength / 2, 0],
      length: dimensions.forearmLength,
      cylinderLength: capsuleCylinderLength(
        dimensions.forearmLength,
        dimensions.forearmRadius,
      ),
      radius: dimensions.forearmRadius,
      capSegments: 6,
      radialSegments: 12,
    });
    if (actor.body.limbPresence[terminalId] !== "present") continue;

    const handFrame = childFrame(middleFrame, [
      0,
      -dimensions.forearmLength,
      0,
    ]);
    primitives.push({
      id: terminalId,
      kind: "box",
      frame: handFrame,
      center: [...dimensions.handOffset],
      size: dimensions.handSize,
    });
  }

  for (const side of ["l", "r"] as const) {
    const direction = anatomicalSideDirectionX(side);
    const [upperId, middleId, terminalId] =
      ACTOR_LIMB_CHAINS[side === "l" ? "leftLeg" : "rightLeg"];
    const hipId = `hip_${side}` as const;
    const kneeId = `knee_${side}` as const;
    if (actor.body.limbPresence[upperId] !== "present") continue;

    const hipFrame = childFrame(pelvisFrame, [
      direction * dimensions.hipOffsetX,
      dimensions.hipOriginY,
      0,
    ]);
    primitives.push({
      id: hipId,
      kind: "sphere",
      frame: hipFrame,
      center: [0, 0, 0],
      radius: dimensions.hipRadius,
      widthSegments: 12,
      heightSegments: 8,
    });
    const upperFrame = childFrame(
      hipFrame,
      [0, 0, 0],
      jointRotation(actor, upperId, hipId),
    );
    primitives.push({
      id: upperId,
      kind: "capsule",
      frame: upperFrame,
      center: [0, -dimensions.upperLegLength / 2, 0],
      length: dimensions.upperLegLength,
      cylinderLength: capsuleCylinderLength(
        dimensions.upperLegLength,
        dimensions.legRadius,
      ),
      radius: dimensions.legRadius,
      capSegments: 6,
      radialSegments: 12,
    });
    if (actor.body.limbPresence[middleId] !== "present") continue;

    const kneeBaseFrame = childFrame(upperFrame, [
      0,
      -dimensions.upperLegLength,
      0,
    ]);
    const middleFrame = childFrame(
      kneeBaseFrame,
      [0, 0, 0],
      jointRotation(actor, middleId, kneeId),
    );
    primitives.push({
      id: kneeId,
      kind: "sphere",
      frame: middleFrame,
      center: [0, 0, 0],
      radius: dimensions.kneeRadius,
      widthSegments: 12,
      heightSegments: 8,
    });
    primitives.push({
      id: middleId,
      kind: "capsule",
      frame: middleFrame,
      center: [0, -dimensions.lowerLegLength / 2, 0],
      length: dimensions.lowerLegLength,
      cylinderLength: capsuleCylinderLength(
        dimensions.lowerLegLength,
        dimensions.lowerLegRadius,
      ),
      radius: dimensions.lowerLegRadius,
      capSegments: 6,
      radialSegments: 12,
    });
    if (actor.body.limbPresence[terminalId] !== "present") continue;

    const footFrame = childFrame(middleFrame, [
      0,
      -dimensions.lowerLegLength,
      0,
    ]);
    primitives.push({
      id: terminalId,
      kind: "box",
      frame: footFrame,
      center: [...dimensions.footOffset],
      size: dimensions.footSize,
    });
  }

  return { primitives };
};

/** Resolves narrative anchors from the same graybox dimensions and pose joints. */
export const actorAnchorLocalPoint = (
  actor: ActorEntity,
  anchor: ActorAnchor,
): Vec3 => {
  if (anchor === "root" || anchor === "pelvis") {
    return [0, 0, 0];
  }

  const dimensions = deriveActorAnatomyDimensions(actor.body);
  const pelvisRotation = jointRotation(actor, "pelvis", "root");
  const spineRotation = jointRotation(actor, "spine", "chest");
  const neckRotation = jointRotation(actor, "neck", "head");
  const spineOrigin: Vec3 = [0, dimensions.spineOriginY, 0];

  let pointInsideSpine: Vec3;
  if (anchor === "chest") {
    pointInsideSpine = [0, dimensions.torsoLength * 0.58, 0];
  } else {
    const headOrigin: Vec3 = [0, dimensions.headOriginY, 0];
    pointInsideSpine =
      anchor === "head"
        ? headOrigin
        : add(
            headOrigin,
            rotateVector(
              [...dimensions.faceOffset],
              neckRotation,
            ),
          );
  }

  const pointInsidePelvis = add(
    spineOrigin,
    rotateVector(pointInsideSpine, spineRotation),
  );
  return rotateVector(pointInsidePelvis, pelvisRotation);
};

export const actorAnchorWorldPoint = (
  actor: ActorEntity,
  anchor: ActorAnchor,
): Vec3 =>
  transformPoint(actor.transform, actorAnchorLocalPoint(actor, anchor));
