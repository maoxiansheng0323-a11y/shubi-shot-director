import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGenericActorBlueprintDocument } from "./helpers/actor-blueprint-fixtures";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const rootWrapper = path.join(repositoryRoot, "scripts", "director.mjs");
const skillWrapper = path.join(
  repositoryRoot,
  ".agents",
  "skills",
  "shubi-shot-director",
  "scripts",
  "director.mjs",
);
const processBoundary = path.join(
  repositoryRoot,
  "scripts",
  "process-boundary.mjs",
);

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const temporaryDirectories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "actor-blueprint-boundary-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const runProcess = (
  script: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
  } = {},
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
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
    child.stdin.end(options.stdin);
  });

const parseEnvelope = (stdout: string): Record<string, unknown> => {
  const lines = stdout.split(/\r?\n/u);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  return JSON.parse(lines[0] ?? "") as Record<string, unknown>;
};

const writeBlueprint = async (
  directory: string,
  value: unknown = createGenericActorBlueprintDocument(),
): Promise<string> => {
  const file = path.join(directory, "actor-blueprint.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Actor Blueprint Host file boundary", () => {
  it.each([
    ["root", rootWrapper],
    ["Skill", skillWrapper],
  ] as const)(
    "returns only a generic summary through the %s wrapper",
    async (_label, wrapper) => {
      const directory = await temporaryDirectory();
      const document = createGenericActorBlueprintDocument();
      document.modules[2].moduleId = "boundary_marker_terminals";
      document.variants[0].moduleVisibility = {
        boundary_marker_terminals: true,
      };
      document.variants[1].moduleVisibility = {
        boundary_marker_terminals: false,
      };
      const file = await writeBlueprint(directory, document);

      const result = await runProcess(wrapper, [
        "blueprint",
        "validate",
        "--file",
        file,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe("");
      expect(parseEnvelope(result.stdout)).toEqual({
        ok: true,
        data: {
          blueprintId: "actor_blueprint_1",
          blueprintVersion: 1,
          contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          moduleCount: 5,
          variantCount: 2,
          valid: true,
        },
      });
      expect(result.stdout).not.toContain(file);
      expect(result.stdout).not.toContain(directory);
      expect(result.stdout).not.toContain("boundary_marker_terminals");
    },
    20_000,
  );

  it("passes path-free structured input to the child runtime", async () => {
    const directory = await temporaryDirectory();
    const scriptsDirectory = path.join(directory, "scripts");
    const fakeTsxDirectory = path.join(
      directory,
      "node_modules",
      "tsx",
      "dist",
    );
    const copiedWrapper = path.join(scriptsDirectory, "director.mjs");
    const captureFile = path.join(directory, "runtime-capture.json");
    const externalDirectory = path.join(
      directory,
      "external_path_marker_71f35c",
    );
    await Promise.all([
      mkdir(scriptsDirectory, { recursive: true }),
      mkdir(fakeTsxDirectory, { recursive: true }),
      mkdir(externalDirectory, { recursive: true }),
    ]);
    await Promise.all([
      copyFile(rootWrapper, copiedWrapper),
      copyFile(
        processBoundary,
        path.join(scriptsDirectory, "process-boundary.mjs"),
      ),
      writeFile(
        path.join(fakeTsxDirectory, "cli.mjs"),
        `
          import { writeFile } from "node:fs/promises";
          let stdin = "";
          process.stdin.setEncoding("utf8");
          for await (const chunk of process.stdin) stdin += chunk;
          await writeFile(
            ${JSON.stringify(captureFile)},
            JSON.stringify({ args: process.argv.slice(3), stdin }),
            "utf8",
          );
          process.stdout.write(JSON.stringify({
            ok: true,
            data: {
              blueprintId: "actor_blueprint_1",
              blueprintVersion: 1,
              contentSha256: "${"a".repeat(64)}",
              moduleCount: 5,
              variantCount: 2,
              valid: true
            }
          }) + "\\n");
        `,
        "utf8",
      ),
    ]);
    const document = createGenericActorBlueprintDocument();
    const externalFile = await writeBlueprint(externalDirectory, document);

    const result = await runProcess(
      copiedWrapper,
      ["blueprint", "validate", "--file", externalFile],
      { cwd: directory },
    );
    const capture = JSON.parse(await readFile(captureFile, "utf8")) as {
      args: string[];
      stdin: string;
    };

    expect(result.exitCode).toBe(0);
    expect(capture.args).toEqual(["blueprint", "validate", "--stdin"]);
    expect(JSON.parse(capture.stdin)).toEqual(document);
    expect(JSON.stringify(capture.args)).not.toContain(
      "external_path_marker_71f35c",
    );
    expect(result.stdout).not.toContain(externalFile);
    expect(result.stderr).not.toContain(externalFile);
  });

  it.each([
    [
      "missing file",
      async (directory: string) => path.join(directory, "missing.json"),
      "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    ],
    [
      "directory",
      async (directory: string) => directory,
      "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    ],
    [
      "oversized input",
      async (directory: string) => {
        const file = path.join(directory, "oversized.json");
        await writeFile(file, " ".repeat(1024 * 1024 + 1), "utf8");
        return file;
      },
      "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    ],
    [
      "invalid JSON",
      async (directory: string) => {
        const file = path.join(directory, "invalid.json");
        await writeFile(file, "{", "utf8");
        return file;
      },
      "ACTOR_BLUEPRINT_FILE_INVALID",
    ],
    [
      "unsupported schema",
      async (directory: string) => {
        const document = createGenericActorBlueprintDocument() as unknown as {
          schemaVersion: number;
        };
        document.schemaVersion = 2;
        return writeBlueprint(directory, document);
      },
      "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
    ],
    [
      "invalid variant",
      async (directory: string) => {
        const document = createGenericActorBlueprintDocument();
        document.variants[0].limbPresence = {
          upper_arm_r: "absent",
          hand_r: "present",
        };
        return writeBlueprint(directory, document);
      },
      "ACTOR_BLUEPRINT_VARIANT_INVALID",
    ],
  ] as const)(
    "returns a path-free stable error for %s",
    async (_label, createFile, code) => {
      const directory = await temporaryDirectory();
      const file = await createFile(directory);
      const result = await runProcess(rootWrapper, [
        "blueprint",
        "validate",
        "--file",
        file,
      ]);
      const envelope = parseEnvelope(result.stdout);

      expect(result.exitCode).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe("");
      expect(envelope).toMatchObject({
        ok: false,
        error: { code },
      });
      expect(JSON.stringify(envelope)).not.toContain(file);
      expect(JSON.stringify(envelope)).not.toContain(directory);
    },
    20_000,
  );

  it("rejects a Windows drive-relative file without forwarding it", async () => {
    const marker = "C:drive_relative_path_marker_58c91d.json";
    const result = await runProcess(rootWrapper, [
      "blueprint",
      "validate",
      "--file",
      marker,
    ]);

    expect(result.exitCode).toBe(1);
    expect(parseEnvelope(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "ACTOR_BLUEPRINT_FILE_READ_FAILED" },
    });
    expect(result.stdout).not.toContain(marker);
    expect(result.stderr).not.toContain(marker);
  });
});
