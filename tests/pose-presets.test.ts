import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  canonicalHumanoidJointIds,
  listPosePresets,
  materializePose,
  PosePresetError,
} from "../src/domain/presets/pose-presets";
import { poseSchema, type ActorEntity } from "../src/domain/scene-schema";

const defaultActor = (): ActorEntity => {
  const actor = createDefaultScene().entities.find(
    (entity) => entity.kind === "actor",
  );
  if (!actor || actor.kind !== "actor") {
    throw new Error("Test scene requires an actor.");
  }
  return actor;
};

describe("pose presets", () => {
  it("lists the first five generic humanoid poses", () => {
    expect(listPosePresets().map((preset) => preset.id)).toEqual([
      "pose.standing-neutral-v1",
      "pose.kneeling-lean-v1",
      "pose.seated-v1",
      "pose.lying-supine-v1",
      "pose.leaning-forward-v1",
    ]);
  });

  it.each([
    "standing-neutral",
    "kneeling-lean",
    "seated",
    "lying-supine",
    "leaning-forward",
  ])("materializes schema-valid normalized joint data for %s", (presetId) => {
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
