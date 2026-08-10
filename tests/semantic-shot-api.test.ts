import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../server/api";
import { SceneSession } from "../server/scene-session";
import { createDefaultScene } from "../src/domain/default-scene";
import { createFlagshipShotSubmission } from "./helpers/semantic-shot-fixtures";

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

const requestJson = async (
  port: number,
  pathname: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<{ status: number; body: any }> => {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return { status: response.status, body: await response.json() };
};

describe("semantic shot API lifecycle", () => {
  it("keeps solves transient and accepts exactly one renderer-verified candidate", async () => {
    const initial = createDefaultScene();
    const session = new SceneSession(initial);
    const app = createApiApp(session, {
      uiUrl: "http://127.0.0.1:5173",
      instanceId: "instance_0123456789abcdef0123456789abcdef",
      requestShutdown: () => undefined,
    });
    const server = createServer(app);
    const port = await listenOnLoopback(server);
    try {
      const solved = await requestJson(
        port,
        "/api/v1/shot-solves",
        "POST",
        createFlagshipShotSubmission(),
      );
      expect(solved.status).toBe(200);
      const solve = solved.body.data.solve;
      expect(solve.candidates).toHaveLength(3);
      expect(session.snapshot()).toEqual(initial);

      const current = await requestJson(port, "/api/v1/shot-solves/current");
      expect(current.body.data.solve.solveId).toBe(solve.solveId);

      const candidate = solve.candidates[0];
      const premature = await requestJson(
        port,
        `/api/v1/shot-solves/${solve.solveId}/accept`,
        "POST",
        { candidateId: candidate.candidateId },
      );
      expect(premature).toMatchObject({
        status: 400,
        body: { error: { code: "SHOT_CANDIDATE_NOT_VERIFIED" } },
      });

      const verified = await requestJson(
        port,
        `/api/v1/shot-solves/${solve.solveId}/candidates/${candidate.candidateId}/verification`,
        "POST",
        {
          schemaVersion: 1,
          solveId: solve.solveId,
          candidateId: candidate.candidateId,
          sceneSha256: candidate.sceneSha256,
          width: 320,
          height: 180,
          entities: [
            {
              entityId: "actor_generic_1",
              visiblePixelCount: 900,
              isolatedPixelCount: 1_000,
              boundsPx: { minX: 80, minY: 8, maxX: 240, maxY: 172 },
              centerDepthM: 3,
            },
          ],
          actorParts: [
            {
              actorId: "actor_generic_1",
              partId: "head",
              visiblePixelCount: 90,
              isolatedPixelCount: 100,
              boundsPx: { minX: 140, minY: 8, maxX: 180, maxY: 42 },
              centerDepthM: 3,
            },
          ],
        },
      );
      expect(verified.status).toBe(200);
      expect(
        verified.body.data.solve.candidates.find(
          (entry: { candidateId: string }) => entry.candidateId === candidate.candidateId,
        ).renderVerification.status,
      ).toBe("pass");

      const accepted = await requestJson(
        port,
        `/api/v1/shot-solves/${solve.solveId}/accept`,
        "POST",
        { candidateId: candidate.candidateId },
      );
      expect(accepted).toMatchObject({
        status: 200,
        body: {
          data: {
            scene: {
              sceneId: "scene_semantic_flagship_1",
              revision: initial.revision + 1,
            },
            acceptedCandidateId: candidate.candidateId,
          },
        },
      });
      expect((await requestJson(port, "/api/v1/shot-solves/current")).body.data.solve).toBeNull();
    } finally {
      await closeServer(server);
    }
  }, 20_000);
});
