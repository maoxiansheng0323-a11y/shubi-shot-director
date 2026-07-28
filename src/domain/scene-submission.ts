import { z } from "zod";
import {
  INTENT_ISSUE_CODES_V3,
  INTENT_WARNING_CODES_V3,
  intentReportSchema,
  type IntentReport,
} from "./intent-report";
import {
  validateIntentCoverage,
  validateIntentPolicy,
} from "./intent-coverage";
import { IntentSubmissionError } from "./intent-submission-error";
import {
  parseScenePatchInput,
  parseSceneSpecInput,
  parseIntentReportInput,
} from "./scene-migrations";
import { scenePatchSchema } from "./scene-patch";
import { sceneSpecSchema } from "./scene-schema";

export { IntentSubmissionError };
export type { IntentSubmissionErrorCode } from "./intent-submission-error";

export const sceneSubmissionSchema = z
  .object({
    intentReport: intentReportSchema,
    scene: sceneSpecSchema,
  })
  .strict();

export const patchSubmissionSchema = z
  .object({
    intentReport: intentReportSchema,
    patch: scenePatchSchema,
  })
  .strict();

export type SceneSubmission = z.infer<typeof sceneSubmissionSchema>;
export type PatchSubmission = z.infer<typeof patchSubmissionSchema>;

export const intentSummarySchema = z
  .object({
    operation: z.enum(["create", "modify"]),
    allowPartial: z.boolean(),
    recognizedConstraintCount: z.number().int().nonnegative(),
    unsupportedConstraintCount: z.number().int().nonnegative(),
    unresolvedRelationCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    unsupportedConstraintCodes: z.array(z.enum(INTENT_ISSUE_CODES_V3)),
    unresolvedRelationCodes: z.array(z.enum(INTENT_ISSUE_CODES_V3)),
    warningCodes: z.array(z.enum(INTENT_WARNING_CODES_V3)),
  })
  .strict();

export type IntentSummary = z.infer<typeof intentSummarySchema>;
export type IntentIssueCode = IntentSummary[
  "unsupportedConstraintCodes"
][number];
export type IntentWarningCode = IntentSummary["warningCodes"][number];

const uniqueCodes = <Code extends string>(
  entries: ReadonlyArray<{ code: Code }>,
): Code[] => [...new Set(entries.map(({ code }) => code))];

export const summarizeIntentReport = (
  report: IntentReport,
): IntentSummary => ({
  operation: report.operation,
  allowPartial: report.allowPartial,
  recognizedConstraintCount: report.recognizedConstraints.length,
  unsupportedConstraintCount: report.unsupportedConstraints.length,
  unresolvedRelationCount: report.unresolvedRelations.length,
  warningCount: report.warnings.length,
  unsupportedConstraintCodes: uniqueCodes(report.unsupportedConstraints),
  unresolvedRelationCodes: uniqueCodes(report.unresolvedRelations),
  warningCodes: uniqueCodes(report.warnings),
});

const sceneSubmissionEnvelopeSchema = z
  .object({
    intentReport: z.unknown(),
    scene: z.unknown(),
  })
  .strict();

const patchSubmissionEnvelopeSchema = z
  .object({
    intentReport: z.unknown(),
    patch: z.unknown(),
  })
  .strict();

const parseIntentReport = (input: unknown): IntentReport => {
  try {
    return parseIntentReportInput(input);
  } catch {
    throw new IntentSubmissionError("INTENT_REPORT_INVALID");
  }
};

const validateSubmissionPolicy = (
  report: IntentReport,
  operation: IntentReport["operation"],
): void => validateIntentPolicy(report, operation);

export const parseSceneSubmission = (input: unknown): SceneSubmission => {
  const submission = normalizeSceneSubmissionInput(input);
  validateSubmissionPolicy(submission.intentReport, "create");
  validateIntentCoverage(submission.intentReport, {
    after: submission.scene,
  });
  return submission;
};

export const normalizeSceneSubmissionInput = (
  input: unknown,
): SceneSubmission => {
  const envelope = sceneSubmissionEnvelopeSchema.parse(input);
  const intentReport = parseIntentReport(envelope.intentReport);
  const scene = parseSceneSpecInput(envelope.scene);
  return { intentReport, scene };
};

export const parsePatchSubmission = (input: unknown): PatchSubmission => {
  const submission = normalizePatchSubmissionInput(input);
  validateSubmissionPolicy(submission.intentReport, "modify");
  return submission;
};

export const normalizePatchSubmissionInput = (
  input: unknown,
): PatchSubmission => {
  const envelope = patchSubmissionEnvelopeSchema.parse(input);
  const intentReport = parseIntentReport(envelope.intentReport);
  const patch = parseScenePatchInput(envelope.patch);
  return { intentReport, patch };
};
