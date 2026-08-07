import type { SpawnOptions } from "node:child_process";
import path from "node:path";

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

const quoteWindowsArgument = (argument: string): string => {
  if (argument.includes("\0")) {
    throw new Error("Background process arguments cannot contain NUL.");
  }
  if (argument.length === 0) {
    return '""';
  }
  if (!/[\s"]/u.test(argument)) {
    return argument;
  }

  let result = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + "\\".repeat(backslashes * 2) + '"';
};

const createWindowsEncodedCommand = (
  request: BackgroundProcessRequest,
): string => {
  const payload = Buffer.from(
    JSON.stringify({
      executable: request.executable,
      argumentLine: request.args.map(quoteWindowsArgument).join(" "),
      cwd: request.cwd,
    }),
    "utf8",
  ).toString("base64");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    "$process = Start-Process -FilePath $payload.executable -ArgumentList $payload.argumentLine -WorkingDirectory $payload.cwd -WindowStyle Hidden -PassThru",
    "if ($null -eq $process) { exit 1 }",
  ].join("\r\n");
  return Buffer.from(command, "utf16le").toString("base64");
};

const resolveWindowsPowerShell = (environment: NodeJS.ProcessEnv): string => {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  return systemRoot === undefined
    ? "powershell.exe"
    : path.win32.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
};

export const createBackgroundProcessLaunch = (
  request: BackgroundProcessRequest,
  platform: NodeJS.Platform = process.platform,
): BackgroundProcessLaunch => {
  const options: SpawnOptions = {
    cwd: request.cwd,
    env: request.env,
    detached: platform !== "win32",
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  };
  if (platform !== "win32") {
    return {
      executable: request.executable,
      args: [...request.args],
      options,
    };
  }

  return {
    executable: resolveWindowsPowerShell(request.env),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      createWindowsEncodedCommand(request),
    ],
    options,
  };
};
