#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const { snapTransformToContact } = await tsImport(
  pathToFileURL(
    path.join(repositoryRoot, "src/domain/contact-constraints.ts"),
  ).href,
  import.meta.url,
);

const actorLimbChains = [
  ["upper_arm_l", "forearm_l", "hand_l"],
  ["upper_arm_r", "forearm_r", "hand_r"],
  ["upper_leg_l", "lower_leg_l", "foot_l"],
  ["upper_leg_r", "lower_leg_r", "foot_r"],
];

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const option = args[index];
  const value = args[index + 1];
  if (!["--before", "--after", "--patch"].includes(option) || !value) {
    throw new Error(
      "Usage: verify-transition.mjs --before <scene> --after <scene> --patch <patch>",
    );
  }
  options.set(option, value);
}

const readJson = async (option) => {
  const filePath = options.get(option);
  if (!filePath) {
    throw new Error(`${option} is required.`);
  }
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
};

const before = await readJson("--before");
const after = await readJson("--after");
const patch = await readJson("--patch");

const canonicalScene = (scene) => {
  const persistentScene = { ...scene };
  delete persistentScene.sceneId;
  delete persistentScene.revision;
  return {
    ...persistentScene,
    entities: Object.fromEntries(
      (scene.entities ?? []).map((entity) => [entity.id, entity]),
    ),
    constraints: Object.fromEntries(
      (scene.constraints ?? []).map((constraint) => [constraint.id, constraint]),
    ),
  };
};

const differences = [];
const walk = (left, right, prefix = "") => {
  if (Object.is(left, right)) {
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      differences.push(prefix);
      return;
    }
    for (let index = 0; index < left.length; index += 1) {
      walk(left[index], right[index], `${prefix}.${index}`);
    }
    return;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    differences.push(prefix);
    return;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort()) {
    walk(left[key], right[key], prefix ? `${prefix}.${key}` : key);
  }
};
walk(canonicalScene(before), canonicalScene(after));

const actorLimbClosure = (updates) => {
  const closure = new Set();
  for (const [partId, mode] of Object.entries(updates ?? {})) {
    const chain = actorLimbChains.find((candidate) =>
      candidate.includes(partId),
    );
    const partIndex = chain?.indexOf(partId) ?? -1;
    if (!chain || partIndex === -1) {
      continue;
    }
    const affected =
      mode === "absent"
        ? chain.slice(partIndex)
        : mode === "present"
          ? chain.slice(0, partIndex + 1)
          : [];
    for (const affectedPartId of affected) {
      closure.add(affectedPartId);
    }
  }
  return closure;
};

const hasDeterministicContactCorrection = (actorId) => {
  const afterActor = (after.entities ?? []).find(
    (entity) => entity.id === actorId && entity.kind === "actor",
  );
  const hasEnabledContact = (after.constraints ?? []).some(
    (constraint) =>
      constraint.type === "ground-contact" &&
      constraint.enabled === true &&
      constraint.entityId === actorId,
  );
  if (!afterActor || !hasEnabledContact) {
    return false;
  }
  try {
    const snapped = snapTransformToContact(
      after,
      actorId,
      afterActor.transform,
    );
    return (
      Math.abs(
        snapped.positionM[1] - afterActor.transform.positionM[1],
      ) <= 1e-9
    );
  } catch {
    return false;
  }
};

const allowedPrefixes = new Set();
for (const operation of patch.operations ?? []) {
  switch (operation.op) {
    case "entity.add":
      allowedPrefixes.add(`entities.${operation.value.id}`);
      break;
    case "entity.remove":
      allowedPrefixes.add(`entities.${operation.entityId}`);
      break;
    case "entity.transform.set":
    case "entity.transform.translate":
    case "entity.transform.rotate":
    case "camera.look-at":
      allowedPrefixes.add(`entities.${operation.entityId}.transform`);
      break;
    case "entity.flags.set":
      if ("visible" in operation) {
        allowedPrefixes.add(`entities.${operation.entityId}.visible`);
      }
      if ("lockMode" in operation) {
        allowedPrefixes.add(`entities.${operation.entityId}.lockMode`);
      }
      break;
    case "entity.preset.parameters.set":
      allowedPrefixes.add(`entities.${operation.entityId}.preset.parameters`);
      break;
    case "actor.pose.set":
      allowedPrefixes.add(`entities.${operation.entityId}.pose`);
      allowedPrefixes.add(`entities.${operation.entityId}.transform.positionM`);
      break;
    case "actor.limb-presence.set":
      for (const partId of actorLimbClosure(operation.updates)) {
        allowedPrefixes.add(
          `entities.${operation.actorId}.body.limbPresence.${partId}`,
        );
      }
      if (hasDeterministicContactCorrection(operation.actorId)) {
        allowedPrefixes.add(
          `entities.${operation.actorId}.transform.positionM.1`,
        );
      }
      break;
    case "camera.lens.set":
      allowedPrefixes.add(`entities.${operation.entityId}.lens`);
      break;
    case "constraint.set":
      allowedPrefixes.add(`constraints.${operation.value.id}`);
      if (operation.value.type === "ground-contact") {
        allowedPrefixes.add(
          `entities.${operation.value.entityId}.transform.positionM`,
        );
      }
      break;
    case "constraint.remove":
      allowedPrefixes.add(`constraints.${operation.constraintId}`);
      break;
    case "scene.active-camera.set":
      allowedPrefixes.add("activeCameraId");
      break;
    case "scene.output.set":
      allowedPrefixes.add("output");
      break;
    case "scene.composition-goals.set":
      allowedPrefixes.add("compositionGoals");
      break;
    case "scene.title.set":
      allowedPrefixes.add("title");
      break;
  }
}

const unexpectedDifferences = differences.filter(
  (difference) =>
    ![...allowedPrefixes].some(
      (prefix) =>
        difference === prefix || difference.startsWith(`${prefix}.`),
    ),
);

const checks = {
  sameSceneId:
    typeof before.sceneId === "string" &&
    before.sceneId === after.sceneId &&
    patch.sceneId === before.sceneId,
  exactRevision:
    Number.isInteger(before.revision) &&
    after.revision === before.revision + 1 &&
    patch.baseRevision === before.revision,
  hasOperations:
    Array.isArray(patch.operations) && patch.operations.length > 0,
  diffIsMinimal: unexpectedDifferences.length === 0,
};

const result = {
  ok: Object.values(checks).every(Boolean),
  checks,
  changedFields: differences,
  unexpectedDifferences,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
