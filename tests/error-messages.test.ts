import { describe, expect, it } from "vitest";
import { userFacingError } from "../src/editor/error-messages";
import { SceneClientError } from "../src/editor/scene-client";

describe("userFacingError", () => {
  it("maps stable domain codes to actionable Chinese copy", () => {
    const result = userFacingError(
      new SceneClientError(
        "STALE_REVISION",
        "Internal stale revision wording.",
      ),
    );

    expect(result).toContain("最新 revision");
    expect(result).toContain("STALE_REVISION");
    expect(result).not.toContain("Internal stale revision wording");
  });

  it("keeps a safe unknown message and appends its stable code", () => {
    const error = Object.assign(new Error("Exporter unavailable."), {
      code: "EXPORTER_UNAVAILABLE",
    });

    expect(userFacingError(error)).toBe(
      "Exporter unavailable. · EXPORTER_UNAVAILABLE",
    );
  });
});
