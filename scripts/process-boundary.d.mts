export type BoundaryErrorCode =
  | "CREDENTIAL_ARGUMENT_FORBIDDEN"
  | "MODEL_CONFIGURATION_FORBIDDEN"
  | "CREDENTIAL_ENVIRONMENT_FORBIDDEN"
  | "MODEL_CONFIGURATION_ENVIRONMENT_FORBIDDEN";

export class BoundaryError extends Error {
  readonly code: BoundaryErrorCode;
  constructor(code: BoundaryErrorCode, message?: string);
}

export function assertNoForbiddenDirectorArguments(
  args: readonly string[],
): void;

export function assertNoForbiddenDirectorEnvironment(
  env?: NodeJS.ProcessEnv,
): void;

export function createRuntimeChildEnvironment(
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export function createBridgeChildEnvironment(
  port: number,
  runtimeDir?: string,
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export function createBrowserChildEnvironment(
  env?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
