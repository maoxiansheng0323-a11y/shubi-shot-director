import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { evaluateRenderSpaceEvidence } from "../src/domain/render-space-verification";
import { shotIntentPlanSchema } from "../src/domain/shot-intent";

const plan = shotIntentPlanSchema.parse({
  schemaVersion: 1 as const,
  planId: "plan_render_verify_1",
  operation: "create",
  cameraId: "camera_shot_1",
  primaryTargetIds: ["actor_generic_1"],
  hardConstraints: [
    {
      id: "visibility_actor_head_1",
      kind: "visibility",
      entityId: "actor_generic_1",
      anchor: "face",
      requiredPartIds: ["head"],
      minVisibleRatio: 0.6,
    },
    {
      id: "framing_actor_full_1",
      kind: "framing",
      mode: "full",
      targetEntityIds: ["actor_generic_1"],
    },
  ],
  softPreferences: [],
  candidateCount: 3,
});

const evidence = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const,
  solveId: "solve_render_verify_1",
  candidateId: "candidate_a",
  sceneSha256: "a".repeat(64),
  width: 320,
  height: 180,
  entities: [
    {
      entityId: "actor_generic_1",
      visiblePixelCount: 900,
      isolatedPixelCount: 1_000,
      boundsPx: { minX: 80, minY: 8, maxX: 240, maxY: 170 },
      centerDepthM: 3,
    },
  ],
  actorParts: [
    {
      actorId: "actor_generic_1",
      partId: "head",
      visiblePixelCount: 90,
      isolatedPixelCount: 100,
      boundsPx: { minX: 140, minY: 8, maxX: 180, maxY: 42 },
      centerDepthM: 3,
    },
  ],
  ...overrides,
});

describe("renderer-derived shot verification", () => {
  it("passes actual ID-mask visibility, actor-part visibility, and uncropped framing", () => {
    const report = evaluateRenderSpaceEvidence({
      scene: createDefaultScene(),
      plan,
      expectedSceneSha256: "a".repeat(64),
      evidence: evidence(),
    });
    expect(report.status).toBe("pass");
    expect(report.entities[0].visibleRatio).toBe(0.9);
    expect(report.actorParts[0].visibleRatio).toBe(0.9);
    expect(report.issues).toEqual([]);
  });

  it("fails a required part hidden by actual rendered occlusion", () => {
    const report = evaluateRenderSpaceEvidence({
      scene: createDefaultScene(),
      plan,
      expectedSceneSha256: "a".repeat(64),
      evidence: evidence({
        actorParts: [
          {
            actorId: "actor_generic_1",
            partId: "head",
            visiblePixelCount: 5,
            isolatedPixelCount: 100,
            boundsPx: { minX: 140, minY: 8, maxX: 145, maxY: 12 },
            centerDepthM: 3,
          },
        ],
      }),
    });
    expect(report.status).toBe("fail");
    expect(report.issues.map(({ code }) => code)).toContain(
      "REQUIRED_ACTOR_PART_NOT_VISIBLE",
    );
  });

  it("uses actual screen bounds to reject caption-safe overlap", () => {
    const safePlan = shotIntentPlanSchema.parse({
      ...plan,
      hardConstraints: [
        ...plan.hardConstraints,
        {
          id: "safe_caption_1",
          kind: "safe-area",
          captionBottomFraction: 0.2,
        },
      ],
    });
    const report = evaluateRenderSpaceEvidence({
      scene: createDefaultScene(),
      plan: safePlan,
      expectedSceneSha256: "a".repeat(64),
      evidence: evidence(),
    });
    expect(report.status).toBe("fail");
    expect(report.issues.map(({ code }) => code)).toContain(
      "SUBJECT_OVERLAPS_CAPTION_SAFE_AREA",
    );
  });
});
