import {
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const registryModulePath =
  "../.agents/skills/shubi-shot-director/scripts/workspace-registry.mjs";

const loadRegistryModule = async () => {
  try {
    return await import(registryModulePath);
  } catch {
    return undefined;
  }
};

const workspaceA =
  "workspace_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const workspaceB =
  "workspace_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const availableDependencies = (portStart: number) => ({
  portStart,
  portEnd: portStart + 10,
  probePort: async () => false,
  probeHealth: async () => null,
});

describe("Skill workspace registry", () => {
  it("allocates distinct routes under concurrent ensure calls", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-workspaces-"),
    );
    const dependencies = availableDependencies(51000);

    const [left, right] = await Promise.all([
      registry.ensureWorkspaceRoute({
        routingRoot,
        workspaceId: workspaceA,
        dependencies,
      }),
      registry.ensureWorkspaceRoute({
        routingRoot,
        workspaceId: workspaceB,
        dependencies,
      }),
    ]);

    expect(left.port).not.toBe(right.port);
    expect(left.runtimeDirectory).not.toBe(
      right.runtimeDirectory,
    );
  });

  it("reuses a reserved route for the same workspace", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-reuse-"),
    );
    const dependencies = availableDependencies(51100);
    const first = await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies,
    });
    const second = await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies,
    });

    expect(second).toEqual(first);
  });

  it("reattaches one hashed thread binding without copying scene data", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-bindings-"),
    );
    await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies: availableDependencies(51200),
    });

    await registry.attachWorkspace({
      routingRoot,
      threadWorkspaceId: workspaceB,
      targetWorkspaceId: workspaceA,
    });

    expect(
      await registry.readThreadBinding(
        routingRoot,
        workspaceB,
      ),
    ).toBe(workspaceA);
  });

  it("lists generic routing data without raw thread identifiers", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-list-"),
    );
    await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies: availableDependencies(51300),
    });
    const listed = await registry.listWorkspaces({
      routingRoot,
      probeHealth: async () => null,
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      workspaceId: workspaceA,
      port: 51300,
      status: "starting",
    });
    expect(JSON.stringify(listed)).not.toContain(
      "CODEX_THREAD_ID",
    );
  });

  it("does not probe or revive a stopped workspace after its port is reused", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-list-stopped-"),
    );
    await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies: availableDependencies(51320),
    });
    await registry.updateWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      status: "ready",
      instanceId:
        "instance_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await registry.updateWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      status: "stopped",
    });
    const probedPorts: number[] = [];

    const listed = await registry.listWorkspaces({
      routingRoot,
      probeHealth: async (port: number) => {
        probedPorts.push(port);
        return {
          sceneId: "scene_from_reused_port",
          revision: 9,
          uiUrl: `http://127.0.0.1:${port}`,
          instanceId:
            "instance_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        };
      },
    });

    expect(probedPorts).toEqual([]);
    expect(listed).toEqual([
      expect.objectContaining({
        workspaceId: workspaceA,
        port: 51320,
        status: "stopped",
      }),
    ]);
    expect(listed[0]).not.toHaveProperty("sceneId");
    expect(listed[0]).not.toHaveProperty("instanceId");
  });

  it("accepts live health only from the descriptor's exact bridge instance", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-list-instance-"),
    );
    await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      dependencies: availableDependencies(51340),
    });
    await registry.updateWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      status: "ready",
      instanceId:
        "instance_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const mismatched = await registry.listWorkspaces({
      routingRoot,
      probeHealth: async () => ({
        sceneId: "scene_from_other_workspace",
        revision: 4,
        uiUrl: "http://127.0.0.1:51340",
        instanceId:
          "instance_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    });
    const unavailable = await registry.listWorkspaces({
      routingRoot,
      probeHealth: async () => null,
    });
    const wrongUrl = await registry.listWorkspaces({
      routingRoot,
      probeHealth: async () => ({
        sceneId: "scene_from_wrong_url",
        revision: 6,
        uiUrl: "http://127.0.0.1:51341",
        instanceId:
          "instance_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    });
    const matching = await registry.listWorkspaces({
      routingRoot,
      probeHealth: async () => ({
        sceneId: "scene_owned_by_workspace_a",
        revision: 5,
        uiUrl: "http://127.0.0.1:51340",
        instanceId:
          "instance_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    });

    for (const listed of [mismatched, unavailable, wrongUrl]) {
      expect(listed).toEqual([
        expect.objectContaining({
          workspaceId: workspaceA,
          port: 51340,
          status: "stopped",
        }),
      ]);
      expect(listed[0]).not.toHaveProperty("sceneId");
      expect(listed[0]).not.toHaveProperty("instanceId");
    }
    expect(matching).toEqual([
      expect.objectContaining({
        workspaceId: workspaceA,
        port: 51340,
        status: "ready",
        sceneId: "scene_owned_by_workspace_a",
        revision: 5,
        instanceId:
          "instance_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ]);
  });

  it("never rewrites an existing legacy scene during adoption", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const root = await mkdtemp(
      path.join(os.tmpdir(), "shubi-legacy-"),
    );
    const routingRoot = path.join(root, "workspace-routing");
    const legacyScene = path.join(root, "current.scene.json");
    await writeFile(
      legacyScene,
      '{"sceneId":"legacy"}\n',
      "utf8",
    );

    const route = await registry.ensureWorkspaceRoute({
      routingRoot,
      workspaceId: workspaceA,
      legacyRuntimeDirectory: root,
      dependencies: availableDependencies(51400),
    });

    expect(route.runtimeDirectory).toBe(root);
    expect(await readFile(legacyScene, "utf8")).toBe(
      '{"sceneId":"legacy"}\n',
    );
  });

  it("rejects attaching to an unknown workspace", async () => {
    const registry = await loadRegistryModule();
    expect(registry).toBeDefined();
    if (!registry) return;

    const routingRoot = await mkdtemp(
      path.join(os.tmpdir(), "shubi-unknown-"),
    );

    await expect(
      registry.attachWorkspace({
        routingRoot,
        threadWorkspaceId: workspaceA,
        targetWorkspaceId: workspaceB,
      }),
    ).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });
  });
});
