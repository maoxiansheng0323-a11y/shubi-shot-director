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
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);
const directorCli = fileURLToPath(
  new URL("../cli/director.ts", import.meta.url),
);
const serverEntry = fileURLToPath(
  new URL("../server/index.ts", import.meta.url),
);
const processBoundary = fileURLToPath(
  new URL("../scripts/process-boundary.mjs", import.meta.url),
);
const tsxCli = path.join(
  repositoryRoot,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

interface BoundaryFailure extends Error {
  readonly code: string;
}

interface BoundaryModule {
  BoundaryError: new (code: string, message: string) => BoundaryFailure;
  assertNoForbiddenDirectorArguments(args: readonly string[]): void;
  assertNoForbiddenDirectorEnvironment(env?: NodeJS.ProcessEnv): void;
  createRuntimeChildEnvironment(
    env?: NodeJS.ProcessEnv,
  ): NodeJS.ProcessEnv;
  createBridgeChildEnvironment(
    port: number,
    runtimeDir?: string,
    env?: NodeJS.ProcessEnv,
  ): NodeJS.ProcessEnv;
  createBrowserChildEnvironment(
    env?: NodeJS.ProcessEnv,
  ): NodeJS.ProcessEnv;
}

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const temporaryDirectories: string[] = [];

const loadBoundary = async (): Promise<BoundaryModule> =>
  import(
    /* @vite-ignore */ new URL(
      "../scripts/process-boundary.mjs",
      import.meta.url,
    ).href
  ) as Promise<BoundaryModule>;

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "shubi-shot-process-boundary-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const DIRECTOR_OWNED_ENVIRONMENT = [
  "SHUBI_SHOT_API_KEY",
  "SHUBI_SHOT_TOKEN",
  "SHUBI_SHOT_AUTHORIZATION",
  "SHUBI_SHOT_SECRET",
  "SHUBI_SHOT_MODEL",
  "SHUBI_SHOT_PROVIDER",
  "SHUBI_SHOT_BASE_URL",
  "SHUBI_SHOT_ENDPOINT",
] as const;

const CREDENTIAL_ARGUMENT_VARIANTS = [
  "--api-key",
  "--token",
  "--authorization",
  "--secret",
  "--clientKey",
  "--client_key",
  "--client-key",
  "--runtimeAuth",
  "--runtime_auth",
  "--runtime-auth",
  "--authHeader",
  "--auth_header",
  "--auth-header",
] as const;

const MODEL_CONFIGURATION_ARGUMENT_VARIANTS = [
  "--model",
  "--modelConfig",
  "--model_config",
  "--model-config",
  "--provider",
  "--providerOptions",
  "--provider_options",
  "--provider-options",
  "--endpoint",
  "--endpointUrl",
  "--endpoint_url",
  "--endpoint-url",
  "--baseUrl",
  "--base_url",
  "--base-url",
] as const;

const createLaunchEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of DIRECTOR_OWNED_ENVIRONMENT) {
    delete environment[name];
  }
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
      env: options.env ?? createLaunchEnvironment(),
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

const parseSingleJsonLine = (stdout: string): unknown => {
  const lines = stdout.split(/\r?\n/u);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  return JSON.parse(lines[0] ?? "") as unknown;
};

const expectBoundaryFailure = (
  action: () => unknown,
  code: string,
  message: string,
): void => {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code, message });
    return;
  }
  throw new Error(`Expected boundary failure ${code}.`);
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Director argument boundary", () => {
  it.each(CREDENTIAL_ARGUMENT_VARIANTS)(
    "rejects credential argument %s in token and inline forms",
    async (flag) => {
      const boundary = await loadBoundary();

      for (const args of [
        ["doctor", flag, "marker"],
        ["doctor", `${flag}=marker`],
      ]) {
        expectBoundaryFailure(
          () => boundary.assertNoForbiddenDirectorArguments(args),
          "CREDENTIAL_ARGUMENT_FORBIDDEN",
          "Credential arguments are forbidden.",
        );
      }
    },
  );

  it.each(MODEL_CONFIGURATION_ARGUMENT_VARIANTS)(
    "rejects model configuration argument %s in token and inline forms",
    async (flag) => {
      const boundary = await loadBoundary();

      for (const args of [
        ["doctor", flag, "marker"],
        ["doctor", `${flag}=marker`],
      ]) {
        expectBoundaryFailure(
          () => boundary.assertNoForbiddenDirectorArguments(args),
          "MODEL_CONFIGURATION_FORBIDDEN",
          "Model configuration arguments are forbidden.",
        );
      }
    },
  );

  it("does not reject lookalike flags", async () => {
    const boundary = await loadBoundary();

    expect(() =>
      boundary.assertNoForbiddenDirectorArguments([
        "doctor",
        "--tokenizer",
        "--clientTokenizer",
        "--model-view",
        "--endpoint-status",
        "--provider-status",
        "--databaseUrl",
      ]),
    ).not.toThrow();
  });

  it("does not classify non-option argument values", async () => {
    const boundary = await loadBoundary();

    expect(() =>
      boundary.assertNoForbiddenDirectorArguments([
        "doctor",
        "clientKey",
        "runtime_auth",
        "auth-header",
        "modelConfig",
        "provider_options",
        "endpoint-url",
        "baseUrl",
        "--tokenizer=--clientKey",
        "--model-view=--runtime_auth",
        "--endpoint-status=--baseUrl",
      ]),
    ).not.toThrow();
  });
});

describe("Director environment boundary", () => {
  it.each([
    [
      "SHUBI_SHOT_API_KEY",
      "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
      "Director credential environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_TOKEN",
      "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
      "Director credential environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_AUTHORIZATION",
      "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
      "Director credential environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_SECRET",
      "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
      "Director credential environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_MODEL",
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_PROVIDER",
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_BASE_URL",
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_ENDPOINT",
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
  ] as const)(
    "rejects defined Director-owned environment variable %s, including an empty value",
    async (name, code, message) => {
      const boundary = await loadBoundary();

      expectBoundaryFailure(
        () =>
          boundary.assertNoForbiddenDirectorEnvironment({
            [name]: "",
          }),
        code,
        message,
      );
    },
  );

  it("allows ambient host account, endpoint, proxy, and Node variables as non-Director input", async () => {
    const boundary = await loadBoundary();

    expect(() =>
      boundary.assertNoForbiddenDirectorEnvironment({
        OPENAI_API_KEY: "host-account-marker",
        AZURE_OPENAI_ENDPOINT: "https://host.example.test",
        HTTP_PROXY: "http://127.0.0.1:8001",
        HTTPS_PROXY: "http://127.0.0.1:8002",
        ALL_PROXY: "socks5://127.0.0.1:8003",
        NODE_OPTIONS: "--no-warnings",
      }),
    ).not.toThrow();
  });

  it("uses direct property access without enumerating the ambient environment", async () => {
    const boundary = await loadBoundary();
    const environment = new Proxy<NodeJS.ProcessEnv>(
      {
        PATH: "boundary-path",
        SHUBI_SHOT_URL: "http://127.0.0.1:4317",
        SHUBI_SHOT_PORT: "4317",
        SHUBI_SHOT_RUNTIME_DIR: "runtime-directory",
      },
      {
        ownKeys: () => {
          throw new Error("ambient environment must not be enumerated");
        },
      },
    );

    expect(() =>
      boundary.assertNoForbiddenDirectorEnvironment(environment),
    ).not.toThrow();
    expect(
      boundary.createRuntimeChildEnvironment(environment),
    ).toMatchObject({
      PATH: "boundary-path",
      SHUBI_SHOT_URL: "http://127.0.0.1:4317",
      SHUBI_SHOT_PORT: "4317",
      SHUBI_SHOT_RUNTIME_DIR: "runtime-directory",
    });
    expect(
      boundary.createBridgeChildEnvironment(
        5317,
        "bridge-runtime-directory",
        environment,
      ),
    ).toMatchObject({
      PATH: "boundary-path",
      SHUBI_SHOT_PORT: "5317",
      SHUBI_SHOT_RUNTIME_DIR: "bridge-runtime-directory",
    });
    expect(
      boundary.createBrowserChildEnvironment(environment),
    ).toMatchObject({ PATH: "boundary-path" });
  });
});

describe("Director child environments", () => {
  it("copies only OS necessities and approved runtime fields", async () => {
    const boundary = await loadBoundary();
    const source: NodeJS.ProcessEnv = {
      PATH: "boundary-path",
      SystemRoot: "boundary-system-root",
      ComSpec: "boundary-command-shell",
      TEMP: "boundary-temp",
      LANG: "boundary-locale",
      DISPLAY: "boundary-display",
      SHUBI_SHOT_URL: "http://127.1.2.3:4317",
      SHUBI_SHOT_PORT: "4317",
      SHUBI_SHOT_RUNTIME_DIR: "runtime-directory",
      OPENAI_API_KEY: "host-account-marker",
      AZURE_OPENAI_ENDPOINT: "https://host.example.test",
      HTTP_PROXY: "http://127.0.0.1:8001",
      HTTPS_PROXY: "http://127.0.0.1:8002",
      ALL_PROXY: "socks5://127.0.0.1:8003",
      NODE_OPTIONS: "--no-warnings",
      UNRELATED_HOST_MARKER: "must-not-cross",
    };

    const runtime = boundary.createRuntimeChildEnvironment(source);
    expect(runtime).toMatchObject({
      PATH: "boundary-path",
      SystemRoot: "boundary-system-root",
      ComSpec: "boundary-command-shell",
      TEMP: "boundary-temp",
      LANG: "boundary-locale",
      DISPLAY: "boundary-display",
      SHUBI_SHOT_URL: "http://127.1.2.3:4317",
      SHUBI_SHOT_PORT: "4317",
      SHUBI_SHOT_RUNTIME_DIR: "runtime-directory",
    });
    for (const name of [
      "OPENAI_API_KEY",
      "AZURE_OPENAI_ENDPOINT",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NODE_OPTIONS",
      "UNRELATED_HOST_MARKER",
    ]) {
      expect(runtime[name]).toBeUndefined();
    }

    const bridge = boundary.createBridgeChildEnvironment(
      5317,
      "bridge-runtime-directory",
      source,
    );
    expect(bridge.SHUBI_SHOT_PORT).toBe("5317");
    expect(bridge.SHUBI_SHOT_RUNTIME_DIR).toBe(
      "bridge-runtime-directory",
    );
    expect(bridge.SHUBI_SHOT_URL).toBeUndefined();

    const browser = boundary.createBrowserChildEnvironment(source);
    expect(browser.PATH).toBe("boundary-path");
    expect(browser.DISPLAY).toBe("boundary-display");
    expect(browser.SHUBI_SHOT_URL).toBeUndefined();
    expect(browser.NODE_OPTIONS).toBeUndefined();
  });

  it("does not forward host account, model endpoint, proxy, or NODE_OPTIONS markers through the real root launcher", async () => {
    const directory = await createTemporaryDirectory();
    const scriptsDirectory = path.join(directory, "scripts");
    const fakeTsxDirectory = path.join(
      directory,
      "node_modules",
      "tsx",
      "dist",
    );
    const copiedLauncher = path.join(scriptsDirectory, "director.mjs");
    const copiedBoundary = path.join(
      scriptsDirectory,
      "process-boundary.mjs",
    );
    const fakeTsx = path.join(fakeTsxDirectory, "cli.mjs");
    await mkdir(scriptsDirectory, { recursive: true });
    await mkdir(fakeTsxDirectory, { recursive: true });
    await copyFile(directorScript, copiedLauncher);
    await copyFile(processBoundary, copiedBoundary);
    await writeFile(
      fakeTsx,
      `
        const names = [
          "OPENAI_API_KEY",
          "AZURE_OPENAI_ENDPOINT",
          "HTTP_PROXY",
          "HTTPS_PROXY",
          "ALL_PROXY",
          "NODE_OPTIONS",
          "SHUBI_SHOT_URL",
          "SHUBI_SHOT_PORT",
          "SHUBI_SHOT_RUNTIME_DIR"
        ];
        const received = {};
        for (const name of names) {
          received[name] = process.env[name] ?? null;
        }
        process.stdout.write(JSON.stringify(received) + "\\n");
      `,
      "utf8",
    );

    const result = await runProcess(
      process.execPath,
      [copiedLauncher, "doctor"],
      {
        cwd: directory,
        env: createLaunchEnvironment({
          OPENAI_API_KEY: "host-account-marker",
          AZURE_OPENAI_ENDPOINT: "https://host.example.test",
          HTTP_PROXY: "http://127.0.0.1:8001",
          HTTPS_PROXY: "http://127.0.0.1:8002",
          ALL_PROXY: "socks5://127.0.0.1:8003",
          NODE_OPTIONS: "--no-warnings",
          SHUBI_SHOT_URL: "http://127.1.2.3:4317",
          SHUBI_SHOT_PORT: "4317",
          SHUBI_SHOT_RUNTIME_DIR: "runtime-directory",
        }),
      },
    );

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stderr: "",
    });
    expect(parseSingleJsonLine(result.stdout)).toEqual({
      OPENAI_API_KEY: null,
      AZURE_OPENAI_ENDPOINT: null,
      HTTP_PROXY: null,
      HTTPS_PROXY: null,
      ALL_PROXY: null,
      NODE_OPTIONS: null,
      SHUBI_SHOT_URL: "http://127.1.2.3:4317",
      SHUBI_SHOT_PORT: "4317",
      SHUBI_SHOT_RUNTIME_DIR: "runtime-directory",
    });
  });
});

describe("thin launcher preflight ordering", () => {
  it.each([
    [
      "root argument",
      "root",
      ["doctor", "--api-key=ROOT_ARGUMENT_MARKER"],
      {},
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "root credential variant",
      "root",
      ["doctor", "--clientKey", "ROOT_CLIENT_KEY_MARKER"],
      {},
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "root model variant",
      "root",
      ["doctor", "--baseUrl=ROOT_BASE_URL_MARKER"],
      {},
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
    [
      "root environment",
      "root",
      ["doctor"],
      { SHUBI_SHOT_MODEL: "ROOT_ENVIRONMENT_MARKER" },
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
    [
      "direct argument",
      "direct",
      ["doctor", "--endpoint=DIRECT_ARGUMENT_MARKER"],
      {},
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
    [
      "direct credential variant",
      "direct",
      ["doctor", "--runtime_auth=DIRECT_RUNTIME_AUTH_MARKER"],
      {},
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "direct model variant",
      "direct",
      ["doctor", "--provider_options", "DIRECT_PROVIDER_MARKER"],
      {},
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
    [
      "direct environment",
      "direct",
      ["doctor"],
      { SHUBI_SHOT_SECRET: "DIRECT_ENVIRONMENT_MARKER" },
      "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
      "Director credential environment variables are forbidden.",
    ],
  ] as const)(
    "rejects copied %s before an unavailable runtime is loaded",
    async (_label, entryKind, args, environmentOverrides, code, message) => {
      const directory = await createTemporaryDirectory();
      const scriptsDirectory = path.join(directory, "scripts");
      const cliDirectory = path.join(directory, "cli");
      const copiedLauncher = path.join(scriptsDirectory, "director.mjs");
      const copiedBoundary = path.join(
        scriptsDirectory,
        "process-boundary.mjs",
      );
      const copiedCli = path.join(cliDirectory, "director.ts");
      await mkdir(scriptsDirectory, { recursive: true });
      await mkdir(cliDirectory, { recursive: true });
      await copyFile(processBoundary, copiedBoundary);
      await copyFile(directorScript, copiedLauncher);
      await copyFile(directorCli, copiedCli);

      const executableArgs =
        entryKind === "root"
          ? [copiedLauncher, ...args]
          : [tsxCli, copiedCli, ...args];
      const result = await runProcess(process.execPath, executableArgs, {
        cwd: directory,
        env: createLaunchEnvironment(environmentOverrides),
      });

      expect(result).toMatchObject({
        exitCode: 1,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: { code, message },
      });
      expect(result.stdout).not.toContain("MARKER");
      expect(result.stdout).not.toContain(directory);
    },
  );

  it.each([
    ["root", "shot", "create"],
    ["root", "shot", "modify"],
    ["root", "profile", "resolve"],
    ["direct", "shot", "create"],
    ["direct", "shot", "modify"],
    ["direct", "profile", "resolve"],
  ] as const)(
    "keeps copied %s legacy %s %s rejection ahead of trailing boundary markers",
    async (entryKind, command, action) => {
      const directory = await createTemporaryDirectory();
      const scriptsDirectory = path.join(directory, "scripts");
      const cliDirectory = path.join(directory, "cli");
      const copiedLauncher = path.join(scriptsDirectory, "director.mjs");
      const copiedBoundary = path.join(
        scriptsDirectory,
        "process-boundary.mjs",
      );
      const copiedCli = path.join(cliDirectory, "director.ts");
      await mkdir(scriptsDirectory, { recursive: true });
      await mkdir(cliDirectory, { recursive: true });
      await copyFile(processBoundary, copiedBoundary);
      await copyFile(directorScript, copiedLauncher);
      await copyFile(directorCli, copiedCli);

      const args = [
        command,
        action,
        "--api-key=TRAILING_CREDENTIAL_MARKER",
        "--model=TRAILING_MODEL_MARKER",
      ];
      const executableArgs =
        entryKind === "root"
          ? [copiedLauncher, ...args]
          : [tsxCli, copiedCli, ...args];
      const result = await runProcess(process.execPath, executableArgs, {
        cwd: directory,
        env: createLaunchEnvironment({
          SHUBI_SHOT_TOKEN: "TRAILING_ENVIRONMENT_MARKER",
        }),
      });

      expect(result).toMatchObject({
        exitCode: 1,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: {
          code: "HOST_STRUCTURED_INPUT_REQUIRED",
          message:
            "Natural-language requests must be authored by the host as structured submissions.",
        },
      });
      expect(result.stdout).not.toContain("MARKER");
    },
  );
});

describe("direct server preflight ordering", () => {
  it.each([
    [
      "forbidden argument",
      ["--api-key=COPIED_SERVER_ARGUMENT_MARKER"],
      {},
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "credential argument variant",
      ["--auth-header", "COPIED_SERVER_AUTH_HEADER_MARKER"],
      {},
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "model argument variant",
      ["--endpoint_url=COPIED_SERVER_ENDPOINT_MARKER"],
      {},
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
    [
      "forbidden environment",
      [],
      { SHUBI_SHOT_MODEL: "COPIED_SERVER_ENVIRONMENT_MARKER" },
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
  ] as const)(
    "rejects %s before the copied server runtime module is evaluated",
    async (_label, args, environmentOverrides, code, message) => {
      const directory = await createTemporaryDirectory();
      const scriptsDirectory = path.join(directory, "scripts");
      const serverDirectory = path.join(directory, "server");
      const copiedBoundary = path.join(
        scriptsDirectory,
        "process-boundary.mjs",
      );
      const copiedServer = path.join(serverDirectory, "index.ts");
      const markerPath = path.join(directory, "runtime-loaded.txt");
      await mkdir(scriptsDirectory, { recursive: true });
      await mkdir(serverDirectory, { recursive: true });
      await writeFile(
        path.join(directory, "package.json"),
        `${JSON.stringify({ type: "module" })}\n`,
        "utf8",
      );
      await copyFile(processBoundary, copiedBoundary);
      await copyFile(serverEntry, copiedServer);
      await writeFile(
        path.join(serverDirectory, "runtime.ts"),
        `
          import { writeFile } from "node:fs/promises";
          await writeFile(${JSON.stringify(markerPath)}, "loaded", "utf8");
          export const startServer = async (): Promise<void> => undefined;
        `,
        "utf8",
      );

      const result = await runProcess(
        process.execPath,
        [tsxCli, copiedServer, ...args],
        {
          cwd: directory,
          env: createLaunchEnvironment(environmentOverrides),
        },
      );

      expect(result).toMatchObject({
        exitCode: 1,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: { code, message },
      });
      expect(result.stdout).not.toContain("MARKER");
      expect(result.stdout).not.toContain(directory);
      await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("loads the copied server runtime only after boundary preflight succeeds", async () => {
    const directory = await createTemporaryDirectory();
    const scriptsDirectory = path.join(directory, "scripts");
    const serverDirectory = path.join(directory, "server");
    const markerPath = path.join(directory, "runtime-loaded.txt");
    await mkdir(scriptsDirectory, { recursive: true });
    await mkdir(serverDirectory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      `${JSON.stringify({ type: "module" })}\n`,
      "utf8",
    );
    await copyFile(
      processBoundary,
      path.join(scriptsDirectory, "process-boundary.mjs"),
    );
    await copyFile(serverEntry, path.join(serverDirectory, "index.ts"));
    await writeFile(
      path.join(serverDirectory, "runtime.ts"),
      `
        import { writeFile } from "node:fs/promises";
        await writeFile(${JSON.stringify(markerPath)}, "loaded", "utf8");
        export const startServer = async (options: { production: boolean }): Promise<void> => {
          throw new Error("SENTINEL_RUNTIME_STARTED:" + String(options.production));
        };
      `,
      "utf8",
    );

    const result = await runProcess(
      process.execPath,
      [tsxCli, path.join(serverDirectory, "index.ts"), "--production"],
      {
        cwd: directory,
        env: createLaunchEnvironment({ SHUBI_SHOT_PORT: "0" }),
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "SENTINEL_RUNTIME_STARTED:true\n",
    });
    await expect(readFile(markerPath, "utf8")).resolves.toBe("loaded");
  });

  it.each([
    [
      "--api-key=SERVER_CREDENTIAL_MARKER",
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "--token",
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "--model=SERVER_MODEL_MARKER",
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
    [
      "--endpoint",
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
  ] as const)(
    "rejects forbidden server argument %s before port and production handling",
    async (argument, code, message) => {
      const args = argument.includes("=")
        ? [tsxCli, serverEntry, argument]
        : [
            tsxCli,
            serverEntry,
            argument,
            "SERVER_TRAILING_MARKER",
          ];
      const result = await runProcess(process.execPath, args, {
        env: createLaunchEnvironment({ SHUBI_SHOT_PORT: "0" }),
      });

      expect(result).toMatchObject({
        exitCode: 1,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: { code, message },
      });
      expect(result.stdout).not.toContain("MARKER");
      expect(result.stdout).not.toContain(repositoryRoot);
    },
  );

  it("keeps --production available to the direct server entry", async () => {
    const result = await runProcess(
      process.execPath,
      [tsxCli, serverEntry, "--production"],
      {
        env: createLaunchEnvironment({ SHUBI_SHOT_PORT: "0" }),
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "The configured bridge port is invalid.\n",
    });
  });
});
