import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeCapabilityManifest } from "../cli/runtime-capabilities";
import {
  createSkillRuntimeFixture,
  type SkillRuntimeFixture,
} from "./helpers/skill-runtime-fixture";

const threadA = "11111111-1111-4111-8111-111111111111";
const threadB = "22222222-2222-4222-8222-222222222222";
const workspaceIdPattern = /^workspace_[0-9a-f]{32}$/u;
const fixtures: SkillRuntimeFixture[] = [];

const createFixture = async () => {
  const fixture = await createSkillRuntimeFixture({
    doctorData: { ...getRuntimeCapabilityManifest() },
  });
  fixtures.push(fixture);
  return fixture;
};

const parseEnvelope = (stdout: string) =>
  JSON.parse(stdout) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };

const runJson = async (
  fixture: SkillRuntimeFixture,
  args: string[],
  environment: NodeJS.ProcessEnv,
) => {
  const result = await fixture.run(args, { environment });
  return { result, envelope: parseEnvelope(result.stdout) };
};

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

describe("Skill thread workspace routing", () => {
  it("routes two Codex threads to distinct ports and runtime directories", async () => {
    const fixture = await createFixture();

    const first = await runJson(fixture, ["ensure"], {
      CODEX_THREAD_ID: threadA,
    });
    const second = await runJson(fixture, ["ensure"], {
      CODEX_THREAD_ID: threadB,
    });

    expect(first.result.exitCode).toBe(0);
    expect(second.result.exitCode).toBe(0);
    const observations = await fixture.readEnvironmentObservations();
    const ensureObservations = observations.filter(
      ({ action }) => action === "ensure",
    );
    expect(ensureObservations).toHaveLength(2);
    const firstEnvironment = ensureObservations[0]?.workspaceEnvironment;
    const secondEnvironment = ensureObservations[1]?.workspaceEnvironment;
    expect(firstEnvironment?.port).toMatch(/^\d+$/u);
    expect(secondEnvironment?.port).toMatch(/^\d+$/u);
    expect(firstEnvironment?.port).not.toBe(secondEnvironment?.port);
    expect(firstEnvironment?.runtimeDirectory).not.toBe(
      secondEnvironment?.runtimeDirectory,
    );
    expect(firstEnvironment?.url).toBeUndefined();
    expect(secondEnvironment?.url).toBeUndefined();
    expect(JSON.stringify(observations)).not.toContain(threadA);
    expect(JSON.stringify(observations)).not.toContain(threadB);
    expect(
      observations.every(
        ({ presentDeniedNames }) =>
          !presentDeniedNames.includes("CODEX_THREAD_ID"),
      ),
    ).toBe(true);
  });

  it("reports the stable current workspace without exposing the raw thread ID", async () => {
    const fixture = await createFixture();

    const { result, envelope } = await runJson(
      fixture,
      ["workspace", "current"],
      { CODEX_THREAD_ID: threadA },
    );

    expect(result.exitCode).toBe(0);
    expect(envelope).toMatchObject({
      ok: true,
      data: {
        workspaceId: expect.stringMatching(workspaceIdPattern),
        source: "thread",
        port: expect.any(Number),
        status: "starting",
      },
    });
    expect(JSON.stringify(envelope)).not.toContain(threadA);
    expect(await fixture.readActionIds()).toEqual([]);
  });

  it("marks a successful ensure ready but lists unproven synthetic routes as stopped", async () => {
    const fixture = await createFixture();
    await runJson(fixture, ["ensure"], { CODEX_THREAD_ID: threadA });
    await runJson(fixture, ["ensure"], { CODEX_THREAD_ID: threadB });
    const current = await runJson(
      fixture,
      ["workspace", "current"],
      { CODEX_THREAD_ID: threadA },
    );
    expect(current.envelope).toMatchObject({
      ok: true,
      data: {
        workspaceId: expect.stringMatching(workspaceIdPattern),
        status: "ready",
      },
    });

    const { envelope } = await runJson(
      fixture,
      ["workspace", "list"],
      { CODEX_THREAD_ID: threadA },
    );

    expect(envelope.ok).toBe(true);
    const workspaces = envelope.data?.workspaces as Array<
      Record<string, unknown>
    >;
    expect(workspaces).toHaveLength(2);
    expect(workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: expect.stringMatching(workspaceIdPattern),
          port: expect.any(Number),
          status: "stopped",
        }),
      ]),
    );
    expect(JSON.stringify(envelope)).not.toContain(threadA);
    expect(JSON.stringify(envelope)).not.toContain(threadB);
  });

  it("attaches only the current thread to an existing workspace", async () => {
    const fixture = await createFixture();
    const target = await runJson(
      fixture,
      ["workspace", "current"],
      { CODEX_THREAD_ID: threadB },
    );
    const targetWorkspaceId = target.envelope.data?.workspaceId as string;

    const attached = await runJson(
      fixture,
      ["workspace", "attach", "--id", targetWorkspaceId],
      { CODEX_THREAD_ID: threadA },
    );
    const current = await runJson(
      fixture,
      ["workspace", "current"],
      { CODEX_THREAD_ID: threadA },
    );

    expect(attached.envelope).toMatchObject({
      ok: true,
      data: {
        workspaceId: targetWorkspaceId,
        attached: true,
      },
    });
    expect(current.envelope).toMatchObject({
      ok: true,
      data: {
        workspaceId: targetWorkspaceId,
        source: "binding",
      },
    });
  });

  it("rejects attach outside a Codex thread with a stable error", async () => {
    const fixture = await createFixture();

    const { result, envelope } = await runJson(
      fixture,
      [
        "workspace",
        "attach",
        "--id",
        "workspace_0123456789abcdef0123456789abcdef",
      ],
      { CODEX_THREAD_ID: "" },
    );

    expect(result.exitCode).toBe(1);
    expect(envelope).toEqual({
      ok: false,
      error: {
        code: "WORKSPACE_THREAD_ID_UNAVAILABLE",
        message: "A Codex thread is required for workspace attachment.",
      },
    });
  });

  it("preserves the legacy explicit runtime environment without a thread ID", async () => {
    const fixture = await createFixture();
    const runtimeDirectory = `${fixture.runtimeRoot}-legacy`;

    const { result } = await runJson(fixture, ["ensure"], {
      CODEX_THREAD_ID: "",
      SHUBI_SHOT_PORT: "4399",
      SHUBI_SHOT_RUNTIME_DIR: runtimeDirectory,
      SHUBI_SHOT_URL: "http://127.0.0.1:4399",
    });

    expect(result.exitCode).toBe(0);
    const observations = await fixture.readEnvironmentObservations();
    expect(observations.at(-1)?.workspaceEnvironment).toEqual({
      port: "4399",
      runtimeDirectory,
      url: "http://127.0.0.1:4399",
    });
  });
});
