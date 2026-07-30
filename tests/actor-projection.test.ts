import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import legacyV05Projection from "./fixtures/legacy-actor-v05-projection.json";
import { renderSceneToPng } from "../server/software-png";
import {
  resolveActorProjection,
  type ActorProjectionPrimitive,
} from "../src/domain/actor-projection";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { analyzeComposition } from "../src/domain/composition-safety";
import { snapTransformToContact } from "../src/domain/contact-constraints";
import {
  createActorBlueprintSnapshot,
} from "../src/domain/actor-blueprint";
import { createDefaultScene } from "../src/domain/default-scene";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  sceneSpecSchema,
  type BlueprintActorEntity,
  type LegacyActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const legacyActorIn = (scene: SceneSpec): LegacyActorEntity => {
  const actor = scene.entities.find(isLegacyActorEntity);
  if (!actor) throw new Error("Legacy actor fixture is missing.");
  return actor;
};

const blueprintScene = (
  variantId: "damaged" | "repaired" = "damaged",
): { scene: SceneSpec; actor: BlueprintActorEntity } => {
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  const actor = createBlueprintActor({ variantId });
  scene.entities = scene.entities.filter((entity) => entity.kind !== "actor");
  scene.constraints = [];
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(createGenericActorBlueprintDocument()),
  ];
  scene.entities.push(actor);
  const parsed = sceneSpecSchema.parse(scene);
  const parsedActor = parsed.entities.find(isBlueprintActorEntity);
  if (!parsedActor) throw new Error("Blueprint actor fixture is missing.");
  return { scene: parsed, actor: parsedActor };
};

const primitiveById = (
  primitives: readonly ActorProjectionPrimitive[],
  id: string,
): ActorProjectionPrimitive => {
  const primitive = primitives.find((candidate) => candidate.id === id);
  if (!primitive) throw new Error(`Missing primitive ${id}.`);
  return primitive;
};

describe("resolved actor projection", () => {
  it("preserves the v0.5 legacy primitive projection within 1e-9", () => {
    const scene = createDefaultScene();
    const projection = resolveActorProjection(scene, legacyActorIn(scene));

    expect(projection.primitives).toHaveLength(
      legacyV05Projection.primitives.length,
    );
    expect(projection.primitives.map(({ id, kind }) => ({ id, kind }))).toEqual(
      legacyV05Projection.primitives.map(({ id, kind }) => ({ id, kind })),
    );

    const actualNumbers = JSON.stringify(projection.primitives).match(
      /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu,
    );
    const expectedNumbers = JSON.stringify(legacyV05Projection.primitives).match(
      /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu,
    );
    if (!actualNumbers || !expectedNumbers) {
      throw new Error("Projection fixtures must contain numeric geometry.");
    }
    expect(actualNumbers).toHaveLength(expectedNumbers.length);
    actualNumbers.forEach((value, index) => {
      const expected = expectedNumbers[index];
      if (expected === undefined) {
        throw new Error(`Missing baseline number at index ${index}.`);
      }
      expect(Number(value)).toBeCloseTo(Number(expected), 9);
    });
  });

  it("resolves damaged and repaired variants from one complete base anatomy", () => {
    const damagedFixture = blueprintScene("damaged");
    const repairedFixture = blueprintScene("repaired");
    const damaged = resolveActorProjection(
      damagedFixture.scene,
      damagedFixture.actor,
    );
    const repaired = resolveActorProjection(
      repairedFixture.scene,
      repairedFixture.actor,
    );
    const damagedIds = damaged.primitives.map(({ id }) => id);
    const repairedIds = repaired.primitives.map(({ id }) => id);

    expect(Object.keys(damaged.mountFrames).sort()).toEqual([
      "elbow_l",
      "elbow_r",
      "hip_l",
      "hip_r",
      "knee_l",
      "knee_r",
      "shoulder_l",
      "shoulder_r",
      "wrist_l",
      "wrist_r",
    ]);
    expect(damagedIds).not.toEqual(
      expect.arrayContaining(["upper_arm_r", "forearm_r", "hand_r"]),
    );
    expect(damagedIds).not.toEqual(
      expect.arrayContaining(["lower_leg_l", "foot_l", "lower_leg_r", "foot_r"]),
    );
    expect(damagedIds).toEqual(
      expect.arrayContaining([
        "module:shoulder_terminals_r:terminal_a",
        "module:shoulder_terminals_r:terminal_b",
        "module:shoulder_terminals_r:terminal_c",
        "module:knee_interface_l:seal",
        "module:knee_interface_r:seal",
      ]),
    );

    expect(repairedIds).toEqual(
      expect.arrayContaining(["upper_arm_r", "forearm_r", "hand_r"]),
    );
    expect(repairedIds).not.toEqual(
      expect.arrayContaining([
        "module:shoulder_terminals_r:terminal_a",
        "lower_leg_l",
        "foot_l",
        "lower_leg_r",
        "foot_r",
      ]),
    );
    expect(repairedIds).toEqual(
      expect.arrayContaining([
        "module:knee_interface_l:seal",
        "module:knee_interface_r:seal",
      ]),
    );
    expect(repaired.dimensions).toEqual(damaged.dimensions);
  });

  it("mounts scaled box, sphere, and cylinder parts on the posed bone chain", () => {
    const document = createGenericActorBlueprintDocument();
    document.modules.push({
      moduleId: "elbow_marker_r",
      mount: "elbow_r",
      visible: true,
      parts: [
        {
          partId: "box",
          primitive: "box",
          transform: {
            positionM: [0.01, 0.02, 0.03],
            rotation: [0, 0, 0, 1],
            scale: [2, 3, 4],
          },
          sizeM: [0.02, 0.03, 0.04],
        },
        {
          partId: "sphere",
          primitive: "sphere",
          transform: {
            positionM: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [2, 3, 4],
          },
          radiusM: 0.01,
        },
        {
          partId: "cylinder",
          primitive: "cylinder",
          transform: {
            positionM: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [2, 3, 4],
          },
          radiusM: 0.01,
          lengthM: 0.02,
        },
      ],
    });
    const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
    const actor = createBlueprintActor({ variantId: "repaired" });
    actor.pose.joints.shoulder_r = quaternionFromEulerDegrees([17, -23, 31]);
    actor.pose.joints.elbow_r = quaternionFromEulerDegrees([-29, 11, 43]);
    scene.entities = scene.entities.filter((entity) => entity.kind !== "actor");
    scene.constraints = [];
    scene.actorBlueprints = [createActorBlueprintSnapshot(document)];
    scene.entities.push(actor);
    const parsed = sceneSpecSchema.parse(scene);
    const parsedActor = parsed.entities.find(isBlueprintActorEntity);
    if (!parsedActor) throw new Error("Blueprint actor fixture is missing.");
    const projection = resolveActorProjection(parsed, parsedActor);
    const box = primitiveById(
      projection.primitives,
      "module:elbow_marker_r:box",
    );
    const sphere = primitiveById(
      projection.primitives,
      "module:elbow_marker_r:sphere",
    );
    const cylinder = primitiveById(
      projection.primitives,
      "module:elbow_marker_r:cylinder",
    );

    expect(box.frame.rotation).toEqual(projection.mountFrames.elbow_r.rotation);
    expect(box.frame.position).not.toEqual(projection.mountFrames.elbow_r.position);
    if (box.kind !== "box") throw new Error("Expected box.");
    expect(box.size).toEqual([0.04, 0.09, 0.16]);
    if (sphere.kind !== "sphere") throw new Error("Expected sphere.");
    expect(sphere.radius).toBe(0.04);
    if (cylinder.kind !== "cylinder") throw new Error("Expected cylinder.");
    expect(cylinder.radius).toBe(0.04);
    expect(cylinder.length).toBe(0.06);
  });

  it("backs all narrative anchors with the same projection", () => {
    const { scene, actor } = blueprintScene();
    const projection = resolveActorProjection(scene, actor);

    expect(projection.anchors.root).toEqual([0, 0, 0]);
    expect(projection.anchors.pelvis).toEqual([0, 0, 0]);
    expect(projection.anchors.face[2]).toBeGreaterThan(
      projection.anchors.head[2],
    );
    expect(Object.keys(projection.anchors).sort()).toEqual([
      "chest",
      "face",
      "head",
      "pelvis",
      "root",
    ]);
  });

  it("gives bounds and software export the identical primitive list", () => {
    const { scene, actor } = blueprintScene();
    const primitiveIds = resolveActorProjection(
      scene,
      actor,
    ).primitives.map(({ id }) => id);

    expect(actorVisibleRigBounds(scene, actor).primitiveIds).toEqual(
      primitiveIds,
    );
    expect(
      renderSceneToPng(scene, 320, 180)
        .diagnostics.actorPrimitiveIds[actor.id],
    ).toEqual(primitiveIds);
    expect(analyzeComposition(scene).occlusionSafe.status).not.toBe("fail");
  });

  it("uses projected damaged modules as the contact support geometry", () => {
    const { scene, actor } = blueprintScene();
    scene.constraints = [
      {
        id: "constraint_ground_blueprint_1",
        type: "ground-contact",
        entityId: actor.id,
        surfaceEntityId: null,
        enabled: true,
      },
    ];
    const candidate = {
      ...actor.transform,
      positionM: [
        actor.transform.positionM[0],
        0,
        actor.transform.positionM[2],
      ] as [number, number, number],
    };
    const snapped = snapTransformToContact(scene, actor.id, candidate);

    expect(
      actorVisibleRigBounds(scene, actor, snapped).minWorld[1],
    ).toBeCloseTo(0, 9);
  });

  it("keeps every geometry consumer on actor-projection", () => {
    const consumerPaths = [
      "src/three/SceneWorld.tsx",
      "src/domain/actor-visible-bounds.ts",
      "src/domain/composition-safety.ts",
      "server/software-png.ts",
    ];

    for (const path of consumerPaths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("actor-projection");
      expect(source, path).not.toContain("deriveActorAnatomyDimensions(");
      expect(source, path).not.toContain("actor.body.heightM");
      expect(source, path).not.toContain("actor.body.shoulderWidthM");
    }
  });
});
