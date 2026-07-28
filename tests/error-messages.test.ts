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

  it.each([
    [
      "USER_LOCKED",
      "目标受到用户保护，需要先确认解锁",
    ],
    [
      "WORKFLOW_LOCKED",
      "目标处于流程锁定，请使用保留锁定的修改",
    ],
    [
      "LOCK_PRESERVATION_CONFLICT",
      "修改会改变应保留的锁定状态，未执行修改",
    ],
    [
      "ACTOR_LIMB_TARGET_INVALID",
      "目标不是可编辑的人偶，未执行肢体修改",
    ],
    [
      "LIMB_HIERARCHY_CONFLICT",
      "同一次修改中的肢体上下游状态互相冲突，未执行修改",
    ],
  ])("maps %s to the exact domain guidance", (code, message) => {
    expect(
      userFacingError(new SceneClientError(code, "Internal wording.")),
    ).toBe(`${message} · ${code}`);
  });
});
