import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveViteCacheDirectory } from "../server/runtime";

describe("development server Vite cache isolation", () => {
  it("uses a process-unique temporary cache outside authoritative runtime state", () => {
    const temporaryRoot = path.join(os.tmpdir(), "shubi-shot-cache-test");
    const instanceA = `instance_${"a".repeat(32)}`;
    const instanceB = `instance_${"b".repeat(32)}`;

    const cacheA = resolveViteCacheDirectory(instanceA, temporaryRoot);
    const cacheB = resolveViteCacheDirectory(instanceB, temporaryRoot);

    expect(cacheA).toBe(
      path.join(temporaryRoot, "shubi-shot-vite-cache", instanceA),
    );
    expect(cacheB).not.toBe(cacheA);
    const authoritativeRuntime = path.join(
      temporaryRoot,
      "workspace-a",
      "runtime",
    );
    expect(path.relative(authoritativeRuntime, cacheA).startsWith("..")).toBe(
      true,
    );
  });

  it("rejects an invalid instance ID before constructing a cache path", () => {
    expect(() =>
      resolveViteCacheDirectory("../shared", os.tmpdir()),
    ).toThrow("The bridge instance ID is invalid.");
  });
});
