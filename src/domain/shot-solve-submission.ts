import { z } from "zod";
import {
  validateIntentCoverage,
  validateIntentPolicy,
} from "./intent-coverage";
import { IntentSubmissionError } from "./intent-submission-error";
import { parseIntentReportInput, parseSceneSpecInput } from "./scene-migrations";
import { intentReportSchema, type IntentReport } from "./intent-report";
import { sceneSpecSchema, type SceneSpec } from "./scene-schema";
import { shotIntentPlanSchema, type ShotIntentPlan } from "./shot-intent";
import { solveSemanticShot, type ShotSolveResult } from "./shot-solver";

export const shotSolveSubmissionSchema = z
  .object({
    intentReport: intentReportSchema,
    scene: sceneSpecSchema,
    plan: shotIntentPlanSchema,
  })
  .strict();

export interface ShotSolveSubmission {
  intentReport: IntentReport;
  scene: SceneSpec;
  plan: ShotIntentPlan;
}

const validatePlanCoverage = (
  report: IntentReport,
  plan: ShotIntentPlan,
): void => {
  const recognized = new Set(report.recognizedConstraints.map(({ id }) => id));
  if (plan.hardConstraints.some(({ id }) => !recognized.has(id))) {
    throw new IntentSubmissionError("INTENT_COVERAGE_INCOMPLETE");
  }
};

export const parseShotSolveSubmission = (
  input: unknown,
): ShotSolveSubmission => {
  const envelope = shotSolveSubmissionSchema.parse(input);
  let intentReport: IntentReport;
  try {
    intentReport = parseIntentReportInput(envelope.intentReport);
  } catch {
    throw new IntentSubmissionError("INTENT_REPORT_INVALID");
  }
  const scene = parseSceneSpecInput(envelope.scene);
  const plan = shotIntentPlanSchema.parse(envelope.plan);
  if (intentReport.operation !== plan.operation) {
    throw new IntentSubmissionError("INTENT_REPORT_INVALID");
  }
  validateIntentPolicy(intentReport, plan.operation);
  validatePlanCoverage(intentReport, plan);
  return { intentReport, scene, plan };
};

export const solveShotSubmission = (input: unknown): {
  submission: ShotSolveSubmission;
  result: ShotSolveResult;
} => {
  const submission = parseShotSolveSubmission(input);
  const result = solveSemanticShot(submission.scene, submission.plan);
  for (const candidate of result.candidates) {
    validateIntentCoverage(submission.intentReport, { after: candidate.scene });
  }
  return { submission, result };
};
