import path from "node:path";
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
  it("uses a hidden PowerShell launcher instead of a detached console on Windows", () => {
    const launch = createBackgroundProcessLaunch(request, "win32");

    expect(launch).toMatchObject({
      executable: path.win32.join(
        "system root",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        expect.any(String),
      ],
      options: {
        cwd: request.cwd,
        env: request.env,
        detached: false,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    });

    const encodedCommand = launch.args.at(-1);
    expect(encodedCommand).toBeDefined();
    const command = Buffer.from(encodedCommand ?? "", "base64").toString(
      "utf16le",
    );
    expect(command).toContain("Start-Process");
    expect(command).toContain("-WindowStyle Hidden");
    expect(command).not.toContain(request.executable);
    expect(command).not.toContain(request.cwd);
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
