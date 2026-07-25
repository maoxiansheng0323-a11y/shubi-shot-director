import { rotateVector, transformPoint } from "./scene-math";
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

/**
 * Resolves the same approximate humanoid hierarchy rendered by SceneWorld.
 * It intentionally exposes only narrative anchors, not a general rig or IK API.
 */
export const actorAnchorLocalPoint = (
  actor: ActorEntity,
  anchor: ActorAnchor,
): Vec3 => {
  if (anchor === "root" || anchor === "pelvis") {
    return [0, 0, 0];
  }

  const height = actor.body.heightM;
  const torsoLength = height * 0.31;
  const headRadius = height * 0.075;
  const pelvisRotation = jointRotation(actor, "pelvis", "root");
  const spineRotation = jointRotation(actor, "spine", "chest");
  const neckRotation = jointRotation(actor, "neck", "head");
  const spineOrigin: Vec3 = [0, height * 0.035, 0];

  let pointInsideSpine: Vec3;
  if (anchor === "chest") {
    pointInsideSpine = [0, torsoLength * 0.58, 0];
  } else {
    const headOrigin: Vec3 = [
      0,
      torsoLength + height * 0.055,
      0,
    ];
    pointInsideSpine =
      anchor === "head"
        ? headOrigin
        : add(
            headOrigin,
            rotateVector(
              [0, -headRadius * 0.05, headRadius * 0.84],
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
