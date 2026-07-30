#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const actorBlueprintMaxInputBytes = 1024 * 1024;
const windowsDriveRelativePathPattern = /^[A-Za-z]:(?![\\/])/;

const ACTOR_BLUEPRINT_ERROR_MESSAGES = Object.freeze({
  ACTOR_BLUEPRINT_FILE_READ_FAILED:
    "The Actor Blueprint file could not be read.",
  ACTOR_BLUEPRINT_FILE_INVALID:
    "The Actor Blueprint document is invalid.",
});

const LEGACY_TEXT_ERROR = {
  ok: false,
  error: {
    code: "HOST_STRUCTURED_INPUT_REQUIRED",
    message:
      "Natural-language requests must be authored by the host as structured submissions.",
  },
};

const CLI_LOAD_ERROR = {
  ok: false,
  error: {
    code: "CLI_ERROR",
    message: "The command could not be completed safely.",
  },
};

const output = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

class HostBlueprintImportError extends Error {
  constructor(code) {
    super(ACTOR_BLUEPRINT_ERROR_MESSAGES[code]);
    this.name = "HostBlueprintImportError";
    this.code = code;
  }
}

const isLegacyTextCommand = (args) =>
  (args[0] === "shot" &&
    (args[1] === "create" || args[1] === "modify")) ||
  (args[0] === "profile" && args[1] === "resolve");

const readBlueprintSource = async (fileArgument) => {
  if (
    typeof fileArgument !== "string" ||
    fileArgument.trim().length === 0 ||
    windowsDriveRelativePathPattern.test(fileArgument)
  ) {
    throw new HostBlueprintImportError(
      "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    );
  }

  let handle;
  try {
    handle = await open(path.resolve(process.cwd(), fileArgument), "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > actorBlueprintMaxInputBytes) {
      throw new HostBlueprintImportError(
        "ACTOR_BLUEPRINT_FILE_READ_FAILED",
      );
    }
    const source = await handle.readFile("utf8");
    if (Buffer.byteLength(source, "utf8") > actorBlueprintMaxInputBytes) {
      throw new HostBlueprintImportError(
        "ACTOR_BLUEPRINT_FILE_READ_FAILED",
      );
    }
    try {
      return JSON.stringify(JSON.parse(source));
    } catch {
      throw new HostBlueprintImportError(
        "ACTOR_BLUEPRINT_FILE_INVALID",
      );
    }
  } catch (error) {
    if (error instanceof HostBlueprintImportError) {
      throw error;
    }
    throw new HostBlueprintImportError(
      "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

const blueprintFileArgument = (args) =>
  args.length === 4 &&
  args[0] === "blueprint" &&
  args[1] === "validate" &&
  args[2] === "--file"
    ? args[3]
    : undefined;

const launchDirector = (args, childEnvironment, stdinSource) => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const cliPath = path.join(repositoryRoot, "cli", "director.ts");
  const tsxCliPath = path.join(
    repositoryRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );

  const child = spawn(
    process.execPath,
    [tsxCliPath, cliPath, ...args],
    {
      cwd: repositoryRoot,
      env: childEnvironment,
      shell: false,
      stdio:
        stdinSource === undefined
          ? "inherit"
          : ["pipe", "inherit", "inherit"],
      windowsHide: true,
    },
  );

  if (stdinSource !== undefined) {
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdinSource, "utf8");
  }

  let failedToStart = false;
  child.on("exit", (code, signal) => {
    if (failedToStart) {
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  child.on("error", () => {
    failedToStart = true;
    output(CLI_LOAD_ERROR);
    process.exitCode = 1;
  });
};

const runDirector = async (args) => {
  let boundary;
  try {
    boundary = await import("./process-boundary.mjs");
    boundary.assertNoForbiddenDirectorArguments(args);
    boundary.assertNoForbiddenDirectorEnvironment(process.env);
    const fileArgument = blueprintFileArgument(args);
    const stdinSource =
      fileArgument === undefined
        ? undefined
        : await readBlueprintSource(fileArgument);
    launchDirector(
      stdinSource === undefined
        ? args
        : ["blueprint", "validate", "--stdin"],
      boundary.createRuntimeChildEnvironment(process.env),
      stdinSource,
    );
  } catch (error) {
    output(
      error instanceof HostBlueprintImportError
        ? {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          }
        : boundary !== undefined && error instanceof boundary.BoundaryError
        ? {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          }
        : CLI_LOAD_ERROR,
    );
    process.exitCode = 1;
  }
};

const args = process.argv.slice(2);
if (isLegacyTextCommand(args)) {
  output(LEGACY_TEXT_ERROR);
  process.exitCode = 1;
} else {
  void runDirector(args);
}
