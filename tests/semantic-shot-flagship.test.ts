import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rotateVector } from "../src/domain/scene-math";
import { solveShotSubmission } from "../src/domain/shot-solve-submission";
import { createFlagshipShotSubmission } from "./helpers/semantic-shot-fixtures";

describe("v1 semantic shot flagship black box", () => {
  it("keeps the public flagship submission executable", () => {
    const input = JSON.parse(readFileSync(
      new URL("../examples/semantic-shot-flagship.shot-submission.json", import.meta.url),
      "utf8",
    )) as unknown;
    expect(solveShotSubmission(input).result.candidates).toHaveLength(3);
  }, 15_000);

  it("solves a generic partial-limb ground-resting shot into three usable candidates", () => {
    const submission = createFlagshipShotSubmission();
    const { result } = solveShotSubmission(submission);

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map(({ profile }) => profile).sort()).toEqual([
      "balanced",
      "dramatic-low",
      "environmental",
    ]);
    expect(JSON.stringify(submission.plan)).not.toMatch(/joints|quaternion|positionM|rotation/);

    for (const candidate of result.candidates) {
      expect(candidate.worldDiagnostics.pose.status).toBe("pass");
      expect(candidate.composition.issues.filter(({ severity }) => severity === "error")).toEqual([]);
      const actor = candidate.scene.entities.find((entity) => entity.id === "actor_generic_1");
      const support = candidate.scene.entities.find((entity) => entity.id === "prop_back_support_1");
      if (!actor || actor.kind !== "actor" || !support) throw new Error("missing solved fixtures");
      if (!("body" in actor)) throw new Error("expected a legacy flagship actor");
      expect(actor.body.limbPresence).toMatchObject({
        upper_arm_l: "absent",
        forearm_l: "absent",
        hand_l: "absent",
      });
      const actorForward = rotateVector([0, 0, 1], actor.transform.rotation);
      const actorToSupport = support.transform.positionM.map(
        (value, index) => value - actor.transform.positionM[index],
      );
      const behindDot = actorForward.reduce(
        (sum, value, index) => sum + value * actorToSupport[index],
        0,
      );
      expect(behindDot).toBeLessThan(0);
      expect(candidate.metrics.targetCenterNdc[0]).toBeGreaterThan(0.15);
      expect(candidate.worldDiagnostics.pose.contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          constraintId: "contact_flagship_pelvis_ground_1",
          bodySite: "pelvis",
          status: "pass",
        }),
        expect.objectContaining({
          constraintId: "contact_flagship_upper_back_support_1",
          bodySite: "upper-back",
          status: "pass",
        }),
      ]));
      expect(candidate.worldDiagnostics.pose.relaxedLimbs).toContainEqual(
        expect.objectContaining({
          constraintId: "relaxed_flagship_arm_r_ground_1",
          limb: "arm-r",
          mode: "surface-resting",
          status: "pass",
        }),
      );
    }
  }, 15_000);

  it("continues to reject a side-on upper-back contact", () => {
    expect(() => solveShotSubmission(createFlagshipShotSubmission(true))).toThrow();
  });
});
