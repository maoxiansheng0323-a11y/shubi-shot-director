import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import type { SceneSpec } from "../src/domain/scene-schema";
import {
  createPatchSubmission,
  createSceneSubmission,
} from "./helpers/structured-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const skillWrapper = path.join(
  repositoryRoot,
  ".agents",
  "skills",
  "shubi-shot-director",
  "scripts",
  "director.mjs",
);
const runtimeWrapper = path.join(
  repositoryRoot,
  "scripts",
  "director.mjs",
);
const testArtifactRoot = path.join(
  repositoryRoot,
  ".shubi-shot",
  "parallel-workspace-e2e",
);
const osEnvironmentKeys = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
] as const;

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface JsonEnvelope<T> {
  ok: true;
  data: T;
}

interface EnsureData {
  uiUrl: string;
  instanceId: string;
  sceneId: string;
  revision: number;
}

interface WorkspaceData {
  workspaceId: string;
  source: "thread" | "binding";
  port: number;
  status: "starting" | "ready" | "stopped";
  legacy: boolean;
  uiUrl: string;
}

interface SnapshotData {
  scene: SceneSpec;
  history: {
    canUndo: boolean;
    canRedo: boolean;
  };
}

interface WorkspaceIdentityModule {
  deriveThreadWorkspaceId(threadId: string): string | undefined;
  resolveWorkspacePaths(
    routingRoot: string,
    workspaceId: string,
  ): {
    workspaceDirectory: string;
    descriptorFile: string;
    runtimeDirectory: string;
  };
}

const loadWorkspaceIdentity =
  async (): Promise<WorkspaceIdentityModule> =>
    import(
      /* @vite-ignore */ new URL(
        "../.agents/skills/shubi-shot-director/scripts/workspace-identity.mjs",
        import.meta.url,
      ).href
    ) as Promise<WorkspaceIdentityModule>;

const ownedWorkspaces: Array<{
  environment: NodeJS.ProcessEnv;
  workspaceId: string;
  routingRoot: string;
}> = [];
const ownedArtifactDirectories: string[] = [];
const ownedRuntimeRoots: string[] = [];
const observedStreams: string[] = [];

const createIsolatedRuntimeRoot = async (): Promise<string> => {
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "shubi-shot-parallel-runtime-"),
  );
  ownedRuntimeRoots.push(runtimeRoot);
  await mkdir(path.join(runtimeRoot, "scripts"), {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      path.join(runtimeRoot, "package.json"),
      JSON.stringify({
        name: "shubi-shot-director",
        private: true,
        version: "0.5.0",
      }),
      "utf8",
    ),
    writeFile(
      path.join(runtimeRoot, "scripts", "director.mjs"),
      `import ${JSON.stringify(pathToFileURL(runtimeWrapper).href)};\n`,
      "utf8",
    ),
  ]);
  return runtimeRoot;
};

const createMinimalEnvironment = (
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of osEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return {
    ...environment,
    SHUBI_SHOT_RUNTIME_ROOT: repositoryRoot,
    ...overrides,
  };
};

const runProcess = (
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [skillWrapper, ...args], {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The parallel workspace command timed out."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });

const runSkill = async <T>(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<JsonEnvelope<T>> => {
  const result = await runProcess(args, environment);
  return parseSkillResult(args, result);
};

const parseSkillResult = <T>(
  args: string[],
  result: ProcessResult,
): JsonEnvelope<T> => {
  observedStreams.push(result.stdout, result.stderr);
  expect(
    result,
    `Skill command failed: ${JSON.stringify({ args, result })}`,
  ).toMatchObject({
    exitCode: 0,
    signal: null,
    stderr: "",
  });
  const lines = result.stdout.split(/\r?\n/u);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  const envelope = JSON.parse(lines[0] ?? "") as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope;
};

const collectFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(target)));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files;
};

const expectContained = (root: string, candidate: string): void => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  expect(relative).not.toBe("");
  expect(relative).not.toBe("..");
  expect(relative.startsWith(`..${path.sep}`)).toBe(false);
  expect(path.isAbsolute(relative)).toBe(false);
};

afterEach(async () => {
  const { resolveWorkspacePaths } = await loadWorkspaceIdentity();
  for (const owned of ownedWorkspaces.splice(0).reverse()) {
    const paths = resolveWorkspacePaths(
      owned.routingRoot,
      owned.workspaceId,
    );
    const descriptor = JSON.parse(
      await readFile(paths.descriptorFile, "utf8").catch(() => "{}"),
    ) as {
      port?: number;
    };
    if (typeof descriptor.port === "number") {
      await new Promise<void>((resolve) => {
        const child = spawn(
          process.execPath,
          [runtimeWrapper, "stop"],
          {
            cwd: repositoryRoot,
            env: createMinimalEnvironment({
              SHUBI_SHOT_URL: `http://127.0.0.1:${descriptor.port}`,
              SHUBI_SHOT_PORT: String(descriptor.port),
              SHUBI_SHOT_RUNTIME_DIR: paths.runtimeDirectory,
            }),
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          },
        );
        child.once("error", () => resolve());
        child.once("close", () => resolve());
      });
    }
    await rm(paths.workspaceDirectory, {
      recursive: true,
      force: true,
    });
  }
  await Promise.all(
    ownedArtifactDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  await Promise.all(
    ownedRuntimeRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  observedStreams.splice(0);
});

describe.sequential("parallel Codex thread scene workspaces", () => {
  it(
    "keeps two real scenes, revisions, bridge instances, and lifecycle operations isolated",
    async () => {
      const {
        deriveThreadWorkspaceId,
        resolveWorkspacePaths,
      } = await loadWorkspaceIdentity();
      const threadA = randomUUID();
      const threadB = randomUUID();
      const workspaceA = deriveThreadWorkspaceId(threadA);
      const workspaceB = deriveThreadWorkspaceId(threadB);
      expect(workspaceA).toMatch(/^workspace_[0-9a-f]{32}$/u);
      expect(workspaceB).toMatch(/^workspace_[0-9a-f]{32}$/u);
      expect(workspaceA).not.toBe(workspaceB);

      const isolatedRuntimeRoot =
        await createIsolatedRuntimeRoot();
      const isolatedRoutingRoot = path.join(
        isolatedRuntimeRoot,
        ".shubi-shot",
        "workspace-routing",
      );
      const environmentA = createMinimalEnvironment({
        CODEX_THREAD_ID: threadA,
        SHUBI_SHOT_RUNTIME_ROOT: isolatedRuntimeRoot,
      });
      const environmentB = createMinimalEnvironment({
        CODEX_THREAD_ID: threadB,
        SHUBI_SHOT_RUNTIME_ROOT: isolatedRuntimeRoot,
      });
      ownedWorkspaces.push(
        {
          environment: environmentA,
          workspaceId: workspaceA!,
          routingRoot: isolatedRoutingRoot,
        },
        {
          environment: environmentB,
          workspaceId: workspaceB!,
          routingRoot: isolatedRoutingRoot,
        },
      );

      const inputDirectory = path.join(testArtifactRoot, randomUUID());
      ownedArtifactDirectories.push(inputDirectory);
      await mkdir(inputDirectory, { recursive: true });
      const sceneAPath = path.join(inputDirectory, "scene-a.json");
      const sceneBPath = path.join(inputDirectory, "scene-b.json");
      const patchAPath = path.join(inputDirectory, "patch-a.json");

      const [ensureResultA, ensureResultB] = await Promise.all([
        runProcess(["ensure"], environmentA),
        runProcess(["ensure"], environmentB),
      ]);
      const ensureA = parseSkillResult<EnsureData>(
        ["ensure", "workspace-a"],
        ensureResultA,
      );
      const ensureB = parseSkillResult<EnsureData>(
        ["ensure", "workspace-b"],
        ensureResultB,
      );
      expect(ensureA.data.uiUrl).not.toBe(ensureB.data.uiUrl);
      expect(ensureA.data.instanceId).not.toBe(
        ensureB.data.instanceId,
      );

      const [currentA, currentB] = await Promise.all([
        runSkill<WorkspaceData>(
          ["workspace", "current"],
          environmentA,
        ),
        runSkill<WorkspaceData>(
          ["workspace", "current"],
          environmentB,
        ),
      ]);
      expect(currentA.data).toMatchObject({
        workspaceId: workspaceA,
        port: Number(new URL(ensureA.data.uiUrl).port),
        status: "ready",
        legacy: false,
      });
      expect(currentB.data).toMatchObject({
        workspaceId: workspaceB,
        port: Number(new URL(ensureB.data.uiUrl).port),
        status: "ready",
        legacy: false,
      });
      expect(currentA.data.port).not.toBe(currentB.data.port);

      const sceneA = createSceneSubmission();
      sceneA.scene = {
        ...sceneA.scene,
        sceneId: "scene_parallel_a",
        title: "Parallel generic scene A",
      };
      const sceneB = createSceneSubmission();
      sceneB.scene = {
        ...sceneB.scene,
        sceneId: "scene_parallel_b",
        title: "Parallel generic scene B",
      };
      await Promise.all([
        writeFile(sceneAPath, JSON.stringify(sceneA), "utf8"),
        writeFile(sceneBPath, JSON.stringify(sceneB), "utf8"),
      ]);
      await Promise.all([
        runSkill(
          ["scene", "submit", "--file", sceneAPath],
          environmentA,
        ),
        runSkill(
          ["scene", "submit", "--file", sceneBPath],
          environmentB,
        ),
      ]);

      const [beforeA, beforeB] = await Promise.all([
        runSkill<SnapshotData>(["snapshot"], environmentA),
        runSkill<SnapshotData>(["snapshot"], environmentB),
      ]);
      expect(beforeA.data.scene).toMatchObject({
        sceneId: "scene_parallel_a",
        revision: 1,
      });
      expect(beforeB.data.scene).toMatchObject({
        sceneId: "scene_parallel_b",
        revision: 1,
      });

      const patchA = createPatchSubmission(beforeA.data.scene);
      patchA.patch = {
        ...patchA.patch,
        patchId: "patch_parallel_a",
        operations: [patchA.patch.operations[1]],
      };
      patchA.intentReport = {
        ...patchA.intentReport,
        recognizedConstraints: [
          {
            id: "intent_parallel_title_a",
            kind: "output",
            required: true,
            targets: [],
            evidence: [
              {
                type: "patch-operation",
                operationIndex: 0,
              },
            ],
          },
        ],
      };
      await writeFile(patchAPath, JSON.stringify(patchA), "utf8");
      await runSkill(
        ["patch", "submit", "--file", patchAPath],
        environmentA,
      );

      const [afterA, afterB] = await Promise.all([
        runSkill<SnapshotData>(["snapshot"], environmentA),
        runSkill<SnapshotData>(["snapshot"], environmentB),
      ]);
      expect(afterA.data.scene.sceneId).toBe("scene_parallel_a");
      expect(afterA.data.scene.revision).toBe(
        beforeA.data.scene.revision + 1,
      );
      expect(afterA.data.scene.title).toBe(
        beforeA.data.scene.title,
      );
      expect(afterA.data.scene.output).toEqual({
        aspect: { width: 16, height: 9 },
        resolutionPx: { width: 1280, height: 720 },
      });
      expect(afterB.data).toEqual(beforeB.data);

      await runSkill(["stop"], environmentA);
      const healthB = await runSkill<EnsureData>(
        ["health"],
        environmentB,
      );
      expect(healthB.data).toMatchObject({
        uiUrl: ensureB.data.uiUrl,
        instanceId: ensureB.data.instanceId,
        sceneId: "scene_parallel_b",
        revision: beforeB.data.scene.revision,
      });
      const reensureB = await runSkill<EnsureData>(
        ["ensure"],
        environmentB,
      );
      expect(reensureB.data).toMatchObject({
        uiUrl: ensureB.data.uiUrl,
        instanceId: ensureB.data.instanceId,
        sceneId: "scene_parallel_b",
        revision: beforeB.data.scene.revision,
      });
      const finalB = await runSkill<SnapshotData>(
        ["snapshot"],
        environmentB,
      );
      expect(finalB.data).toEqual(beforeB.data);

      const routePaths = [
        resolveWorkspacePaths(isolatedRoutingRoot, workspaceA!),
        resolveWorkspacePaths(isolatedRoutingRoot, workspaceB!),
      ];
      const auditedFiles: string[] = [];
      for (const paths of routePaths) {
        expectContained(
          isolatedRoutingRoot,
          paths.workspaceDirectory,
        );
        expectContained(
          isolatedRoutingRoot,
          paths.descriptorFile,
        );
        expectContained(
          isolatedRoutingRoot,
          paths.runtimeDirectory,
        );
        auditedFiles.push(paths.descriptorFile);
        auditedFiles.push(...(await collectFiles(paths.runtimeDirectory)));
      }
      for (const inputPath of [sceneAPath, sceneBPath, patchAPath]) {
        expectContained(testArtifactRoot, inputPath);
        auditedFiles.push(inputPath);
      }
      const auditedText = [
        ...observedStreams,
        ...(await Promise.all(
          auditedFiles.map((file) => readFile(file, "utf8")),
        )),
      ].join("\n");
      expect(auditedText).not.toContain(threadA);
      expect(auditedText).not.toContain(threadB);
    },
    180_000,
  );
});
