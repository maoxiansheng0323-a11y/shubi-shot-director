#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

const isLegacyTextCommand = (args) =>
  (args[0] === "shot" &&
    (args[1] === "create" || args[1] === "modify")) ||
  (args[0] === "profile" && args[1] === "resolve");

const launchDirector = (args, childEnvironment) => {
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
      stdio: "inherit",
      windowsHide: true,
    },
  );

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
    launchDirector(
      args,
      boundary.createRuntimeChildEnvironment(process.env),
    );
  } catch (error) {
    output(
      boundary !== undefined && error instanceof boundary.BoundaryError
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
