import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(".");
const skillWrapper = path.resolve(
  ".agents",
  "skills",
  "shubi-shot-director",
  "scripts",
  "director.mjs",
);
const fixtureConfigurationFile = "fixture-config.json";
const fixtureActionLogFile = "fixture-actions.jsonl";
const fixtureArgumentsLogFile = "fixture-arguments.jsonl";
const fixtureEnvironmentLogFile = "fixture-environment.jsonl";
const fixtureStateFile = "fixture-state.json";
const fixtureEntrypoint = path.join("scripts", "director.mjs");
const defaultTimeoutMs = 10_000;

export const deniedRuntimeEnvironmentNames = [
  "OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NODE_OPTIONS",
  "SHUBI_SHOT_API_KEY",
  "SHUBI_SHOT_TOKEN",
  "SHUBI_SHOT_AUTHORIZATION",
  "SHUBI_SHOT_SECRET",
  "SHUBI_SHOT_MODEL",
  "SHUBI_SHOT_PROVIDER",
  "SHUBI_SHOT_BASE_URL",
  "SHUBI_SHOT_ENDPOINT",
] as const;

export interface SyntheticRuntimeError {
  code?: string;
  message: string;
}

export interface SyntheticResponseOverride {
  stdout: string;
  stderr?: string;
  exitCode?: number;
  signal?: NodeJS.Signals;
}

export interface SkillRuntimeFixtureOptions {
  doctorData: Record<string, unknown>;
  healthData?: Record<string, unknown>;
  healthError?: SyntheticRuntimeError;
  actionErrors?: Record<string, SyntheticRuntimeError>;
  responseOverrides?: Record<string, SyntheticResponseOverride>;
}

export interface SyntheticRuntimeState {
  sceneId: string;
  revision: number;
  mutationCount: number;
  startupCount: number;
}

export interface SyntheticEnvironmentObservation {
  action: string;
  presentDeniedNames: string[];
}

export interface SkillWrapperResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SkillRuntimeFixture {
  runtimeRoot: string;
  run: (
    args: string[],
    options?: {
      timeoutMs?: number;
      environment?: NodeJS.ProcessEnv;
      wrapperPath?: string;
      cwd?: string;
    },
  ) => Promise<SkillWrapperResult>;
  readActionIds: () => Promise<string[]>;
  readArgumentVectors: () => Promise<string[][]>;
  readEnvironmentObservations: () => Promise<
    SyntheticEnvironmentObservation[]
  >;
  readState: () => Promise<SyntheticRuntimeState>;
  reset: () => Promise<void>;
  dispose: () => Promise<void>;
}

const initialState = (): SyntheticRuntimeState => ({
  sceneId: "scene_generic_runtime",
  revision: 0,
  mutationCount: 0,
  startupCount: 0,
});

const syntheticRuntimeSource = String.raw`#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configurationPath = path.join(runtimeRoot, "fixture-config.json");
const actionLogPath = path.join(runtimeRoot, "fixture-actions.jsonl");
const argumentsLogPath = path.join(runtimeRoot, "fixture-arguments.jsonl");
const environmentLogPath = path.join(runtimeRoot, "fixture-environment.jsonl");
const statePath = path.join(runtimeRoot, "fixture-state.json");
const configuration = JSON.parse(readFileSync(configurationPath, "utf8"));
const args = process.argv.slice(2);

const deniedEnvironmentNames = ${JSON.stringify(deniedRuntimeEnvironmentNames)};
const declaredActions = new Set([
  "doctor",
  "help",
  ...(Array.isArray(configuration.doctorData?.commands)
    ? configuration.doctorData.commands.filter((value) => typeof value === "string")
    : []),
]);

const actionFromArgs = (input) => {
  const command = input[0] ?? "help";
  if (["help", "doctor", "ensure", "status", "stop", "health", "snapshot", "undo", "redo"].includes(command)) {
    return command;
  }
  if (command === "scene" && ["create", "submit", "save", "load"].includes(input[1])) {
    return "scene." + input[1];
  }
  if (command === "patch" && ["apply", "submit"].includes(input[1])) {
    return "patch." + input[1];
  }
  if (command === "composition" && input[1] === "inspect") {
    return "composition.inspect";
  }
  if (command === "export" && input[1] === "png") {
    return "export.png";
  }
  if (command === "open" && input[1] === "--system") {
    return "open.system";
  }
  return undefined;
};

const output = (value) => {
  process.stdout.write(JSON.stringify(value) + "\n");
};

const action = actionFromArgs(args);
if (action === undefined || !declaredActions.has(action)) {
  output({ ok: false, error: { code: "CLI_UNKNOWN_COMMAND", message: "Unknown command." } });
  process.exitCode = 1;
} else {
  appendFileSync(actionLogPath, JSON.stringify(action) + "\n", "utf8");
  appendFileSync(argumentsLogPath, JSON.stringify(args) + "\n", "utf8");
  appendFileSync(
    environmentLogPath,
    JSON.stringify({
      action,
      presentDeniedNames: deniedEnvironmentNames.filter(
        (name) => process.env[name] !== undefined,
      ),
    }) + "\n",
    "utf8",
  );

  const override = configuration.responseOverrides?.[action];
  if (override !== undefined) {
    if (override.stderr !== undefined) {
      process.stderr.write(override.stderr);
    }
    if (override.signal !== undefined) {
      process.stdout.write(override.stdout, () => {
        process.kill(process.pid, override.signal);
      });
    } else {
      process.stdout.write(override.stdout);
      process.exitCode = override.exitCode ?? 0;
    }
  } else if (action === "doctor") {
    output({ ok: true, data: configuration.doctorData });
  } else if (action === "help") {
    output({ ok: true, data: { commands: [...declaredActions] } });
  } else if (action === "health" && configuration.healthError !== undefined) {
    output({
      ok: false,
      error: {
        code: configuration.healthError.code ?? "RUNTIME_HEALTH_FAILED",
        message: configuration.healthError.message,
      },
    });
    process.exitCode = 1;
  } else if (configuration.actionErrors?.[action] !== undefined) {
    const error = configuration.actionErrors[action];
    output({
      ok: false,
      error: {
        code: error.code ?? "RUNTIME_ACTION_FAILED",
        message: error.message,
      },
    });
    process.exitCode = 1;
  } else {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const mutatingActions = new Set([
      "scene.create",
      "scene.submit",
      "scene.load",
      "patch.apply",
      "patch.submit",
      "undo",
      "redo",
    ]);
    if (mutatingActions.has(action)) {
      state.revision += 1;
      state.mutationCount += 1;
    }
    if (action === "ensure" || action === "open.system") {
      state.startupCount += 1;
    }
    writeFileSync(statePath, JSON.stringify(state) + "\n", "utf8");

    if (action === "health") {
      output({
        ok: true,
        data: {
          ...(configuration.healthData ?? configuration.doctorData),
          status: "ready",
          sceneId: state.sceneId,
          revision: state.revision,
        },
      });
    } else {
      output({ ok: true, data: state });
    }
  }
}
`;

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

const readJsonLines = async <T>(filePath: string): Promise<T[]> => {
  const source = await readFile(filePath, "utf8");
  return source.length === 0
    ? []
    : source
        .trimEnd()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as T);
};

export const resetSkillRuntimeFixture = async (
  runtimeRoot: string,
): Promise<void> => {
  await Promise.all([
    writeFile(path.join(runtimeRoot, fixtureActionLogFile), "", "utf8"),
    writeFile(
      path.join(runtimeRoot, fixtureArgumentsLogFile),
      "",
      "utf8",
    ),
    writeFile(
      path.join(runtimeRoot, fixtureEnvironmentLogFile),
      "",
      "utf8",
    ),
    writeFile(
      path.join(runtimeRoot, fixtureStateFile),
      `${JSON.stringify(initialState())}\n`,
      "utf8",
    ),
  ]);
};

export const createSkillRuntimeAtRoot = async (
  runtimeRoot: string,
  options: SkillRuntimeFixtureOptions,
): Promise<void> => {
  await mkdir(path.join(runtimeRoot, "scripts"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(runtimeRoot, "package.json"),
      `${JSON.stringify({ name: "shubi-shot-director", type: "module" })}\n`,
      "utf8",
    ),
    writeFile(
      path.join(runtimeRoot, fixtureEntrypoint),
      syntheticRuntimeSource,
      "utf8",
    ),
    writeFile(
      path.join(runtimeRoot, fixtureConfigurationFile),
      `${JSON.stringify(options, null, 2)}\n`,
      "utf8",
    ),
  ]);
  await resetSkillRuntimeFixture(runtimeRoot);
};

export const readSkillRuntimeActionIds = async (
  runtimeRoot: string,
): Promise<string[]> =>
  readJsonLines<string>(path.join(runtimeRoot, fixtureActionLogFile));

export const readSkillRuntimeArgumentVectors = async (
  runtimeRoot: string,
): Promise<string[][]> =>
  readJsonLines<string[]>(
    path.join(runtimeRoot, fixtureArgumentsLogFile),
  );

export const readSkillRuntimeEnvironmentObservations = async (
  runtimeRoot: string,
): Promise<SyntheticEnvironmentObservation[]> =>
  readJsonLines<SyntheticEnvironmentObservation>(
    path.join(runtimeRoot, fixtureEnvironmentLogFile),
  );

export const readSkillRuntimeState = async (
  runtimeRoot: string,
): Promise<SyntheticRuntimeState> =>
  readJson<SyntheticRuntimeState>(path.join(runtimeRoot, fixtureStateFile));

export const runSkillWrapper = async (
  runtimeRoot: string,
  args: string[],
  options: {
    timeoutMs?: number;
    environment?: NodeJS.ProcessEnv;
    wrapperPath?: string;
    cwd?: string;
  } = {},
): Promise<SkillWrapperResult> => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.environment,
    SHUBI_SHOT_RUNTIME_ROOT: runtimeRoot,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [options.wrapperPath ?? skillWrapper, ...args],
      {
      cwd: options.cwd ?? repositoryRoot,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? defaultTimeoutMs);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    });
  });
};

export const createSkillRuntimeFixture = async (
  options: SkillRuntimeFixtureOptions,
): Promise<SkillRuntimeFixture> => {
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "skill-runtime-fixture-"),
  );
  await createSkillRuntimeAtRoot(runtimeRoot, options);
  return {
    runtimeRoot,
    run: (args, runOptions) =>
      runSkillWrapper(runtimeRoot, args, runOptions),
    readActionIds: () => readSkillRuntimeActionIds(runtimeRoot),
    readArgumentVectors: () =>
      readSkillRuntimeArgumentVectors(runtimeRoot),
    readEnvironmentObservations: () =>
      readSkillRuntimeEnvironmentObservations(runtimeRoot),
    readState: () => readSkillRuntimeState(runtimeRoot),
    reset: () => resetSkillRuntimeFixture(runtimeRoot),
    dispose: () => rm(runtimeRoot, { recursive: true, force: true }),
  };
};
