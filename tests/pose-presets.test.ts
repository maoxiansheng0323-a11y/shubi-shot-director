import { describe, expect, it } from "vitest";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { actorStatureHeightM } from "../src/domain/actor-stature";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  canonicalHumanoidJointIds,
  listPosePresets,
  materializePose,
  PosePresetError,
} from "../src/domain/presets/pose-presets";
import {
  isBlueprintActorEntity,
  poseSchema,
  sceneSpecSchema,
  type ActorEntity,
  type BlueprintActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const expectedPoseIds = [
  "pose.standing-neutral-v1",
  "pose.kneeling-lean-v1",
  "pose.seated-v1",
  "pose.lying-supine-v1",
  "pose.leaning-forward-v1",
  "pose.reaching-right-v1",
  "pose.walking-step-v1",
  "pose.crouching-v1",
] as const;

const defaultActor = (): ActorEntity => {
  const actor = createDefaultScene().entities.find(
    (entity) => entity.kind === "actor",
  );
  if (!actor || actor.kind !== "actor") {
    throw new Error("Test scene requires an actor.");
  }
  return actor;
};

const blueprintFixture = (): {
  scene: SceneSpec;
  actor: BlueprintActorEntity;
} => {
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  scene.entities = scene.entities.filter((entity) => entity.kind !== "actor");
  scene.constraints = [];
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(createGenericActorBlueprintDocument()),
  ];
  scene.entities.push(createBlueprintActor({ variantId: "repaired" }));
  const parsed = sceneSpecSchema.parse(scene);
  const actor = parsed.entities.find(isBlueprintActorEntity);
  if (!actor) throw new Error("Blueprint actor fixture is missing.");
  return { scene: parsed, actor };
};

describe("pose presets", () => {
  it("lists all eight generic humanoid actions", () => {
    expect(listPosePresets().map((preset) => preset.id)).toEqual(
      expectedPoseIds,
    );
  });

  it.each(expectedPoseIds)(
    "materializes complete normalized legacy joint data for %s",
    (presetId) => {
    const actor = defaultActor();
    const pose = materializePose(actor, presetId);

    expect(() => poseSchema.parse(pose)).not.toThrow();
    expect(Object.keys(pose.joints).sort()).toEqual(
      [...canonicalHumanoidJointIds].sort(),
    );
    for (const rotation of Object.values(pose.joints)) {
      expect(Math.hypot(...rotation)).toBeCloseTo(1, 6);
    }
    expect(pose.preset.parameters.contactOffsetM).toEqual(
      expect.any(Number),
    );
    expect(pose.preset.parameters.contactOffsetM).toBeGreaterThan(0);
    },
  );

  it.each(expectedPoseIds)(
    "materializes complete normalized Blueprint joint data for %s",
    (presetId) => {
      const { scene, actor } = blueprintFixture();
      const pose = materializePose(
        actor,
        presetId,
        actorStatureHeightM(scene, actor),
      );

      expect(() => poseSchema.parse(pose)).not.toThrow();
      expect(Object.keys(pose.joints).sort()).toEqual(
        [...canonicalHumanoidJointIds].sort(),
      );
      for (const rotation of Object.values(pose.joints)) {
        expect(Math.hypot(...rotation)).toBeCloseTo(1, 6);
      }
    },
  );

  it("gives reach, walking, and crouch distinct terminal-joint action data", () => {
    const actor = defaultActor();
    const identity = [0, 0, 0, 1];
    const reach = materializePose(actor, "pose.reaching-right-v1");
    const walking = materializePose(actor, "pose.walking-step-v1");
    const crouching = materializePose(actor, "pose.crouching-v1");

    expect(reach.joints.upper_arm_r).not.toEqual(identity);
    expect(reach.joints.forearm_r).not.toEqual(identity);
    expect(reach.joints.hand_r).not.toEqual(identity);
    expect(walking.joints.upper_leg_l).not.toEqual(identity);
    expect(walking.joints.lower_leg_r).not.toEqual(identity);
    expect(walking.joints.foot_r).not.toEqual(identity);
    expect(crouching.joints.upper_leg_l).not.toEqual(identity);
    expect(crouching.joints.lower_leg_l).not.toEqual(identity);
    expect(crouching.joints.foot_l).not.toEqual(identity);
  });

  it("stores an unscaled local contact offset without mutating the actor", () => {
    const actor = defaultActor();
    actor.transform.scale = [1, 1.25, 1];
    const before = structuredClone(actor);

    const pose = materializePose(actor, "pose.standing-neutral-v1");

    expect(pose.preset.parameters.contactOffsetM).toBeCloseTo(
      actor.body.heightM * 0.568,
      5,
    );
    expect(actor).toEqual(before);

    pose.joints.spine[0] = 0.25;
    const nextPose = materializePose(
      actor,
      "pose.standing-neutral-v1",
    );
    expect(nextPose.joints.spine[0]).toBe(0);
  });

  it("uses a stable sanitized error for an unknown pose", () => {
    expect.assertions(3);
    try {
      materializePose(defaultActor(), "untrusted-description");
    } catch (error) {
      expect(error).toBeInstanceOf(PosePresetError);
      expect((error as PosePresetError).code).toBe(
        "POSE_PRESET_NOT_FOUND",
      );
      expect((error as Error).message).toBe(
        "The requested pose preset is not available.",
      );
    }
  });
});
