import {
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type EulerOrder,
} from "three";
import type {
  QuaternionTuple,
  TransformSpec,
  Vec3,
} from "./scene-schema";

const toVector3 = ([x, y, z]: Vec3): Vector3 => new Vector3(x, y, z);
const toQuaternion = ([x, y, z, w]: QuaternionTuple): Quaternion =>
  new Quaternion(x, y, z, w);

const fromVector3 = (value: Vector3): Vec3 => [value.x, value.y, value.z];
const fromQuaternion = (value: Quaternion): QuaternionTuple => [
  value.x,
  value.y,
  value.z,
  value.w,
];

export const normalizeQuaternion = (
  quaternion: QuaternionTuple,
): QuaternionTuple => fromQuaternion(toQuaternion(quaternion).normalize());

export const multiplyQuaternions = (
  left: QuaternionTuple,
  right: QuaternionTuple,
): QuaternionTuple =>
  fromQuaternion(toQuaternion(left).multiply(toQuaternion(right)).normalize());

export const rotateVector = (
  vector: Vec3,
  rotation: QuaternionTuple,
): Vec3 => fromVector3(toVector3(vector).applyQuaternion(toQuaternion(rotation)));

export const addVectors = (left: Vec3, right: Vec3): Vec3 => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
];

export const quaternionFromEulerDegrees = (
  degrees: Vec3,
  order: EulerOrder = "XYZ",
): QuaternionTuple => {
  const radians = degrees.map((value) => (value * Math.PI) / 180) as Vec3;
  return fromQuaternion(
    new Quaternion()
      .setFromEuler(new Euler(radians[0], radians[1], radians[2], order))
      .normalize(),
  );
};

export const lookAtQuaternion = (
  positionM: Vec3,
  targetM: Vec3,
): QuaternionTuple => {
  const eye = toVector3(positionM);
  const target = toVector3(targetM);
  if (eye.distanceToSquared(target) < 1e-8) {
    throw new Error("Camera position and look-at target must differ.");
  }

  const matrix = new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0));
  return fromQuaternion(new Quaternion().setFromRotationMatrix(matrix).normalize());
};

export const transformPoint = (
  transform: TransformSpec,
  localPoint: Vec3,
): Vec3 => {
  const scaled: Vec3 = [
    localPoint[0] * transform.scale[0],
    localPoint[1] * transform.scale[1],
    localPoint[2] * transform.scale[2],
  ];
  return addVectors(
    transform.positionM,
    rotateVector(scaled, transform.rotation),
  );
};
