import { z } from "zod";
import { entityIdSchema, finiteNumberSchema } from "./schema-primitives";
import type { SceneSpec } from "./scene-schema";
import type { ShotIntentPlan } from "./shot-intent";

export const RENDER_SPACE_EVIDENCE_SCHEMA_VERSION = 1 as const;

const pixelBoundsSchema = z
  .object({
    minX: z.number().int().nonnegative(),
    minY: z.number().int().nonnegative(),
    maxX: z.number().int().nonnegative(),
    maxY: z.number().int().nonnegative(),
  })
  .strict()
  .refine(({ minX, minY, maxX, maxY }) => maxX >= minX && maxY >= minY, {
    message: "Render-space pixel bounds must be ordered.",
  });

const renderMetricShape = {
  visiblePixelCount: z.number().int().nonnegative(),
  isolatedPixelCount: z.number().int().nonnegative(),
  boundsPx: pixelBoundsSchema.nullable(),
  centerDepthM: finiteNumberSchema,
};

export const renderEntityEvidenceSchema = z
  .object({
    entityId: entityIdSchema,
    ...renderMetricShape,
  })
  .strict();

export const renderActorPartEvidenceSchema = z
  .object({
    actorId: entityIdSchema,
    partId: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
    ...renderMetricShape,
  })
  .strict();

export const renderSpaceEvidenceSchema = z
  .object({
    schemaVersion: z.literal(RENDER_SPACE_EVIDENCE_SCHEMA_VERSION),
    solveId: entityIdSchema,
    candidateId: entityIdSchema,
    sceneSha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(160).max(1920),
    height: z.number().int().min(90).max(1080),
    entities: z.array(renderEntityEvidenceSchema).max(256),
    actorParts: z.array(renderActorPartEvidenceSchema).max(1024),
  })
  .strict();

export type RenderSpaceEvidence = z.infer<typeof renderSpaceEvidenceSchema>;
export type RenderEntityEvidence = z.infer<typeof renderEntityEvidenceSchema>;
export type RenderActorPartEvidence = z.infer<typeof renderActorPartEvidenceSchema>;

export const renderSpaceIssueCodes = [
  "RENDER_SCENE_MISMATCH",
  "REQUIRED_ENTITY_EVIDENCE_MISSING",
  "REQUIRED_ENTITY_NOT_VISIBLE",
  "REQUIRED_ACTOR_PART_EVIDENCE_MISSING",
  "REQUIRED_ACTOR_PART_NOT_VISIBLE",
  "REQUIRED_FULL_SUBJECT_CROPPED",
  "SUBJECT_OVERLAPS_CAPTION_SAFE_AREA",
  "SUBJECT_OVERLAPS_SIDE_UI_SAFE_AREA",
  "REQUIRED_DEPTH_ORDER_INVALID",
] as const;

export type RenderSpaceIssueCode = (typeof renderSpaceIssueCodes)[number];

export interface VerifiedRenderMetric {
  visiblePixelCount: number;
  isolatedPixelCount: number;
  visibleRatio: number;
  boundsPx: RenderEntityEvidence["boundsPx"];
  centerDepthM: number;
  clipped: boolean;
}

export interface RenderSpaceIssue {
  code: RenderSpaceIssueCode;
  relatedEntityIds: string[];
  partId?: string;
  evidence?: string;
}

export interface RenderSpaceVerificationReport {
  status: "pass" | "fail";
  sceneSha256: string;
  width: number;
  height: number;
  entities: Array<VerifiedRenderMetric & { entityId: string }>;
  actorParts: Array<VerifiedRenderMetric & { actorId: string; partId: string }>;
  issues: RenderSpaceIssue[];
  scoreAdjustment: number;
}

const verifiedMetric = <Metric extends {
  visiblePixelCount: number;
  isolatedPixelCount: number;
  boundsPx: RenderEntityEvidence["boundsPx"];
  centerDepthM: number;
}>(metric: Metric, width: number, height: number): VerifiedRenderMetric => ({
  visiblePixelCount: metric.visiblePixelCount,
  isolatedPixelCount: metric.isolatedPixelCount,
  visibleRatio: metric.isolatedPixelCount === 0
    ? 0
    : Math.min(1, metric.visiblePixelCount / metric.isolatedPixelCount),
  boundsPx: metric.boundsPx,
  centerDepthM: metric.centerDepthM,
  clipped: metric.boundsPx !== null && (
    metric.boundsPx.minX === 0 ||
    metric.boundsPx.minY === 0 ||
    metric.boundsPx.maxX >= width - 1 ||
    metric.boundsPx.maxY >= height - 1
  ),
});

const overlapsCaption = (
  metric: VerifiedRenderMetric,
  height: number,
  bottomFraction: number,
): boolean =>
  metric.boundsPx !== null &&
  metric.boundsPx.maxY >= Math.floor(height * (1 - bottomFraction));

const overlapsSide = (
  metric: VerifiedRenderMetric,
  width: number,
  side: "left" | "right" | "both",
  fraction: number,
): boolean => {
  if (metric.boundsPx === null) return false;
  const left = metric.boundsPx.minX <= Math.ceil(width * fraction);
  const right = metric.boundsPx.maxX >= Math.floor(width * (1 - fraction));
  return side === "left" ? left : side === "right" ? right : left || right;
};

export const evaluateRenderSpaceEvidence = ({
  scene: _scene,
  plan,
  expectedSceneSha256,
  evidence: evidenceInput,
}: {
  scene: SceneSpec;
  plan: ShotIntentPlan;
  expectedSceneSha256: string;
  evidence: RenderSpaceEvidence;
}): RenderSpaceVerificationReport => {
  const evidence = renderSpaceEvidenceSchema.parse(evidenceInput);
  const entities = evidence.entities.map((entry) => ({
    entityId: entry.entityId,
    ...verifiedMetric(entry, evidence.width, evidence.height),
  }));
  const actorParts = evidence.actorParts.map((entry) => ({
    actorId: entry.actorId,
    partId: entry.partId,
    ...verifiedMetric(entry, evidence.width, evidence.height),
  }));
  const issues: RenderSpaceIssue[] = [];
  if (evidence.sceneSha256 !== expectedSceneSha256) {
    issues.push({
      code: "RENDER_SCENE_MISMATCH",
      relatedEntityIds: [],
    });
  }

  for (const requirement of plan.hardConstraints) {
    if (requirement.kind === "visibility") {
      const metric = entities.find(({ entityId }) => entityId === requirement.entityId);
      if (!metric) {
        issues.push({
          code: "REQUIRED_ENTITY_EVIDENCE_MISSING",
          relatedEntityIds: [requirement.entityId],
        });
        continue;
      }
      if (metric.visiblePixelCount === 0 || metric.visibleRatio < requirement.minVisibleRatio) {
        issues.push({
          code: "REQUIRED_ENTITY_NOT_VISIBLE",
          relatedEntityIds: [requirement.entityId],
          evidence: `visibleRatio=${metric.visibleRatio.toFixed(3)}`,
        });
      }
      for (const partId of requirement.requiredPartIds) {
        const part = actorParts.find(
          (candidate) => candidate.actorId === requirement.entityId && candidate.partId === partId,
        );
        if (!part) {
          issues.push({
            code: "REQUIRED_ACTOR_PART_EVIDENCE_MISSING",
            relatedEntityIds: [requirement.entityId],
            partId,
          });
        } else if (part.visiblePixelCount === 0 || part.visibleRatio < 0.15) {
          issues.push({
            code: "REQUIRED_ACTOR_PART_NOT_VISIBLE",
            relatedEntityIds: [requirement.entityId],
            partId,
            evidence: `visibleRatio=${part.visibleRatio.toFixed(3)}`,
          });
        }
      }
    } else if (requirement.kind === "framing" &&
      (requirement.mode === "full" || requirement.mode === "whole-prop")) {
      for (const entityId of requirement.targetEntityIds) {
        const metric = entities.find((candidate) => candidate.entityId === entityId);
        if (metric?.clipped) {
          issues.push({
            code: "REQUIRED_FULL_SUBJECT_CROPPED",
            relatedEntityIds: [entityId],
          });
        }
      }
    } else if (requirement.kind === "safe-area") {
      const targetIds = new Set([
        ...plan.primaryTargetIds,
        ...plan.hardConstraints.flatMap((constraint) =>
          constraint.kind === "visibility" ? [constraint.entityId] : [],
        ),
      ]);
      for (const entityId of targetIds) {
        const metric = entities.find((candidate) => candidate.entityId === entityId);
        if (!metric) continue;
        if (
          requirement.captionBottomFraction !== undefined &&
          overlapsCaption(metric, evidence.height, requirement.captionBottomFraction)
        ) {
          issues.push({
            code: "SUBJECT_OVERLAPS_CAPTION_SAFE_AREA",
            relatedEntityIds: [entityId],
          });
        }
        if (
          requirement.sideUi !== undefined &&
          overlapsSide(
            metric,
            evidence.width,
            requirement.sideUi.side,
            requirement.sideUi.widthFraction,
          )
        ) {
          issues.push({
            code: "SUBJECT_OVERLAPS_SIDE_UI_SAFE_AREA",
            relatedEntityIds: [entityId],
          });
        }
      }
    } else if (requirement.kind === "depth-ordering") {
      const foreground = entities.find(({ entityId }) => entityId === requirement.foregroundEntityId);
      const background = entities.find(({ entityId }) => entityId === requirement.backgroundEntityId);
      if (
        !foreground ||
        !background ||
        foreground.centerDepthM + requirement.minimumDepthSeparationM > background.centerDepthM
      ) {
        issues.push({
          code: "REQUIRED_DEPTH_ORDER_INVALID",
          relatedEntityIds: [requirement.foregroundEntityId, requirement.backgroundEntityId],
        });
      }
    }
  }

  const occlusionPenalty = entities.reduce(
    (sum, metric) => sum + Math.max(0, 1 - metric.visibleRatio),
    0,
  );
  return {
    status: issues.length === 0 ? "pass" : "fail",
    sceneSha256: evidence.sceneSha256,
    width: evidence.width,
    height: evidence.height,
    entities,
    actorParts,
    issues,
    scoreAdjustment: Math.round(-occlusionPenalty * 10_000) / 1_000,
  };
};
