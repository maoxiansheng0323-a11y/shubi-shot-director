import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScenePersistence } from "../server/scene-persistence";
import { SceneSession } from "../server/scene-session";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { canonicalPuppetJointIds } from "../src/domain/actor-joints";
import { createDefaultScene } from "../src/domain/default-scene";
import { INTENT_REPORT_SCHEMA_VERSION } from "../src/domain/intent-report";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import type { ScenePatch } from "../src/domain/scene-patch";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  PATCH_SCHEMA_VERSION,
  SCENE_SCHEMA_VERSION,
} from "../src/domain/schema-versions";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";
import { createExplicitPuppetActionPose } from "./helpers/structured-fixtures";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

type ActorCase = "legacy" | "blueprint";

const createActorScene = (
  actorCase: ActorCase,
): { actorId: string; scene: SceneSpec } => {
  const scene = sceneSpecSchema.parse(createDefaultScene());
  scene.sceneId = `scene_puppet_${actorCase}`;
  scene.title = `Generic ${actorCase} puppet persistence`;
  if (actorCase === "legacy") {
    return { actorId: "actor_generic_1", scene };
  }

  const actor = createBlueprintActor({
    id: "actor_blueprint_puppet_1",
    slot: "actor_generic_2",
    variantId: "repaired",
  });
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(createGenericActorBlueprintDocument()),
  ];
  scene.entities = scene.entities.filter((entity) => entity.kind !== "actor");
  scene.entities.push(actor);
  scene.constraints = [
    {
      id: "constraint_ground_blueprint_puppet_1",
      type: "ground-contact",
      entityId: actor.id,
      surfaceEntityId: "environment_room_1",
      enabled: true,
    },
  ];
  return { actorId: actor.id, scene: sceneSpecSchema.parse(scene) };
};

const patchConstraintKind = {
  "actor.height.set": "actor-height",
  "actor.limb-presence.set": "actor-limb-presence",
  "actor.pose.set": "pose",
  "actor.pose.joints.set": "pose",
} as const;

const submitActorPatch = (
  session: SceneSession,
  actorCase: ActorCase,
  actorId: string,
  sequence: number,
  operation: ScenePatch["operations"][number],
): SceneSpec => {
  if (!(operation.op in patchConstraintKind)) {
    throw new Error(`Unsupported actor-puppet test operation: ${operation.op}`);
  }
  const constraintKind =
    patchConstraintKind[operation.op as keyof typeof patchConstraintKind];
  const before = session.snapshot();
  const patch = {
    schemaVersion: PATCH_SCHEMA_VERSION,
    patchId: `patch_${actorCase}_puppet_${sequence}`,
    sceneId: before.sceneId,
    baseRevision: before.revision,
    source: "natural-language",
    preserveLock: false,
    operations: [operation],
  } satisfies ScenePatch;

  return session.submitPatch({
    intentReport: {
      schemaVersion: INTENT_REPORT_SCHEMA_VERSION,
      operation: "modify",
      allowPartial: false,
      recognizedConstraints: [
        {
          id: `intent_${actorCase}_puppet_${sequence}`,
          kind: constraintKind,
          required: true,
          targets: [actorId],
          evidence: [{ type: "patch-operation", operationIndex: 0 }],
        },
      ],
      unsupportedConstraints: [],
      unresolvedRelations: [],
      warnings: [],
      canApplySafely: true,
    },
    patch,
  });
};

const expectBlueprintSnapshotStable = (
  scene: SceneSpec,
  expected: SceneSpec["actorBlueprints"],
): void => {
  expect(scene.actorBlueprints).toEqual(expected);
  expect(scene.actorBlueprints.map(({ contentSha256 }) => contentSha256)).toEqual(
    expected.map(({ contentSha256 }) => contentSha256),
  );
};

describe.each(["legacy", "blueprint"] as const)(
  "actor puppet %s persistence black box",
  (actorCase) => {
    it("keeps canonical v6 state exact across structured patches, history, and save/load", async () => {
      const { actorId, scene } = createActorScene(actorCase);
      const session = new SceneSession(scene);
      const initial = session.snapshot();
      const actorBlueprints = structuredClone(initial.actorBlueprints);
      const actionPose = createExplicitPuppetActionPose();
      const jointUpdate = quaternionFromEulerDegrees([9, -13, 7]);
      const operations: ScenePatch["operations"][number][] = [
        { op: "actor.height.set", actorId, heightM: 1.84 },
        {
          op: "actor.limb-presence.set",
          actorId,
          updates: { hand_l: "absent" },
        },
        { op: "actor.pose.set", entityId: actorId, value: actionPose },
        {
          op: "actor.pose.joints.set",
          actorId,
          updates: { neck: jointUpdate },
        },
      ];
      const canonicalStates = [initial];

      for (const [index, operation] of operations.entries()) {
        const before = session.snapshot();
        const after = submitActorPatch(
          session,
          actorCase,
          actorId,
          index + 1,
          operation,
        );
        expect(after.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
        expect(after.revision).toBe(before.revision + 1);
        expectBlueprintSnapshotStable(after, actorBlueprints);
        const afterActor = after.entities.find(({ id }) => id === actorId);
        expect(afterActor?.kind).toBe("actor");
        if (!afterActor || afterActor.kind !== "actor") {
          throw new Error("Actor puppet patch lost its target actor.");
        }
        if (index === 2) {
          expect(afterActor.pose).toEqual(actionPose);
        }
        if (index === 3) {
          expect(afterActor.pose.preset.id).toBe("pose.custom-v1");
          expect(afterActor.pose.joints.neck).toEqual(jointUpdate);
          for (const jointId of canonicalPuppetJointIds) {
            if (jointId === "neck") continue;
            expect(afterActor.pose.joints[jointId]).toEqual(
              actionPose.joints[jointId],
            );
          }
        }
        canonicalStates.push(after);
      }

      const finalPatched = canonicalStates.at(-1)!;
      const finalActor = finalPatched.entities.find(({ id }) => id === actorId);
      expect(finalActor?.kind).toBe("actor");
      if (!finalActor || finalActor.kind !== "actor") {
        throw new Error("Actor puppet black-box fixture lost its actor.");
      }
      if (actorCase === "legacy") {
        expect(isLegacyActorEntity(finalActor)).toBe(true);
        if (!isLegacyActorEntity(finalActor)) {
          throw new Error("Expected a legacy actor.");
        }
        expect(finalActor.body.heightM).toBe(1.84);
        expect(finalActor.body.limbPresence.hand_l).toBe("absent");
      } else {
        expect(isBlueprintActorEntity(finalActor)).toBe(true);
        if (!isBlueprintActorEntity(finalActor)) {
          throw new Error("Expected a Blueprint actor.");
        }
        expect(finalActor.blueprintInstance.heightScale).toBeCloseTo(
          1.84 / actorBlueprints[0]!.body.heightM,
        );
        expect(finalActor.blueprintInstance.limbPresenceOverrides).toMatchObject(
          { hand_l: "absent" },
        );
      }
      expect(Object.keys(finalActor.pose.joints).sort()).toEqual(
        [...canonicalPuppetJointIds].sort(),
      );
      expect(finalActor.pose.preset.id).toBe("pose.custom-v1");

      let expectedRevision = finalPatched.revision;
      for (let index = canonicalStates.length - 2; index >= 0; index -= 1) {
        const undone = session.undo();
        expectedRevision += 1;
        expect(undone).toEqual({
          ...structuredClone(canonicalStates[index]),
          revision: expectedRevision,
        });
        expectBlueprintSnapshotStable(undone!, actorBlueprints);
      }
      for (let index = 1; index < canonicalStates.length; index += 1) {
        const redone = session.redo();
        expectedRevision += 1;
        expect(redone).toEqual({
          ...structuredClone(canonicalStates[index]),
          revision: expectedRevision,
        });
        expectBlueprintSnapshotStable(redone!, actorBlueprints);
      }

      const finalCanonical = session.snapshot();
      const directory = await mkdtemp(
        path.join(os.tmpdir(), `shubi-shot-puppet-${actorCase}-`),
      );
      temporaryDirectories.push(directory);
      const runtimeDirectory = path.join(directory, "runtime");
      const persistence = new ScenePersistence(runtimeDirectory);
      await persistence.persist(finalCanonical);
      const rawJson = JSON.parse(
        await readFile(path.join(runtimeDirectory, "current.scene.json"), "utf8"),
      ) as unknown;
      expect(rawJson).toMatchObject({ schemaVersion: SCENE_SCHEMA_VERSION });
      const rawScene = sceneSpecSchema.parse(rawJson);
      const rawActor = rawScene.entities.find(({ id }) => id === actorId);
      const finalCanonicalActor = finalCanonical.entities.find(
        ({ id }) => id === actorId,
      );
      expect(rawActor).toEqual(finalCanonicalActor);
      expect(rawActor?.kind).toBe("actor");
      expect(finalCanonicalActor?.kind).toBe("actor");
      if (
        !rawActor ||
        rawActor.kind !== "actor" ||
        !finalCanonicalActor ||
        finalCanonicalActor.kind !== "actor"
      ) {
        throw new Error("Persisted actor puppet is missing its target actor.");
      }
      expect(rawActor.pose).toEqual(finalCanonicalActor.pose);
      if (
        isLegacyActorEntity(rawActor) &&
        isLegacyActorEntity(finalCanonicalActor)
      ) {
        expect(rawActor.body).toEqual(finalCanonicalActor.body);
      } else if (
        isBlueprintActorEntity(rawActor) &&
        isBlueprintActorEntity(finalCanonicalActor)
      ) {
        expect(rawActor.blueprintInstance).toEqual(
          finalCanonicalActor.blueprintInstance,
        );
      } else {
        throw new Error("Persisted actor puppet changed actor representation.");
      }
      expectBlueprintSnapshotStable(rawScene, actorBlueprints);

      const restored = await new ScenePersistence(runtimeDirectory).load();

      expect(restored).toEqual(finalCanonical);
      expect(restored.schemaVersion).toBe(SCENE_SCHEMA_VERSION);
      expectBlueprintSnapshotStable(restored, actorBlueprints);
    });
  },
);
