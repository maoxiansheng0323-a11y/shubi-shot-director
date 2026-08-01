import { execFile } from "node:child_process";
import {
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ScenePersistence } from "../server/scene-persistence";
import {
  createActorBlueprintSnapshot,
  resolveActorBlueprintVariant,
  type ActorBlueprintSnapshot,
} from "../src/domain/actor-blueprint";
import { resolveActorProjection } from "../src/domain/actor-projection";
import { enforceGroundContacts } from "../src/domain/contact-constraints";
import { createDefaultScene } from "../src/domain/default-scene";
import { materializePose } from "../src/domain/presets/pose-presets";
import {
  isBlueprintActorEntity,
  sceneSpecSchema,
  type BlueprintActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const skillWrapper = path.join(
  repositoryRoot,
  ".agents",
  "skills",
  "shubi-shot-director",
  "scripts",
  "director.mjs",
);
const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "actor-blueprint-black-box-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const createAcceptanceScene = (
  sceneId: string,
  snapshot: ActorBlueprintSnapshot,
  variantId: "damaged" | "repaired",
  poseId: "pose.standing-neutral-v1" | "pose.lying-supine-v1",
): SceneSpec => {
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  scene.sceneId = sceneId;
  scene.title = "Generic Actor Blueprint Acceptance";
  scene.actorBlueprints = [snapshot];
  scene.entities = scene.entities.filter(
    (entity) => entity.kind !== "actor" && entity.kind !== "prop",
  );
  scene.constraints = [];

  const actor = createBlueprintActor({ variantId });
  actor.transform.positionM = [0, 0, 0];
  actor.pose = materializePose(actor, poseId, snapshot.body.heightM);
  scene.entities.push(actor);
  scene.constraints.push({
    id: "constraint_ground_blueprint_1",
    type: "ground-contact",
    entityId: actor.id,
    surfaceEntityId: "environment_room_1",
    enabled: true,
  });
  return enforceGroundContacts(sceneSpecSchema.parse(scene));
};

const onlyBlueprintActor = (scene: SceneSpec): BlueprintActorEntity => {
  const actors = scene.entities.filter(isBlueprintActorEntity);
  expect(actors).toHaveLength(1);
  return actors[0]!;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Actor Blueprint v0.6 black-box preparation", () => {
  it("validates externally, persists two scenes without the source, and reuses one snapshot for two instances", async () => {
    const root = await temporaryDirectory();
    const externalFile = path.join(root, "generic-actor-blueprint.json");
    const document = createGenericActorBlueprintDocument();
    await writeFile(externalFile, JSON.stringify(document), "utf8");

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        skillWrapper,
        "blueprint",
        "validate",
        "--file",
        externalFile,
      ],
      {
        cwd: repositoryRoot,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    const envelope = JSON.parse(stdout) as {
      ok: boolean;
      data: {
        blueprintId: string;
        blueprintVersion: number;
        contentSha256: string;
        moduleCount: number;
        variantCount: number;
        valid: boolean;
      };
    };
    const snapshot = createActorBlueprintSnapshot(document);

    expect(stderr).toBe("");
    expect(envelope).toEqual({
      ok: true,
      data: {
        blueprintId: snapshot.blueprintId,
        blueprintVersion: snapshot.blueprintVersion,
        contentSha256: snapshot.contentSha256,
        moduleCount: snapshot.modules.length,
        variantCount: snapshot.variants.length,
        valid: true,
      },
    });
    expect(stdout).not.toContain(externalFile);
    expect(stdout).not.toContain(root);

    const sceneA = createAcceptanceScene(
      "scene_blueprint_acceptance_a",
      snapshot,
      "damaged",
      "pose.standing-neutral-v1",
    );
    const sceneB = createAcceptanceScene(
      "scene_blueprint_acceptance_b",
      snapshot,
      "repaired",
      "pose.lying-supine-v1",
    );
    const persistenceA = new ScenePersistence(path.join(root, "runtime-a"));
    const persistenceB = new ScenePersistence(path.join(root, "runtime-b"));
    await Promise.all([
      persistenceA.persist(sceneA),
      persistenceB.persist(sceneB),
    ]);
    await unlink(externalFile);

    const [reloadedA, reloadedB] = await Promise.all([
      new ScenePersistence(path.join(root, "runtime-a")).load(),
      new ScenePersistence(path.join(root, "runtime-b")).load(),
    ]);
    const actorA = onlyBlueprintActor(reloadedA);
    const actorB = onlyBlueprintActor(reloadedB);
    const damaged = resolveActorBlueprintVariant(
      reloadedA.actorBlueprints[0]!,
      actorA.blueprintInstance.variantId,
    );
    const repaired = resolveActorBlueprintVariant(
      reloadedB.actorBlueprints[0]!,
      actorB.blueprintInstance.variantId,
    );
    const damagedIds = resolveActorProjection(
      reloadedA,
      actorA,
    ).primitives.map(({ id }) => id);
    const damagedProjection = resolveActorProjection(reloadedA, actorA);
    const rightSocket = damagedProjection.primitives.find(
      ({ id }) => id === "module:shoulder_socket_r:socket",
    );
    const exposedTerminals = damagedProjection.primitives.filter(
      ({ id }) => id.startsWith("module:shoulder_terminals_r:"),
    );
    const repairedIds = resolveActorProjection(
      reloadedB,
      actorB,
    ).primitives.map(({ id }) => id);

    expect(reloadedA.actorBlueprints).toEqual([snapshot]);
    expect(reloadedB.actorBlueprints).toEqual([snapshot]);
    expect(reloadedA.actorBlueprints[0]?.body).toEqual(
      reloadedB.actorBlueprints[0]?.body,
    );
    expect(reloadedA.actorBlueprints[0]?.proportions).toEqual(
      reloadedB.actorBlueprints[0]?.proportions,
    );
    expect(reloadedA.actorBlueprints[0]?.skeleton).toEqual(
      reloadedB.actorBlueprints[0]?.skeleton,
    );
    expect(reloadedA.actorBlueprints[0]?.modules).toEqual(
      reloadedB.actorBlueprints[0]?.modules,
    );

    expect(damaged.limbPresence).toMatchObject({
      upper_arm_r: "absent",
      forearm_r: "absent",
      hand_r: "absent",
      lower_leg_l: "absent",
      foot_l: "absent",
      lower_leg_r: "absent",
      foot_r: "absent",
    });
    expect(damaged.moduleVisibility).toMatchObject({
      shoulder_terminals_r: true,
      knee_interface_l: true,
      knee_interface_r: true,
    });
    expect(damagedIds).toEqual(
      expect.arrayContaining([
        "module:shoulder_terminals_r:terminal_a",
        "module:shoulder_terminals_r:terminal_b",
        "module:shoulder_terminals_r:terminal_c",
        "module:knee_interface_l:seal",
        "module:knee_interface_r:seal",
      ]),
    );
    expect(rightSocket?.kind).toBe("sphere");
    expect(exposedTerminals).toHaveLength(3);
    if (!rightSocket || rightSocket.kind !== "sphere") {
      throw new Error("Right shoulder socket projection is missing.");
    }
    for (const terminal of exposedTerminals) {
      expect(Math.hypot(
        terminal.frame.position[0] - rightSocket.frame.position[0],
        terminal.frame.position[1] - rightSocket.frame.position[1],
        terminal.frame.position[2] - rightSocket.frame.position[2],
      )).toBeGreaterThan(rightSocket.radius);
    }

    expect(repaired.limbPresence).toMatchObject({
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
      lower_leg_l: "absent",
      foot_l: "absent",
      lower_leg_r: "absent",
      foot_r: "absent",
    });
    expect(repaired.moduleVisibility).toMatchObject({
      shoulder_terminals_r: false,
      knee_interface_l: true,
      knee_interface_r: true,
    });
    expect(repairedIds).toEqual(
      expect.arrayContaining([
        "upper_arm_r",
        "forearm_r",
        "hand_r",
        "module:knee_interface_l:seal",
        "module:knee_interface_r:seal",
      ]),
    );
    expect(repairedIds).not.toContain(
      "module:shoulder_terminals_r:terminal_a",
    );

    const multiInstance = structuredClone(reloadedA);
    multiInstance.constraints = [];
    const second = createBlueprintActor({
      id: "actor_entity_blueprint_2",
      slot: "actor_female_2",
      variantId: "repaired",
    });
    second.transform.positionM = [1.4, 0.9, -0.4];
    second.pose.joints.upper_arm_l = [0, 0, 0, 1];
    second.color = "#8994a2";
    second.lockMode = "workflow";
    multiInstance.entities.push(second);
    const parsedMultiInstance = sceneSpecSchema.parse(multiInstance);
    const instances = parsedMultiInstance.entities.filter(
      isBlueprintActorEntity,
    );

    expect(parsedMultiInstance.actorBlueprints).toEqual([snapshot]);
    expect(instances).toHaveLength(2);
    expect(instances.map(({ id }) => id)).toEqual([
      "actor_entity_blueprint_1",
      "actor_entity_blueprint_2",
    ]);
    expect(instances.map(({ slot }) => slot)).toEqual([
      "actor_female_1",
      "actor_female_2",
    ]);
    expect(instances[0]?.blueprintInstance.variantId).toBe("damaged");
    expect(instances[1]).toMatchObject(second);
    expect(JSON.stringify({ reloadedA, reloadedB, parsedMultiInstance })).not.toContain(
      externalFile,
    );
  }, 30_000);
});
