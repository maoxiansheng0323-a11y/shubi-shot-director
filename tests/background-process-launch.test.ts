import { describe, expect, it } from "vitest";
import { createBackgroundProcessLaunch } from "../cli/background-process-launch";

const request = {
  executable: "runtime tools\\node.exe",
  args: [
    "fixture root\\repo with spaces\\node_modules\\tsx\\dist\\cli.mjs",
    "fixture root\\repo with spaces\\server\\index.ts",
  ],
  cwd: "fixture root\\repo with spaces",
  env: {
    PATH: "system root\\System32",
    SystemRoot: "system root",
    SHUBI_SHOT_PORT: "4317",
  },
};

describe("background process launch", () => {
  it("launches the hidden bridge directly as a detached process on Windows", () => {
    const launch = createBackgroundProcessLaunch(request, "win32");

    expect(launch).toEqual({
      executable: request.executable,
      args: request.args,
      options: {
        cwd: request.cwd,
        env: request.env,
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    });
  });

  it("keeps direct detached launch behavior on non-Windows platforms", () => {
    const launch = createBackgroundProcessLaunch(request, "linux");

    expect(launch).toEqual({
      executable: request.executable,
      args: request.args,
      options: {
        cwd: request.cwd,
        env: request.env,
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    });
  });
});
