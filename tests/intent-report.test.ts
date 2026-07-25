import { describe, expect, it } from "vitest";
import {
  intentReportSchema,
  type IntentReport,
} from "../src/domain/intent-report";
import { createIntentReport } from "./helpers/structured-fixtures";

describe("IntentReport schema", () => {
  it("parses a strict generic create report", () => {
    const report: IntentReport = createIntentReport();

    expect(intentReportSchema.parse(report)).toEqual(report);
  });

  it.each(["rawPrompt", "profilePath", "aliases"])(
    "rejects forbidden top-level key %s",
    (key) => {
      const report = { ...createIntentReport(), [key]: "marker_secret_value" };

      expect(intentReportSchema.safeParse(report).success).toBe(false);
    },
  );

  it("rejects free-form message fields in nested issue and warning objects", () => {
    const report = createIntentReport({
      operation: "modify",
      allowPartial: true,
      unsupportedConstraints: [
        {
          code: "UNSUPPORTED_CONSTRAINT",
          targetIds: ["actor_generic_1"],
          message: "marker_secret_value",
        } as never,
      ],
      warnings: [
        {
          code: "PARTIAL_APPLICATION",
          targetIds: ["actor_generic_1"],
          message: "marker_secret_value",
        } as never,
      ],
    });

    expect(intentReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects unknown constraint kinds, issue codes, warning codes, and evidence paths", () => {
    const invalidValues = [
      createIntentReport({
        recognizedConstraints: [
          {
            ...createIntentReport().recognizedConstraints[0],
            kind: "marker_secret_value",
          } as never,
        ],
      }),
      createIntentReport({
        operation: "modify",
        allowPartial: true,
        unsupportedConstraints: [
          { code: "MARKER_SECRET_VALUE", targetIds: [] } as never,
        ],
      }),
      createIntentReport({
        warnings: [{ code: "MARKER_SECRET_VALUE", targetIds: [] } as never],
      }),
      createIntentReport({
        recognizedConstraints: [
          {
            ...createIntentReport().recognizedConstraints[0],
            evidence: [
              {
                type: "entity-property",
                entityId: "camera_shot_1",
                path: "marker.secret.value",
              },
            ],
          } as never,
        ],
      }),
    ];

    for (const invalid of invalidValues) {
      expect(intentReportSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts every initial constraint kind", () => {
    const kinds = [
      "environment",
      "entity-presence",
      "entity-removal",
      "actor-slot",
      "pose",
      "relationship",
      "contact",
      "position",
      "rotation",
      "scale",
      "visibility",
      "camera-height",
      "camera-angle",
      "camera-target",
      "focal-length",
      "framing",
      "output",
      "composition-safety",
    ] as const;

    for (const kind of kinds) {
      const report = createIntentReport({
        recognizedConstraints: [
          {
            id: `intent_${kind.replaceAll("-", "_")}_1`,
            kind,
            required: false,
            targets: [],
            evidence: [],
          },
        ],
      });
      expect(intentReportSchema.safeParse(report).success).toBe(true);
    }
  });
});
