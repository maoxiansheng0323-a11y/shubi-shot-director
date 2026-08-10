import type { SpawnOptions } from "node:child_process";

export interface BackgroundProcessRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface BackgroundProcessLaunch {
  executable: string;
  args: string[];
  options: SpawnOptions;
}

export const createBackgroundProcessLaunch = (
  request: BackgroundProcessRequest,
  _platform: NodeJS.Platform = process.platform,
): BackgroundProcessLaunch => {
  const options: SpawnOptions = {
    cwd: request.cwd,
    env: request.env,
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  };
  return {
    executable: request.executable,
    args: [...request.args],
    options,
  };
};
