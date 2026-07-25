export type IntentSubmissionErrorCode =
  | "INTENT_REPORT_INVALID"
  | "UNSUPPORTED_DESCRIPTION"
  | "INTENT_COVERAGE_INCOMPLETE";

const ERROR_MESSAGES: Record<IntentSubmissionErrorCode, string> = {
  INTENT_REPORT_INVALID: "Intent report is invalid.",
  UNSUPPORTED_DESCRIPTION:
    "The structured description cannot be applied safely.",
  INTENT_COVERAGE_INCOMPLETE: "Intent coverage is incomplete.",
};

export class IntentSubmissionError extends Error {
  constructor(readonly code: IntentSubmissionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "IntentSubmissionError";
  }
}
