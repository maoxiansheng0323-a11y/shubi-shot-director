import path from "node:path";
import { describe, expect, it } from "vitest";

const identityModulePath =
  "../.agents/skills/shubi-shot-director/scripts/workspace-identity.mjs";

const loadIdentityModule = async () => {
  try {
    return await import(identityModulePath);
  } catch {
    return undefined;
  }
};

describe("Skill workspace identity", () => {
  it("derives a stable opaque ID without retaining the thread ID", async () => {
    const identity = await loadIdentityModule();
    expect(identity).toBeDefined();
    if (!identity) return;

    const source = "019fa111-1111-7111-8111-111111111111";
    const first = identity.deriveThreadWorkspaceId(source);
    const second = identity.deriveThreadWorkspaceId(source);

    expect(first).toBe(second);
    expect(first).toMatch(/^workspace_[0-9a-f]{32}$/u);
    expect(first).not.toContain(source);
  });

  it("separates two thread identities", async () => {
    const identity = await loadIdentityModule();
    expect(identity).toBeDefined();
    if (!identity) return;

    expect(
      identity.deriveThreadWorkspaceId(
        "019fa111-1111-7111-8111-111111111111",
      ),
    ).not.toBe(
      identity.deriveThreadWorkspaceId(
        "019fa222-2222-7222-8222-222222222222",
      ),
    );
  });

  it("rejects a malformed thread identity instead of using it", async () => {
    const identity = await loadIdentityModule();
    expect(identity).toBeDefined();
    if (!identity) return;

    expect(identity.deriveThreadWorkspaceId("../private-scene")).toBeUndefined();
  });

  it("accepts only canonical workspace IDs", async () => {
    const identity = await loadIdentityModule();
    expect(identity).toBeDefined();
    if (!identity) return;

    expect(
      identity.isWorkspaceId(
        "workspace_0123456789abcdef0123456789abcdef",
      ),
    ).toBe(true);
    expect(identity.isWorkspaceId("../workspace_escape")).toBe(false);
    expect(identity.isWorkspaceId("workspace_ABCDEF")).toBe(false);
  });

  it("constructs every path below the fixed routing root", async () => {
    const identity = await loadIdentityModule();
    expect(identity).toBeDefined();
    if (!identity) return;

    const routingRoot = path.resolve(
      ".shubi-shot/workspace-routing",
    );
    const workspaceId =
      "workspace_0123456789abcdef0123456789abcdef";
    const paths = identity.resolveWorkspacePaths(
      routingRoot,
      workspaceId,
    );

    for (const value of Object.values(paths) as string[]) {
      expect(path.relative(routingRoot, value)).not.toMatch(
        /^(?:\.\.(?:[\\/]|$)|[\\/])/u,
      );
    }
    expect(paths.runtimeDirectory).toBe(
      path.join(
        routingRoot,
        "workspaces",
        workspaceId,
        "runtime",
      ),
    );
  });
});
