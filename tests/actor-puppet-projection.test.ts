import { describe, expect, it } from "vitest";
import { renderSceneToPng } from "../server/software-png";
import {
  createActorBlueprintSnapshot,
  type ActorBlueprintDocument,
} from "../src/domain/actor-blueprint";
import {
  resolveActorProjection,
  type ActorProjectionPrimitive,
} from "../src/domain/actor-projection";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import { snapTransformToContact } from "../src/domain/contact-constraints";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  quaternionFromEulerDegrees,
  rotateVector,
  transformPoint,
} from "../src/domain/scene-math";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  sceneSpecSchema,
  type BlueprintActorEntity,
  type LegacyActorEntity,
  type SceneSpec,
  type Vec3,
} from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const primitiveById = (
  primitives: readonly ActorProjectionPrimitive[],
  id: string,
): ActorProjectionPrimitive => {
  const primitive = primitives.find((candidate) => candidate.id === id);
  if (!primitive) throw new Error(`Missing primitive ${id}.`);
  return primitive;
};

const primitiveCenter = (primitive: ActorProjectionPrimitive): Vec3 => {
  const offset = rotateVector(
    [...primitive.center],
    primitive.frame.rotation,
  );
  return [
    primitive.frame.position[0] + offset[0],
    primitive.frame.position[1] + offset[1],
    primitive.frame.position[2] + offset[2],
  ];
};

const primitivePoint = (
  primitive: ActorProjectionPrimitive,
  point: Vec3,
): Vec3 => {
  const offset = rotateVector(point, primitive.frame.rotation);
  return [
    primitive.frame.position[0] + offset[0],
    primitive.frame.position[1] + offset[1],
    primitive.frame.position[2] + offset[2],
  ];
};

const primitiveLocalOffset = (
  primitive: ActorProjectionPrimitive,
  point: Vec3,
): Vec3 => {
  const [x, y, z, w] = primitive.frame.rotation;
  const frameOffset: Vec3 = [
    point[0] - primitive.frame.position[0],
    point[1] - primitive.frame.position[1],
    point[2] - primitive.frame.position[2],
  ];
  const local = rotateVector(frameOffset, [-x, -y, -z, w]);
  return [
    local[0] - primitive.center[0],
    local[1] - primitive.center[1],
    local[2] - primitive.center[2],
  ];
};

const profileRadiusAtY = (
  profile: Extract<ActorProjectionPrimitive, { kind: "profile" }>,
  y: number,
): number => {
  for (let index = 1; index < profile.points.length; index += 1) {
    const lower = profile.points[index - 1];
    const upper = profile.points[index];
    if (!lower || !upper || y > upper.y) continue;
    const amount = (y - lower.y) / (upper.y - lower.y);
    return lower.radius + (upper.radius - lower.radius) * amount;
  }
  return profile.points.at(-1)?.radius ?? 0;
};

const legacyActor = (scene: SceneSpec): LegacyActorEntity => {
  const actor = scene.entities.find(isLegacyActorEntity);
  if (!actor) throw new Error("Legacy actor fixture is missing.");
  return actor;
};

const createBlueprintProjectionScene = (
  configureDocument?: (document: ActorBlueprintDocument) => void,
): {
  scene: SceneSpec;
  actor: BlueprintActorEntity;
} => {
  const document = createGenericActorBlueprintDocument();
  configureDocument?.(document);
  document.modules.push({
    moduleId: "wrist_marker_l",
    mount: "wrist_l",
    visible: true,
    parts: [
      {
        partId: "marker",
        primitive: "box",
        transform: {
          positionM: [0.06, 0.02, 0.01],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        sizeM: [0.04, 0.02, 0.03],
      },
    ],
  });
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  const actor = createBlueprintActor({ variantId: "repaired" });
  scene.entities = scene.entities.filter((entity) => entity.kind !== "actor");
  scene.constraints = [];
  scene.actorBlueprints = [createActorBlueprintSnapshot(document)];
  scene.entities.push(actor);
  const parsed = sceneSpecSchema.parse(scene);
  const parsedActor = parsed.entities.find(isBlueprintActorEntity);
  if (!parsedActor) throw new Error("Blueprint actor fixture is missing.");
  return { scene: parsed, actor: parsedActor };
};

describe("adjustable actor puppet projection", () => {
  it("bridges the full legal Blueprint torso-to-head gap without inheriting neck rotation", () => {
    const { scene, actor } = createBlueprintProjectionScene((document) => {
      document.proportions.headRadiusHeightRatio = 0.05;
      document.skeleton.headOriginAboveTorsoHeightRatio = 0.12;
    });
    const neutral = resolveActorProjection(scene, actor);
    actor.pose.joints.neck = quaternionFromEulerDegrees([0, 0, 90]);
    const rotated = resolveActorProjection(scene, actor);
    const neutralTorso = primitiveById(neutral.primitives, "torso");
    const neutralNeck = primitiveById(neutral.primitives, "neck");
    const neutralHead = primitiveById(neutral.primitives, "head");
    const rotatedNeck = primitiveById(rotated.primitives, "neck");
    const rotatedHead = primitiveById(rotated.primitives, "head");
    if (
      neutralTorso.kind !== "profile" ||
      neutralNeck.kind !== "profile" ||
      rotatedNeck.kind !== "profile" ||
      neutralHead.kind !== "profile" ||
      rotatedHead.kind !== "profile"
    ) {
      throw new Error("Expected profile torso, neck, and head.");
    }
    const torsoTop = primitivePoint(neutralTorso, [
      neutralTorso.center[0],
      neutralTorso.center[1] + (neutralTorso.points.at(-1)?.y ?? 0),
      neutralTorso.center[2],
    ]);
    const neutralBase = primitivePoint(neutralNeck, [
      neutralNeck.center[0],
      neutralNeck.center[1] + (neutralNeck.points[0]?.y ?? 0),
      neutralNeck.center[2],
    ]);
    const rotatedBase = primitivePoint(rotatedNeck, [
      rotatedNeck.center[0],
      rotatedNeck.center[1] + (rotatedNeck.points[0]?.y ?? 0),
      rotatedNeck.center[2],
    ]);
    const neutralTop = primitivePoint(neutralNeck, [
      neutralNeck.center[0],
      neutralNeck.center[1] + (neutralNeck.points.at(-1)?.y ?? 0),
      neutralNeck.center[2],
    ]);
    const rotatedTop = primitivePoint(rotatedNeck, [
      rotatedNeck.center[0],
      rotatedNeck.center[1] + (rotatedNeck.points.at(-1)?.y ?? 0),
      rotatedNeck.center[2],
    ]);

    expect(neutralBase[1]).toBeLessThanOrEqual(torsoTop[1]);
    expect(rotatedBase).toEqual(neutralBase);
    expect(rotatedTop).toEqual(neutralTop);
    for (const [head, neckTop] of [
      [neutralHead, neutralTop],
      [rotatedHead, rotatedTop],
    ] as const) {
      const offset = primitiveLocalOffset(head, neckTop);
      const radius = profileRadiusAtY(head, offset[1]);
      expect(offset[1]).toBeGreaterThanOrEqual(head.points[0]?.y ?? 0);
      expect(offset[1]).toBeLessThanOrEqual(head.points.at(-1)?.y ?? 0);
      expect(
        Math.hypot(offset[0] / radius, offset[2] / (radius * head.depthScale)),
      ).toBeLessThanOrEqual(1);
    }
    expect(rotatedHead.frame.position).toEqual(neutralHead.frame.position);
    expect(rotatedHead.frame.rotation).not.toEqual(neutralHead.frame.rotation);
  });

  it("leaves a connected visible neck span in neutral legacy and Blueprint actors", () => {
    const legacyScene = createDefaultScene();
    const legacy = resolveActorProjection(legacyScene, legacyActor(legacyScene));
    const blueprintFixture = createBlueprintProjectionScene();
    const blueprint = resolveActorProjection(
      blueprintFixture.scene,
      blueprintFixture.actor,
    );

    for (const projection of [legacy, blueprint]) {
      const torso = primitiveById(projection.primitives, "torso");
      const neck = primitiveById(projection.primitives, "neck");
      const head = primitiveById(projection.primitives, "head");
      if (
        torso.kind !== "profile" ||
        neck.kind !== "profile" ||
        head.kind !== "profile"
      ) {
        throw new Error("Expected torso, neck, and head profiles.");
      }
      const torsoTop = primitivePoint(torso, [
        torso.center[0],
        torso.center[1] + (torso.points.at(-1)?.y ?? 0),
        torso.center[2],
      ]);
      const neckBase = primitivePoint(neck, [
        neck.center[0],
        neck.center[1] + (neck.points[0]?.y ?? 0),
        neck.center[2],
      ]);
      const neckTop = primitivePoint(neck, [
        neck.center[0],
        neck.center[1] + (neck.points.at(-1)?.y ?? 0),
        neck.center[2],
      ]);
      const headBottom = primitivePoint(head, [
        head.center[0],
        head.center[1] + (head.points[0]?.y ?? 0),
        head.center[2],
      ]);
      const headTop = primitivePoint(head, [
        head.center[0],
        head.center[1] + (head.points.at(-1)?.y ?? 0),
        head.center[2],
      ]);
      const oldHeadTopY =
        head.frame.position[1] + projection.dimensions.headRadius * 1.12;
      const neckTopInHead = primitiveLocalOffset(head, neckTop);
      const headRadiusAtNeckTop = profileRadiusAtY(head, neckTopInHead[1]);

      expect(headBottom[1] - torsoTop[1]).toBeGreaterThanOrEqual(
        projection.dimensions.heightM * 0.023,
      );
      expect(neckBase[1]).toBeLessThanOrEqual(torsoTop[1]);
      expect(neckTop[1]).toBeGreaterThanOrEqual(headBottom[1]);
      expect(
        Math.hypot(
          neckTopInHead[0] / headRadiusAtNeckTop,
          neckTopInHead[2] /
            (headRadiusAtNeckTop * head.depthScale),
        ),
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(headTop[1] - oldHeadTopY)).toBeLessThanOrEqual(
        projection.dimensions.heightM * 0.03,
      );
    }
  });

  it("uses the same humanoid body primitive family for legacy and Blueprint actors", () => {
    const legacyScene = createDefaultScene();
    const legacy = resolveActorProjection(legacyScene, legacyActor(legacyScene));
    const blueprintFixture = createBlueprintProjectionScene();
    const blueprint = resolveActorProjection(
      blueprintFixture.scene,
      blueprintFixture.actor,
    );
    const bodyIds = [
      "pelvis",
      "torso",
      "neck",
      "head",
      "face",
      "upper_arm_l",
      "forearm_l",
      "hand_l",
      "upper_leg_l",
    ];

    expect(
      bodyIds.map((id) => [id, primitiveById(legacy.primitives, id).kind]),
    ).toEqual(
      bodyIds.map((id) => [id, primitiveById(blueprint.primitives, id).kind]),
    );
    expect(primitiveById(legacy.primitives, "torso").kind).toBe("profile");
    expect(primitiveById(legacy.primitives, "head").kind).toBe("profile");
    expect(primitiveById(legacy.primitives, "foot_l").kind).toBe("ellipsoid");
  });

  it("scales Blueprint anatomy, module offsets, and module dimensions from the instance height", () => {
    const { scene, actor } = createBlueprintProjectionScene();
    const snapshotBefore = structuredClone(scene.actorBlueprints[0]);
    const transformBefore = structuredClone(actor.transform);
    const base = resolveActorProjection(scene, actor);
    const baseTorso = primitiveById(base.primitives, "torso");
    const baseHead = primitiveById(base.primitives, "head");
    const baseModule = primitiveById(
      base.primitives,
      "module:wrist_marker_l:marker",
    );
    actor.blueprintInstance.heightScale = 1.2;

    const scaled = resolveActorProjection(scene, actor);
    const scaledTorso = primitiveById(scaled.primitives, "torso");
    const scaledHead = primitiveById(scaled.primitives, "head");
    const scaledModule = primitiveById(
      scaled.primitives,
      "module:wrist_marker_l:marker",
    );

    expect(scaled.dimensions.heightM).toBeCloseTo(
      base.dimensions.heightM * 1.2,
      9,
    );
    expect(scaled.dimensions.shoulderWidthM).toBeCloseTo(
      base.dimensions.shoulderWidthM * 1.2,
      9,
    );
    if (baseModule.kind !== "box" || scaledModule.kind !== "box") {
      throw new Error("Expected wrist marker boxes.");
    }
    expect(scaledModule.size).toEqual(
      baseModule.size.map((value) => value * 1.2),
    );
    expect(scaledModule.frame.position).not.toEqual(baseModule.frame.position);
    if (baseTorso.kind !== "profile" || scaledTorso.kind !== "profile") {
      throw new Error("Expected torso profiles.");
    }
    scaledTorso.points.forEach((point, index) => {
      expect(point.y).toBeCloseTo((baseTorso.points[index]?.y ?? 0) * 1.2, 12);
      expect(point.radius).toBeCloseTo(
        (baseTorso.points[index]?.radius ?? 0) * 1.2,
        12,
      );
    });
    expect(scaledTorso.depthScale).toBe(baseTorso.depthScale);
    if (baseHead.kind !== "profile" || scaledHead.kind !== "profile") {
      throw new Error("Expected head profiles.");
    }
    scaledHead.points.forEach((point, index) => {
      expect(point.y).toBeCloseTo((baseHead.points[index]?.y ?? 0) * 1.2, 12);
      expect(point.radius).toBeCloseTo(
        (baseHead.points[index]?.radius ?? 0) * 1.2,
        12,
      );
    });
    expect(scaledHead.depthScale).toBe(baseHead.depthScale);
    expect(scene.actorBlueprints[0]).toEqual(snapshotBefore);
    expect(scene.actorBlueprints[0]?.contentSha256).toBe(
      snapshotBefore?.contentSha256,
    );
    expect(actor.transform).toEqual(transformBefore);
  });

  it("projects Blueprint limb-presence overrides above the selected variant", () => {
    const { scene, actor } = createBlueprintProjectionScene();
    actor.blueprintInstance.variantId = "damaged";
    actor.blueprintInstance.limbPresenceOverrides = {
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
    };

    const projection = resolveActorProjection(scene, actor);

    expect(projection.effective.limbPresence.hand_r).toBe("present");
    expect(projection.primitives.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["upper_arm_r", "forearm_r", "hand_r"]),
    );
  });

  it("rotates the hand and wrist module around the wrist without moving the forearm endpoint", () => {
    const { scene, actor } = createBlueprintProjectionScene();
    const before = resolveActorProjection(scene, actor);
    const beforeForearm = primitiveById(before.primitives, "forearm_l");
    const beforeHand = primitiveById(before.primitives, "hand_l");
    const beforeModule = primitiveById(
      before.primitives,
      "module:wrist_marker_l:marker",
    );
    actor.pose.joints.hand_l = quaternionFromEulerDegrees([0, 0, 75]);

    const after = resolveActorProjection(scene, actor);
    const afterForearm = primitiveById(after.primitives, "forearm_l");
    const afterHand = primitiveById(after.primitives, "hand_l");
    const afterModule = primitiveById(
      after.primitives,
      "module:wrist_marker_l:marker",
    );

    expect(afterForearm.frame).toEqual(beforeForearm.frame);
    expect(afterHand.frame.position).toEqual(beforeHand.frame.position);
    expect(afterHand.frame.rotation).not.toEqual(beforeHand.frame.rotation);
    expect(primitiveCenter(afterHand)).not.toEqual(primitiveCenter(beforeHand));
    expect(primitiveCenter(afterModule)).not.toEqual(
      primitiveCenter(beforeModule),
    );
  });

  it("rotates the foot around the ankle without moving the lower-leg endpoint", () => {
    const scene = createDefaultScene();
    const actor = legacyActor(scene);
    const before = resolveActorProjection(scene, actor);
    const beforeLowerLeg = primitiveById(before.primitives, "lower_leg_r");
    const beforeFoot = primitiveById(before.primitives, "foot_r");
    actor.pose.joints.foot_r = quaternionFromEulerDegrees([55, 0, 0]);

    const after = resolveActorProjection(scene, actor);
    const afterLowerLeg = primitiveById(after.primitives, "lower_leg_r");
    const afterFoot = primitiveById(after.primitives, "foot_r");

    expect(afterLowerLeg.frame).toEqual(beforeLowerLeg.frame);
    expect(afterFoot.frame.position).toEqual(beforeFoot.frame.position);
    expect(afterFoot.frame.rotation).not.toEqual(beforeFoot.frame.rotation);
    expect(primitiveCenter(afterFoot)).not.toEqual(primitiveCenter(beforeFoot));
  });

  it("keeps visible bounds and software diagnostics on the resolved projection", () => {
    const { scene, actor } = createBlueprintProjectionScene();
    actor.blueprintInstance.heightScale = 1.15;
    actor.pose.joints.hand_l = quaternionFromEulerDegrees([0, 0, 45]);
    const primitiveIds = resolveActorProjection(scene, actor).primitives.map(
      ({ id }) => id,
    );

    expect(actorVisibleRigBounds(scene, actor).primitiveIds).toEqual(
      primitiveIds,
    );
    expect(
      renderSceneToPng(scene, 320, 180).diagnostics.actorPrimitiveIds[actor.id],
    ).toEqual(primitiveIds);
  });

  it("keeps flat module cylinders consistent across contact and software projection", () => {
    const { scene, actor } = createBlueprintProjectionScene((document) => {
      document.modules = [
        {
          moduleId: "knee_support_l",
          mount: "knee_l",
          visible: true,
          parts: [
            {
              partId: "support",
              primitive: "cylinder",
              transform: {
                positionM: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
              },
              radiusM: 0.05,
              lengthM: 0.3,
            },
          ],
        },
      ];
      for (const variant of document.variants) {
        variant.moduleVisibility = {};
      }
    });
    scene.constraints = [
      {
        id: "constraint_blueprint_cylinder_ground",
        type: "ground-contact",
        entityId: actor.id,
        surfaceEntityId: null,
        enabled: true,
      },
    ];
    const cylinder = primitiveById(
      resolveActorProjection(scene, actor).primitives,
      "module:knee_support_l:support",
    );
    if (cylinder.kind !== "cylinder") {
      throw new Error("Expected a flat cylinder module primitive.");
    }

    const snapped = snapTransformToContact(scene, actor.id, {
      ...actor.transform,
      positionM: [0, 0, 0],
    });
    const actualBottomLocal = primitivePoint(cylinder, [
      cylinder.center[0],
      cylinder.center[1] - cylinder.length / 2,
      cylinder.center[2],
    ]);
    const actualBottomWorld = transformPoint(snapped, actualBottomLocal);

    expect(actualBottomWorld[1]).toBeCloseTo(0, 9);
    expect(
      renderSceneToPng(scene, 320, 180).diagnostics.actorPrimitiveDrawCounts[
        actor.id
      ][cylinder.id],
    ).toBeGreaterThan(3);
  });
});
