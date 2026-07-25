import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorScript = fileURLToPath(
  new URL("../scripts/director.mjs", import.meta.url),
);

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

interface CliResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const getUnusedLoopbackPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return address.port;
};

const runDirector = (
  args: string[],
  port: number,
  overrides: NodeJS.ProcessEnv = {},
): Promise<CliResult> => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    SHUBI_SHOT_PORT: String(port),
  };
  delete environment.SHUBI_SHOT_URL;
  for (const name of DIRECTOR_OWNED_ENVIRONMENT) {
    delete environment[name];
  }
  Object.assign(environment, overrides);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [directorScript, ...args],
      {
        cwd: repositoryRoot,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
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
};

const parseSingleJsonLine = (stdout: string): unknown => {
  const lines = stdout.split(/\r?\n/);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  return JSON.parse(lines[0] ?? "") as unknown;
};

const nodeVersionSupported = (): boolean => {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((part) => Number(part));
  return major > 22 || (major === 22 && minor >= 12);
};

describe("director doctor", () => {
  it("prints one offline runtime manifest and leaves the bridge stopped", async () => {
    const port = await getUnusedLoopbackPort();
    try {
      const result = await runDirector(["doctor"], port);

      expect(result).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: true,
        data: {
          ...getRuntimeCapabilityManifest(),
          nodeVersion: process.versions.node,
          nodeSupported: nodeVersionSupported(),
          bridgeConfiguration: "loopback",
        },
      });

      const status = await runDirector(["status"], port);
      expect(status).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(status.stdout)).toMatchObject({
        ok: true,
        data: { status: "stopped" },
      });
    } finally {
      await runDirector(["stop"], port);
    }
  }, 20_000);

  it("rejects extra arguments without starting a bridge", async () => {
    const port = await getUnusedLoopbackPort();
    try {
      const result = await runDirector(
        ["doctor", "--unexpected"],
        port,
      );

      expect(result).toMatchObject({
        exitCode: 1,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(result.stdout)).toEqual({
        ok: false,
        error: {
          code: "CLI_UNKNOWN_ARGUMENT",
          message: "This command does not accept additional arguments.",
        },
      });

      const status = await runDirector(["status"], port);
      expect(status).toMatchObject({
        exitCode: 0,
        signal: null,
        stderr: "",
      });
      expect(parseSingleJsonLine(status.stdout)).toMatchObject({
        ok: true,
        data: { status: "stopped" },
      });
    } finally {
      await runDirector(["stop"], port);
    }
  }, 20_000);

  it.each([
    [
      "--api-key=DOCTOR_CREDENTIAL_MARKER",
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "--token",
      "CREDENTIAL_ARGUMENT_FORBIDDEN",
      "Credential arguments are forbidden.",
    ],
    [
      "--model=DOCTOR_MODEL_MARKER",
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
    [
      "--endpoint",
      "MODEL_CONFIGURATION_FORBIDDEN",
      "Model configuration arguments are forbidden.",
    ],
  ] as const)(
    "rejects forbidden public argument %s before doctor runtime work",
    async (argument, code, message) => {
      const port = await getUnusedLoopbackPort();
      const args = argument.includes("=")
        ? ["doctor", argument]
        : ["doctor", argument, "DOCTOR_TRAILING_MARKER"];
      const result = await runDirector(args, port);

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
    },
  );

  it.each([
    [
      "SHUBI_SHOT_API_KEY",
      "CREDENTIAL_ENVIRONMENT_FORBIDDEN",
      "Director credential environment variables are forbidden.",
    ],
    [
      "SHUBI_SHOT_PROVIDER",
      "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN",
      "Director model configuration environment variables are forbidden.",
    ],
  ] as const)(
    "rejects Director-owned environment variable %s before doctor runtime work",
    async (name, code, message) => {
      const port = await getUnusedLoopbackPort();
      const result = await runDirector(["doctor"], port, {
        [name]: "DOCTOR_ENVIRONMENT_MARKER",
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
    },
  );

  it("does not treat ambient host account, endpoint, or proxy variables as Director configuration", async () => {
    const port = await getUnusedLoopbackPort();
    const result = await runDirector(["doctor"], port, {
      OPENAI_API_KEY: "host-account-marker",
      AZURE_OPENAI_ENDPOINT: "https://host.example.test",
      HTTP_PROXY: "http://127.0.0.1:8001",
      HTTPS_PROXY: "http://127.0.0.1:8002",
      ALL_PROXY: "socks5://127.0.0.1:8003",
      NODE_OPTIONS: "--no-warnings",
    });

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      stderr: "",
    });
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      ok: true,
      data: { semanticAuthority: "host", modelIntegration: "none" },
    });
  }, 20_000);
});
