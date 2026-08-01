import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LatheGeometry, Vector2 } from "three";
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
  type ActorBlueprintDocument,
} from "../src/domain/actor-blueprint";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  quaternionFromEulerDegrees,
  rotateVector,
} from "../src/domain/scene-math";
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
  configureDocument?: (document: ActorBlueprintDocument) => void,
): { scene: SceneSpec; actor: BlueprintActorEntity } => {
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  const actor = createBlueprintActor({ variantId });
  const document = createGenericActorBlueprintDocument();
  configureDocument?.(document);
  scene.entities = scene.entities.filter((entity) => entity.kind !== "actor");
  scene.constraints = [];
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(document),
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

const primitivePoint = (
  primitive: ActorProjectionPrimitive,
  point: readonly [number, number, number],
): readonly number[] => {
  const rotated = rotateVector([...point], primitive.frame.rotation);
  return primitive.frame.position.map(
    (component, axis) => component + rotated[axis],
  );
};

describe("resolved actor projection", () => {
  it("emits valid ascending profiles with outward-facing LatheGeometry normals", () => {
    const scene = createDefaultScene();
    const projection = resolveActorProjection(scene, legacyActorIn(scene));
    const profiles = projection.primitives.filter(
      (primitive) => primitive.kind === "profile",
    );

    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      expect(profile.depthScale).toBeGreaterThan(0);
      expect(profile.radialSegments).toBeGreaterThanOrEqual(3);
      profile.points.forEach(({ y, radius }, index) => {
        expect(Number.isFinite(y)).toBe(true);
        expect(Number.isFinite(radius)).toBe(true);
        expect(radius).toBeGreaterThan(0);
        if (index > 0) {
          expect(y).toBeGreaterThan(profile.points[index - 1]?.y ?? y);
        }
      });
    }

    const limb = primitiveById(projection.primitives, "upper_arm_l");
    if (limb.kind !== "profile") throw new Error("Expected upper-arm profile.");
    const geometry = new LatheGeometry(
      limb.points.map(({ radius, y }) => new Vector2(radius, y)),
      limb.radialSegments,
    );
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    let radialDotTotal = 0;
    let radialVertexCount = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const radialLength = Math.hypot(x, z);
      if (radialLength <= 1e-9) continue;
      radialDotTotal +=
        (x * normals.getX(index) + z * normals.getZ(index)) / radialLength;
      radialVertexCount += 1;
    }
    geometry.dispose();

    expect(radialVertexCount).toBeGreaterThan(0);
    expect(radialDotTotal / radialVertexCount).toBeGreaterThan(0);
  });

  it("uses a jaw-to-crown head profile with stable top and geometry-backed anchors", () => {
    const scene = createDefaultScene();
    const projection = resolveActorProjection(scene, legacyActorIn(scene));
    const head = primitiveById(projection.primitives, "head");
    const face = primitiveById(projection.primitives, "face");
    if (head.kind !== "profile" || face.kind !== "ellipsoid") {
      throw new Error("Expected profile head and ellipsoid face.");
    }
    const headRadii = head.points.map(({ radius }) => radius);
    const headBottomY = head.points[0]?.y ?? 0;
    const headTopY = head.points.at(-1)?.y ?? 0;
    const headHeight = headTopY - headBottomY;
    const headWidth = Math.max(...headRadii) * 2;
    const actualHeadTop = primitivePoint(head, [0, headTopY, 0]);
    const oldHeadTopY =
      head.frame.position[1] + projection.dimensions.headRadius * 1.12;
    const expectedHeadAnchor = primitivePoint(head, [
      0,
      (headBottomY + headTopY) / 2,
      0,
    ]);
    const expectedFaceAnchor = primitivePoint(face, [...face.center]);

    expect(head.points.length).toBeGreaterThanOrEqual(5);
    expect(headHeight).toBeGreaterThan(headWidth);
    expect(head.points[0]?.radius).toBeLessThan(Math.max(...headRadii) * 0.7);
    expect(head.points.at(-1)?.radius).toBeLessThanOrEqual(
      Math.max(...headRadii) * 0.15,
    );
    expect(Math.max(...headRadii.slice(2, -1))).toBeGreaterThan(
      head.points[1]?.radius ?? Number.POSITIVE_INFINITY,
    );
    expect(Math.abs((actualHeadTop[1] ?? 0) - oldHeadTopY)).toBeLessThanOrEqual(
      projection.dimensions.heightM * 0.03,
    );
    expect(projection.anchors.head).toEqual(expectedHeadAnchor);
    expect(projection.anchors.face).toEqual(expectedFaceAnchor);
  });

  it("uses one shallow face marker slightly outside the head profile", () => {
    const scene = createDefaultScene();
    const projection = resolveActorProjection(scene, legacyActorIn(scene));
    const head = primitiveById(projection.primitives, "head");
    const facePrimitives = projection.primitives.filter(({ id }) => id === "face");
    const face = facePrimitives[0];
    if (head.kind !== "profile" || face?.kind !== "ellipsoid") {
      throw new Error("Expected profile head and ellipsoid face.");
    }
    const faceProfileY = face.center[1] - head.center[1];
    const headFrontZ =
      head.center[2] + profileRadiusAtY(head, faceProfileY) * head.depthScale;
    const faceFrontZ = face.center[2] + face.radii[2];
    const protrusion = faceFrontZ - headFrontZ;

    expect(facePrimitives).toHaveLength(1);
    expect(protrusion).toBeGreaterThan(0);
    expect(protrusion).toBeLessThanOrEqual(projection.dimensions.headRadius * 0.04);
    expect(face.radii[0]).toBeLessThanOrEqual(projection.dimensions.headRadius * 0.14);
    expect(face.radii[2]).toBeLessThanOrEqual(projection.dimensions.headRadius * 0.06);
  });

  it("holds a broad upper-chest plateau before narrowing into the neck", () => {
    const scene = createDefaultScene();
    const projection = resolveActorProjection(scene, legacyActorIn(scene));
    const torso = primitiveById(projection.primitives, "torso");
    const neck = primitiveById(projection.primitives, "neck");
    if (torso.kind !== "profile" || neck.kind !== "profile") {
      throw new Error("Expected torso and neck profiles.");
    }
    const maximumRadius = Math.max(...torso.points.map(({ radius }) => radius));
    const upperChest = torso.points.filter(
      ({ y }) =>
        y >= projection.dimensions.torsoLength * 0.72 &&
        y <= projection.dimensions.torsoLength * 0.94,
    );
    const waistRadius = Math.min(
      ...torso.points
        .filter(({ y }) => y <= projection.dimensions.torsoLength * 0.3)
        .map(({ radius }) => radius),
    );

    expect(upperChest.length).toBeGreaterThanOrEqual(3);
    expect(upperChest.every(({ radius }) => radius >= maximumRadius * 0.92)).toBe(
      true,
    );
    expect(waistRadius).toBeLessThan(maximumRadius * 0.78);
    expect(waistRadius).toBeGreaterThan(maximumRadius * 0.58);
    expect(
      Math.abs(
        (torso.points.at(-1)?.radius ?? 0) -
          (neck.points[0]?.radius ?? 0),
      ),
    ).toBeLessThanOrEqual(projection.dimensions.headRadius * 0.02);
    expect(torso.depthScale).toBeGreaterThan(0);
    expect(torso.depthScale).toBeLessThan(1);
  });

  it("clamps extreme legal body depths to a readable wide silhouette", () => {
    const legacyScene = createDefaultScene();
    const legacyActor = legacyActorIn(legacyScene);
    legacyActor.body.heightM = 2.4;
    legacyActor.body.shoulderWidthM = 0.25;
    legacyActor.body.build = "broad";
    const legacy = resolveActorProjection(legacyScene, legacyActor);
    const blueprintFixture = blueprintScene("repaired", (document) => {
      document.body.heightM = 2.4;
      document.body.shoulderWidthM = 0.25;
      document.body.build = "broad";
      document.proportions.torsoDepthHeightRatio = 0.2;
      document.proportions.torsoRadiusShoulderRatio = 0.15;
      document.proportions.pelvisWidthShoulderRatio = 0.5;
    });
    const blueprint = resolveActorProjection(
      blueprintFixture.scene,
      blueprintFixture.actor,
    );

    for (const projection of [legacy, blueprint]) {
      const torso = primitiveById(projection.primitives, "torso");
      const pelvis = primitiveById(projection.primitives, "pelvis");
      if (torso.kind !== "profile" || pelvis.kind !== "profile") {
        throw new Error("Expected torso and pelvis profiles.");
      }
      expect(torso.depthScale).toBeGreaterThanOrEqual(0.32);
      expect(torso.depthScale).toBeLessThanOrEqual(0.82);
      expect(pelvis.depthScale).toBeGreaterThanOrEqual(0.32);
      expect(pelvis.depthScale).toBeLessThanOrEqual(0.78);
    }
  });

  it("projects a tapered humanoid silhouette without changing actor persistence", () => {
    const scene = createDefaultScene();
    const actor = legacyActorIn(scene);
    const actorBefore = structuredClone(actor);
    const projection = resolveActorProjection(scene, actor);
    const torso = primitiveById(projection.primitives, "torso");
    const pelvis = primitiveById(projection.primitives, "pelvis");
    const forearm = primitiveById(projection.primitives, "forearm_l");
    const lowerLeg = primitiveById(projection.primitives, "lower_leg_l");
    const foot = primitiveById(projection.primitives, "foot_l");

    expect(projection.primitives.map(({ id }) => id)).toContain("neck");
    if (
      torso.kind !== "profile" ||
      pelvis.kind !== "profile" ||
      forearm.kind !== "profile" ||
      lowerLeg.kind !== "profile"
    ) {
      throw new Error("Expected tapered profile body masses.");
    }
    expect(torso.points.at(-2)?.radius).toBeGreaterThan(
      torso.points[1]?.radius ?? Number.POSITIVE_INFINITY,
    );
    expect(Math.max(...pelvis.points.map(({ radius }) => radius))).toBeGreaterThan(
      pelvis.points.at(-1)?.radius ?? Number.POSITIVE_INFINITY,
    );
    expect(forearm.points[0]?.radius).toBeLessThan(
      Math.max(...forearm.points.map(({ radius }) => radius)),
    );
    expect(Math.max(...lowerLeg.points.map(({ radius }) => radius))).toBeGreaterThan(
      lowerLeg.points[0]?.radius ?? Number.POSITIVE_INFINITY,
    );
    if (foot.kind !== "ellipsoid") throw new Error("Expected ellipsoid foot mass.");
    expect(foot.radii[2]).toBeGreaterThan(foot.radii[0]);
    expect(actor).toEqual(actorBefore);
  });

  it("does not infer body geometry from actor slot or label", () => {
    const scene = createDefaultScene();
    const actor = legacyActorIn(scene);
    const baseline = resolveActorProjection(scene, actor).primitives;
    actor.slot = "secondary";
    actor.label = "Different public label";

    expect(resolveActorProjection(scene, actor).primitives).toEqual(baseline);
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
    actor.pose.joints.upper_arm_r = quaternionFromEulerDegrees([17, -23, 31]);
    actor.pose.joints.forearm_r = quaternionFromEulerDegrees([-29, 11, 43]);
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
    const drawCounts = renderSceneToPng(scene, 320, 180)
      .diagnostics.actorPrimitiveDrawCounts[actor.id];
    expect(drawCounts?.torso).toBeGreaterThan(0);
    expect(drawCounts?.head).toBeGreaterThan(0);
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
