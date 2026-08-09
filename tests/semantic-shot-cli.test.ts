import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "../server/api";
import { SceneSession } from "../server/scene-session";
import { createDefaultScene } from "../src/domain/default-scene";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const directorScript = fileURLToPath(new URL("../scripts/director.mjs", import.meta.url));
const flagshipSubmission = fileURLToPath(
  new URL("../examples/semantic-shot-flagship.shot-submission.json", import.meta.url),
);
const temporaryDirectories: string[] = [];

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface CandidateSummary {
  candidateId: string;
  renderStatus: "pending" | "pass" | "fail";
}

interface SolveSummary {
  solveId: string;
  generation: number;
  candidates: CandidateSummary[];
}

interface PublicCandidate {
  candidateId: string;
  sceneSha256: string;
}

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
    server.close((error) => error ? reject(error) : resolve());
  });

const runDirector = (args: string[], bridgeUrl: string): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      SHUBI_SHOT_URL: bridgeUrl,
    };
    delete environment.SHUBI_SHOT_PORT;
    const child = spawn(process.execPath, [directorScript, ...args], {
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
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });

const parseCli = <T>(result: CliResult): T => {
  if (result.exitCode !== 0 || result.stderr !== "") {
    throw new Error(`CLI failed: ${JSON.stringify(result)}`);
  }
  const lines = result.stdout.split(/\r?\n/);
  expect(lines).toHaveLength(2);
  return JSON.parse(lines[0] ?? "") as T;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("semantic shot CLI lifecycle", () => {
  it("solves, revises, reports renderer status, and accepts through the structured bridge", async () => {
    const session = new SceneSession(createDefaultScene());
    const app = createApiApp(session, {
      uiUrl: "http://127.0.0.1:5173",
      instanceId: "instance_0123456789abcdef0123456789abcdef",
      requestShutdown: () => undefined,
    });
    const server = createServer(app);
    const port = await listenOnLoopback(server);
    const bridgeUrl = `http://127.0.0.1:${port}`;
    try {
      const solved = parseCli<{ ok: true; data: SolveSummary }>(
        await runDirector(["shot", "solve", "--file", flagshipSubmission], bridgeUrl),
      );
      expect(solved.data.generation).toBe(0);
      expect(solved.data.candidates).toHaveLength(3);
      expect(solved.data.candidates.every(({ renderStatus }) => renderStatus === "pending")).toBe(true);

      const directory = await mkdtemp(path.join(os.tmpdir(), "shot-semantic-cli-"));
      temporaryDirectories.push(directory);
      const patchPath = path.join(directory, "semantic-revision.json");
      await writeFile(patchPath, JSON.stringify({
        schemaVersion: 1,
        patchId: "patch_semantic_cli_high_1",
        solveId: solved.data.solveId,
        baseGeneration: 0,
        operations: [
          {
            op: "soft-preference.set",
            value: {
              id: "flagship_camera_low_1",
              kind: "camera-height",
              tendency: "high",
              weight: 1,
            },
          },
        ],
      }), "utf8");
      const revised = parseCli<{ ok: true; data: SolveSummary }>(
        await runDirector(["shot", "revise", "--file", patchPath], bridgeUrl),
      );
      expect(revised.data.generation).toBe(1);

      const currentResponse = await fetch(`${bridgeUrl}/api/v1/shot-solves/current`);
      const currentEnvelope = await currentResponse.json() as {
        data: { solve: { solveId: string; candidates: PublicCandidate[] } };
      };
      const candidate = currentEnvelope.data.solve.candidates[0];
      const verifyResponse = await fetch(
        `${bridgeUrl}/api/v1/shot-solves/${currentEnvelope.data.solve.solveId}/candidates/${candidate.candidateId}/verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            solveId: currentEnvelope.data.solve.solveId,
            candidateId: candidate.candidateId,
            sceneSha256: candidate.sceneSha256,
            width: 320,
            height: 180,
            entities: [{
              entityId: "actor_generic_1",
              visiblePixelCount: 900,
              isolatedPixelCount: 1_000,
              boundsPx: { minX: 80, minY: 8, maxX: 240, maxY: 172 },
              centerDepthM: 3,
            }],
            actorParts: [{
              actorId: "actor_generic_1",
              partId: "head",
              visiblePixelCount: 90,
              isolatedPixelCount: 100,
              boundsPx: { minX: 140, minY: 8, maxX: 180, maxY: 42 },
              centerDepthM: 3,
            }],
          }),
        },
      );
      expect(verifyResponse.status).toBe(200);

      const candidates = parseCli<{ ok: true; data: SolveSummary }>(
        await runDirector(["shot", "candidates"], bridgeUrl),
      );
      expect(candidates.data.candidates.find(
        ({ candidateId }) => candidateId === candidate.candidateId,
      )?.renderStatus).toBe("pass");

      const accepted = parseCli<{
        ok: true;
        data: { action: string; candidateId: string; sceneId: string; revision: number };
      }>(await runDirector(["shot", "accept", "--candidate", candidate.candidateId], bridgeUrl));
      expect(accepted.data).toMatchObject({
        action: "accept",
        candidateId: candidate.candidateId,
        sceneId: "scene_semantic_flagship_1",
        revision: 1,
      });

      expect(parseCli<{ ok: true; data: { solve: null } }>(
        await runDirector(["shot", "candidates"], bridgeUrl),
      ).data.solve).toBeNull();
    } finally {
      await closeServer(server);
    }
  }, 30_000);
});
