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
const RELEASE_METADATA_KEYS = new Set([
  "locatorContractVersion",
  "relativeRoot",
  "entrypoint",
  "capabilitiesContractVersion",
  "bridgeProtocolVersion",
  "sceneSchemaVersion",
  "patchSchemaVersion",
  "intentReportSchemaVersion",
  "semanticAuthority",
  "inputContract",
  "modelIntegration",
  "credentialPolicy",
  "networkPolicy",
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
      metadata.sceneSchemaVersion !== 1 ||
      metadata.patchSchemaVersion !== 1 ||
      metadata.intentReportSchemaVersion !== 1 ||
      metadata.semanticAuthority !== "host" ||
      metadata.inputContract !== "structured-only" ||
      metadata.modelIntegration !== "none" ||
      metadata.credentialPolicy !== "forbidden" ||
      metadata.networkPolicy !== "loopback-only"
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
