import { spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);
const directorCli = fileURLToPath(
  new URL("../cli/director.ts", import.meta.url),
);
const tsxCli = path.join(
  repositoryRoot,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

const LEGACY_TEXT_ERROR = {
  ok: false,
  error: {
    code: "HOST_STRUCTURED_INPUT_REQUIRED",
    message:
      "Natural-language requests must be authored by the host as structured submissions.",
  },
} as const;

const CLI_LOAD_ERROR = {
  ok: false,
  error: {
    code: "CLI_ERROR",
    message: "The command could not be completed safely.",
  },
} as const;

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shot-legacy-text-rejection-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const createDirectorEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.SHUBI_SHOT_PORT;
  delete environment.SHUBI_SHOT_URL;
  return { ...environment, ...overrides };
};

const runProcess = (
  executable: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? createDirectorEnvironment(),
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
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });

const runTypeScriptCli = (
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<ProcessResult> =>
  runProcess(process.execPath, [tsxCli, directorCli, ...args], {
    env: environment,
  });

const expectFixedLegacyTextError = (
  result: ProcessResult,
  sensitiveValues: readonly string[],
): void => {
  expect(result).toMatchObject({
    exitCode: 1,
    signal: null,
    stderr: "",
  });
  expect(result.stdout).toBe(`${JSON.stringify(LEGACY_TEXT_ERROR)}\n`);
  for (const value of sensitiveValues) {
    expect(result.stdout).not.toContain(value);
  }
};

const expectFixedCliLoadError = (
  result: ProcessResult,
  sensitiveValues: readonly string[],
): void => {
  expect(result).toMatchObject({
    exitCode: 1,
    signal: null,
    stderr: "",
  });
  expect(result.stdout).toBe(`${JSON.stringify(CLI_LOAD_ERROR)}\n`);
  for (const value of sensitiveValues) {
    expect(result.stdout).not.toContain(value);
  }
};

const listenOnLoopback = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const getUnusedLoopbackPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const collectProductionModules = async (
  directory: string,
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectProductionModules(entryPath);
      }
      return /\.(?:[cm]?js|tsx?)$/u.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
};

const importedModuleSpecifiers = (
  source: string,
  fileName = "production-module.ts",
): string[] => {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const addStringLiteral = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addStringLiteral(node.arguments[0]);
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        addStringLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

const stripModuleExtension = (target: string): string => {
  const extension = MODULE_EXTENSIONS.find((candidate) =>
    target.endsWith(candidate),
  );
  return extension === undefined ? target : target.slice(0, -extension.length);
};

const normalizeImportTarget = (
  importer: string,
  specifier: string,
): string => {
  const target = specifier.startsWith(".")
    ? path.relative(
        repositoryRoot,
        path.resolve(path.dirname(importer), specifier),
      )
    : specifier;
  return stripModuleExtension(target.replaceAll("\\", "/"));
};

const FORBIDDEN_RUNTIME_MODULE_BASES = [
  "src/natural-language",
  "natural-language/compiler",
  "natural-language/semantic-coverage",
  "natural-language/intent-report",
  "src/domain/project-profile",
  "project-profile",
  "cli/intent-io",
  "intent-io",
] as const;

const isForbiddenRuntimeImport = (target: string): boolean =>
  FORBIDDEN_RUNTIME_MODULE_BASES.some(
    (base) => target === base || target.startsWith(`${base}/`),
  );

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("legacy text command rejection", () => {
  it.each([
    ["shot create", "shot", "create", "ROOT_SHOT_CREATE_MARKER"],
    ["shot modify", "shot", "modify", "ROOT_SHOT_MODIFY_MARKER"],
    ["profile resolve", "profile", "resolve", "ROOT_PROFILE_RESOLVE_MARKER"],
  ] as const)(
    "rejects %s in a copied root launcher before spawning an unavailable runtime",
    async (_label, command, action, marker) => {
      const directory = await createTemporaryDirectory();
      const scriptsDirectory = path.join(directory, "scripts");
      const copiedLauncher = path.join(scriptsDirectory, "director.mjs");
      const missingFile = path.join(directory, `${marker}.json`);
      await mkdir(scriptsDirectory, { recursive: true });
      await copyFile(directorScript, copiedLauncher);

      expect(await pathExists(path.join(directory, "node_modules"))).toBe(
        false,
      );

      const result = await runProcess(
        process.execPath,
        [
          copiedLauncher,
          command,
          action,
          "--text",
          marker,
          "--profile",
          missingFile,
          "--file",
          missingFile,
          "--unknown",
          marker,
        ],
        {
          cwd: directory,
          env: createDirectorEnvironment({
            SHUBI_SHOT_URL: "https://invalid.example.test/path",
          }),
        },
      );

      expectFixedLegacyTextError(result, [marker, missingFile]);
      expect(await pathExists(missingFile)).toBe(false);
    },
  );

  it.each([
    ["shot create", "shot", "create", "DIRECT_SHOT_CREATE_MARKER"],
    ["shot modify", "shot", "modify", "DIRECT_SHOT_MODIFY_MARKER"],
    [
      "profile resolve",
      "profile",
      "resolve",
      "DIRECT_PROFILE_RESOLVE_MARKER",
    ],
  ] as const)(
    "rejects %s in a copied direct TypeScript entry before loading project modules",
    async (_label, command, action, marker) => {
      const directory = await createTemporaryDirectory();
      const cliDirectory = path.join(directory, "cli");
      const copiedDirectorCli = path.join(cliDirectory, "director.ts");
      const missingFile = path.join(directory, `${marker}.json`);
      await mkdir(cliDirectory, { recursive: true });
      await copyFile(directorCli, copiedDirectorCli);

      expect(await pathExists(path.join(directory, "package.json"))).toBe(
        false,
      );
      expect(await pathExists(path.join(directory, "node_modules"))).toBe(
        false,
      );

      const result = await runProcess(
        process.execPath,
        [
          tsxCli,
          copiedDirectorCli,
          command,
          action,
          "--text",
          marker,
          "--profile",
          missingFile,
          "--file",
          missingFile,
          "--unknown",
          marker,
        ],
        {
          cwd: directory,
          env: createDirectorEnvironment({
            SHUBI_SHOT_URL: "https://invalid.example.test/path",
          }),
        },
      );

      expectFixedLegacyTextError(result, [marker, missingFile]);
      expect(await pathExists(missingFile)).toBe(false);
    },
  );

  it("returns one generic error when a copied direct entry cannot load its runtime", async () => {
    const directory = await createTemporaryDirectory();
    const cliDirectory = path.join(directory, "cli");
    const copiedDirectorCli = path.join(cliDirectory, "director.ts");
    const marker = "DIRECT_RUNTIME_LOAD_FAILURE_MARKER";
    await mkdir(cliDirectory, { recursive: true });
    await copyFile(directorCli, copiedDirectorCli);

    const result = await runProcess(
      process.execPath,
      [tsxCli, copiedDirectorCli, "help", "--unknown", marker],
      {
        cwd: directory,
        env: createDirectorEnvironment({
          SHUBI_SHOT_URL: "https://invalid.example.test/path",
        }),
      },
    );

    expectFixedCliLoadError(result, [marker, directory]);
  });

  it("rejects in the TypeScript CLI before validating bridge configuration", async () => {
    const marker = "INVALID_BRIDGE_TRAILING_MARKER";
    const result = await runTypeScriptCli(
      ["shot", "create", "--unknown", marker],
      createDirectorEnvironment({
        SHUBI_SHOT_URL: "https://invalid.example.test/path",
      }),
    );

    expectFixedLegacyTextError(result, [marker]);
  });

  it("rejects in the TypeScript CLI before reading a missing profile", async () => {
    const directory = await createTemporaryDirectory();
    const marker = "MISSING_PROFILE_TRAILING_MARKER";
    const missingProfile = path.join(directory, `${marker}.json`);
    const result = await runTypeScriptCli(
      [
        "profile",
        "resolve",
        "--file",
        missingProfile,
        "--text",
        marker,
      ],
      createDirectorEnvironment({ SHUBI_SHOT_PORT: "39091" }),
    );

    expectFixedLegacyTextError(result, [marker, missingProfile]);
    expect(await pathExists(missingProfile)).toBe(false);
  });

  it("rejects all legacy commands without requesting an active numeric-loopback bridge", async () => {
    const directory = await createTemporaryDirectory();
    const requests: Array<{ method: string; path: string }> = [];
    const server = createServer((request, response) => {
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
      });
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ok: false,
          error: {
            code: "UNEXPECTED_BRIDGE_REQUEST",
            message: "The bridge must not be contacted.",
          },
        }),
      );
    });
    const port = await listenOnLoopback(server);
    const environment = createDirectorEnvironment({
      SHUBI_SHOT_URL: `http://127.0.0.1:${port}`,
    });
    const cases = [
      ["shot", "create", "LIVE_SHOT_CREATE_MARKER"],
      ["shot", "modify", "LIVE_SHOT_MODIFY_MARKER"],
      ["profile", "resolve", "LIVE_PROFILE_RESOLVE_MARKER"],
    ] as const;

    try {
      for (const [command, action, marker] of cases) {
        const missingFile = path.join(directory, `${marker}.json`);
        const result = await runTypeScriptCli(
          [
            command,
            action,
            "--text",
            marker,
            "--profile",
            missingFile,
            "--file",
            missingFile,
            "--unknown",
            marker,
          ],
          environment,
        );

        expectFixedLegacyTextError(result, [marker, missingFile]);
        expect(await pathExists(missingFile)).toBe(false);
      }
    } finally {
      await closeServer(server);
    }

    expect(requests).toEqual([]);
  }, 20_000);

  it("rejects in the TypeScript CLI without starting a stopped bridge", async () => {
    const port = await getUnusedLoopbackPort();
    const marker = "STOPPED_BRIDGE_TRAILING_MARKER";
    const environment = createDirectorEnvironment({
      SHUBI_SHOT_PORT: String(port),
    });

    const result = await runTypeScriptCli(
      [
        "shot",
        "modify",
        "--text",
        `Move the camera a little down ${marker}`,
      ],
      environment,
    );
    const status = await runTypeScriptCli(["status"], environment);
    await runTypeScriptCli(["stop"], environment);

    expectFixedLegacyTextError(result, [marker]);
    expect(JSON.parse(status.stdout) as unknown).toMatchObject({
      ok: true,
      data: { status: "stopped" },
    });
  }, 20_000);
});

describe("runtime semantic import boundary", () => {
  it("collects static, import-equals, dynamic, and require module specifiers", () => {
    const importer = path.join(repositoryRoot, "cli", "audit-fixture.ts");
    const specifiers = importedModuleSpecifiers(
      `
        import compiler from "../src/natural-language/compiler.ts";
        export { profile } from "../src/domain/project-profile.js";
        import legacy = require("./intent-io.cjs");
        void import(
          /* boundary audit */
          "../src/natural-language/semantic-coverage.mjs",
          { with: { type: "json" } }
        );
        require("../src/natural-language/intent-report.jsx");
        export * from "../src/natural-language/compiler/subpath.js";
      `,
      importer,
    );

    expect(specifiers).toEqual([
      "../src/natural-language/compiler.ts",
      "../src/domain/project-profile.js",
      "./intent-io.cjs",
      "../src/natural-language/semantic-coverage.mjs",
      "../src/natural-language/intent-report.jsx",
      "../src/natural-language/compiler/subpath.js",
    ]);
    expect(
      specifiers
        .map((specifier) => normalizeImportTarget(importer, specifier))
        .filter(isForbiddenRuntimeImport),
    ).toHaveLength(specifiers.length);
  });

  it("contains no removed semantic modules or production imports", async () => {
    const productionRoots = ["cli", "server", "src", "scripts"].map(
      (directory) => path.join(repositoryRoot, directory),
    );
    const productionModules = (
      await Promise.all(productionRoots.map(collectProductionModules))
    ).flat();
    const violations: string[] = [];

    for (const modulePath of productionModules) {
      const source = await readFile(modulePath, "utf8");
      for (const specifier of importedModuleSpecifiers(source, modulePath)) {
        const target = normalizeImportTarget(modulePath, specifier);
        if (isForbiddenRuntimeImport(target)) {
          violations.push(
            `${path.relative(repositoryRoot, modulePath).replaceAll("\\", "/")} -> ${target}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);

    const removedModuleBases = [
      "cli/intent-io",
      "src/natural-language/compiler",
      "src/natural-language/semantic-coverage",
      "src/natural-language/intent-report",
      "src/domain/project-profile",
    ];
    const removedModuleCandidates = removedModuleBases.flatMap((base) => [
      base,
      ...MODULE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ]);
    const existingRemovedModules = (
      await Promise.all(
        removedModuleCandidates.map(async (candidate) => ({
          candidate,
          exists: await pathExists(path.join(repositoryRoot, candidate)),
        })),
      )
    )
      .filter(({ exists }) => exists)
      .map(({ candidate }) => candidate);

    expect(existingRemovedModules).toEqual([]);
  });
});
