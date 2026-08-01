import {
  lstat,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPECTED_RUNTIME_NAME = "shubi-shot-director";
const DEFAULT_ENTRYPOINT = path.join("scripts", "director.mjs");
const BUNDLED_BRIDGE_PROTOCOL_VERSION = 1;
const BUNDLED_WORKSPACE_ROUTING_VERSION = 1;
const BUNDLED_ENTITY_LOCK_MODES = Object.freeze([
  "none",
  "workflow",
  "user",
]);
const BUNDLED_PATCH_POLICY_FIELDS = Object.freeze(["preserveLock"]);
const BUNDLED_LOCK_ERROR_CODES = Object.freeze([
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
]);
const BUNDLED_ACTOR_LIMB_PART_IDS = Object.freeze([
  "upper_arm_l",
  "forearm_l",
  "hand_l",
  "upper_arm_r",
  "forearm_r",
  "hand_r",
  "upper_leg_l",
  "lower_leg_l",
  "foot_l",
  "upper_leg_r",
  "lower_leg_r",
  "foot_r",
]);
const BUNDLED_ACTOR_LIMB_PRESENCE_MODES = Object.freeze([
  "present",
  "absent",
]);
const BUNDLED_ACTOR_LIMB_ERROR_CODES = Object.freeze([
  "LIMB_HIERARCHY_CONFLICT",
]);
const BUNDLED_ACTOR_PUPPET = Object.freeze({
  heightLimitsM: Object.freeze({ min: 1, max: 2.4 }),
  jointIds: Object.freeze([
    "pelvis", "spine", "neck", "upper_arm_l", "forearm_l", "hand_l",
    "upper_arm_r", "forearm_r", "hand_r", "upper_leg_l", "lower_leg_l",
    "foot_l", "upper_leg_r", "lower_leg_r", "foot_r",
  ]),
  operationIds: Object.freeze([
    "actor.height.set",
    "actor.pose.joints.set",
  ]),
  errorCodes: Object.freeze([
    "ACTOR_HEIGHT_TARGET_INVALID",
    "ACTOR_HEIGHT_RANGE_INVALID",
    "ACTOR_JOINT_TARGET_INVALID",
    "ACTOR_JOINT_ID_INVALID",
  ]),
});
const BUNDLED_ACTOR_BLUEPRINT = Object.freeze({
  schemaVersion: 1,
  mounts: Object.freeze([
    "shoulder_l", "shoulder_r", "elbow_l", "elbow_r", "wrist_l",
    "wrist_r", "hip_l", "hip_r", "knee_l", "knee_r",
  ]),
  primitives: Object.freeze(["box", "sphere", "cylinder"]),
  variantDeltaFields: Object.freeze([
    "limbPresence",
    "moduleVisibility",
  ]),
  errorCodes: Object.freeze([
    "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    "ACTOR_BLUEPRINT_FILE_INVALID",
    "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
    "ACTOR_BLUEPRINT_VARIANT_INVALID",
    "ACTOR_BLUEPRINT_HASH_MISMATCH",
    "ACTOR_BLUEPRINT_HASH_DUPLICATE",
    "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    "ACTOR_BLUEPRINT_ID_CONFLICT",
  ]),
});
const RELEASE_METADATA_KEYS = new Set([
  "locatorContractVersion",
  "relativeRoot",
  "entrypoint",
  "capabilitiesContractVersion",
  "bridgeProtocolVersion",
  "workspaceRoutingVersion",
  "sceneSchemaVersion",
  "patchSchemaVersion",
  "intentReportSchemaVersion",
  "semanticAuthority",
  "inputContract",
  "modelIntegration",
  "credentialPolicy",
  "networkPolicy",
  "entityLockModes",
  "patchPolicyFields",
  "lockErrorCodes",
  "actorLimbPartIds",
  "actorLimbPresenceModes",
  "actorLimbErrorCodes",
  "actorPuppet",
  "actorBlueprint",
]);
const RUNTIME_NOT_FOUND_MESSAGE =
  "A compatible Shubi Shot Director runtime was not found.";
const defaultSkillDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export class SkillRuntimeError extends Error {
  constructor() {
    super(RUNTIME_NOT_FOUND_MESSAGE);
    this.name = "SkillRuntimeError";
    this.code = "RUNTIME_NOT_FOUND";
  }
}

const runtimeNotFound = () => new SkillRuntimeError();
const isUniqueStringArray = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (item) => typeof item === "string" && item.trim().length > 0,
  ) &&
  new Set(value).size === value.length;
const stringSetsEqual = (left, right) =>
  isUniqueStringArray(left) &&
  left.length === right.length &&
  left.every((value) => right.includes(value));
const actorBlueprintEqual = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 5 &&
  value.schemaVersion === BUNDLED_ACTOR_BLUEPRINT.schemaVersion &&
  stringSetsEqual(value.mounts, BUNDLED_ACTOR_BLUEPRINT.mounts) &&
  stringSetsEqual(
    value.primitives,
    BUNDLED_ACTOR_BLUEPRINT.primitives,
  ) &&
  stringSetsEqual(
    value.variantDeltaFields,
    BUNDLED_ACTOR_BLUEPRINT.variantDeltaFields,
  ) &&
  stringSetsEqual(
    value.errorCodes,
    BUNDLED_ACTOR_BLUEPRINT.errorCodes,
  );
const actorPuppetEqual = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 4 &&
  typeof value.heightLimitsM === "object" &&
  value.heightLimitsM !== null &&
  !Array.isArray(value.heightLimitsM) &&
  Object.keys(value.heightLimitsM).length === 2 &&
  value.heightLimitsM.min === BUNDLED_ACTOR_PUPPET.heightLimitsM.min &&
  value.heightLimitsM.max === BUNDLED_ACTOR_PUPPET.heightLimitsM.max &&
  stringSetsEqual(value.jointIds, BUNDLED_ACTOR_PUPPET.jointIds) &&
  stringSetsEqual(value.operationIds, BUNDLED_ACTOR_PUPPET.operationIds) &&
  stringSetsEqual(value.errorCodes, BUNDLED_ACTOR_PUPPET.errorCodes);

const isContainedPath = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const readPackageName = async (root) => {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    return typeof packageJson === "object" &&
      packageJson !== null &&
      !Array.isArray(packageJson) &&
      typeof packageJson.name === "string"
      ? packageJson.name
      : undefined;
  } catch {
    return undefined;
  }
};

const validateRuntimeRoot = async (root, entrypoint) => {
  try {
    if (
      typeof root !== "string" ||
      root.length === 0 ||
      typeof entrypoint !== "string" ||
      entrypoint.length === 0 ||
      path.isAbsolute(entrypoint)
    ) {
      throw runtimeNotFound();
    }

    const canonicalRoot = await realpath(path.resolve(root));
    if ((await readPackageName(canonicalRoot)) !== EXPECTED_RUNTIME_NAME) {
      throw runtimeNotFound();
    }

    const entrypointPath = path.resolve(canonicalRoot, entrypoint);
    if (!isContainedPath(canonicalRoot, entrypointPath)) {
      throw runtimeNotFound();
    }
    const entrypointStat = await stat(entrypointPath);
    if (!entrypointStat.isFile()) {
      throw runtimeNotFound();
    }

    const canonicalEntrypoint = await realpath(entrypointPath);
    if (!isContainedPath(canonicalRoot, canonicalEntrypoint)) {
      throw runtimeNotFound();
    }
    return {
      runtimeRoot: canonicalRoot,
      entrypoint: canonicalEntrypoint,
    };
  } catch {
    throw runtimeNotFound();
  }
};

const readReleaseMetadata = async (skillDirectory) => {
  const metadataPath = path.join(skillDirectory, "runtime.json");
  let metadataStat;
  try {
    metadataStat = await lstat(metadataPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw runtimeNotFound();
  }

  if (!metadataStat.isFile()) {
    throw runtimeNotFound();
  }

  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata) ||
      Object.keys(metadata).length !== RELEASE_METADATA_KEYS.size ||
      !Object.keys(metadata).every((key) =>
        RELEASE_METADATA_KEYS.has(key),
      ) ||
      metadata.locatorContractVersion !== 1 ||
      typeof metadata.relativeRoot !== "string" ||
      metadata.relativeRoot.length === 0 ||
      path.isAbsolute(metadata.relativeRoot) ||
      typeof metadata.entrypoint !== "string" ||
      metadata.entrypoint.length === 0 ||
      path.isAbsolute(metadata.entrypoint) ||
      metadata.capabilitiesContractVersion !== 2 ||
      metadata.bridgeProtocolVersion !==
        BUNDLED_BRIDGE_PROTOCOL_VERSION ||
      metadata.workspaceRoutingVersion !==
        BUNDLED_WORKSPACE_ROUTING_VERSION ||
      metadata.sceneSchemaVersion !== 6 ||
      metadata.patchSchemaVersion !== 6 ||
      metadata.intentReportSchemaVersion !== 6 ||
      metadata.semanticAuthority !== "host" ||
      metadata.inputContract !== "structured-only" ||
      metadata.modelIntegration !== "none" ||
      metadata.credentialPolicy !== "forbidden" ||
      metadata.networkPolicy !== "loopback-only" ||
      !stringSetsEqual(
        metadata.entityLockModes,
        BUNDLED_ENTITY_LOCK_MODES,
      ) ||
      !stringSetsEqual(
        metadata.patchPolicyFields,
        BUNDLED_PATCH_POLICY_FIELDS,
      ) ||
      !stringSetsEqual(
        metadata.lockErrorCodes,
        BUNDLED_LOCK_ERROR_CODES,
      ) ||
      !stringSetsEqual(
        metadata.actorLimbPartIds,
        BUNDLED_ACTOR_LIMB_PART_IDS,
      ) ||
      !stringSetsEqual(
        metadata.actorLimbPresenceModes,
        BUNDLED_ACTOR_LIMB_PRESENCE_MODES,
      ) ||
      !stringSetsEqual(
        metadata.actorLimbErrorCodes,
        BUNDLED_ACTOR_LIMB_ERROR_CODES,
      ) ||
      !actorPuppetEqual(metadata.actorPuppet) ||
      !actorBlueprintEqual(metadata.actorBlueprint)
    ) {
      throw runtimeNotFound();
    }
    return metadata;
  } catch {
    throw runtimeNotFound();
  }
};

const resolveFromAncestors = async (skillDirectory) => {
  let candidateRoot = skillDirectory;
  while (true) {
    if ((await readPackageName(candidateRoot)) === EXPECTED_RUNTIME_NAME) {
      return validateRuntimeRoot(candidateRoot, DEFAULT_ENTRYPOINT);
    }

    const parent = path.dirname(candidateRoot);
    if (parent === candidateRoot) {
      throw runtimeNotFound();
    }
    candidateRoot = parent;
  }
};

export const resolveRuntime = async (
  {
    environment = process.env,
    skillDirectory = defaultSkillDirectory,
  } = {},
) => {
  try {
    const explicitRoot = environment.SHUBI_SHOT_RUNTIME_ROOT;
    if (explicitRoot !== undefined) {
      return await validateRuntimeRoot(explicitRoot, DEFAULT_ENTRYPOINT);
    }

    if (
      typeof skillDirectory !== "string" ||
      skillDirectory.length === 0
    ) {
      throw runtimeNotFound();
    }
    const absoluteSkillDirectory = path.resolve(skillDirectory);
    const metadata = await readReleaseMetadata(absoluteSkillDirectory);
    if (metadata !== undefined) {
      return await validateRuntimeRoot(
        path.resolve(absoluteSkillDirectory, metadata.relativeRoot),
        metadata.entrypoint,
      );
    }

    return await resolveFromAncestors(absoluteSkillDirectory);
  } catch {
    throw runtimeNotFound();
  }
};

export const resolveRuntimeEntrypoint = async (options) =>
  (await resolveRuntime(options)).entrypoint;
