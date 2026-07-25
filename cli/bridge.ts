import { spawn } from "node:child_process";
import path from "node:path";
import {
  assertNoForbiddenDirectorEnvironment,
  createBridgeChildEnvironment,
} from "../scripts/process-boundary.mjs";
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SERVICE,
  getRuntimeCapabilityManifest,
  parseRuntimeCapabilityManifest,
  RuntimeCapabilityError,
  type RuntimeCapabilityManifest,
} from "./runtime-capabilities";

export { BRIDGE_PROTOCOL_VERSION, BRIDGE_SERVICE };
export const DEFAULT_BRIDGE_PORT = 4317;

export interface JsonEnvelope {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface BridgeHealth extends RuntimeCapabilityManifest {
  status: "ready";
  sceneId: string;
  revision: number;
  uiUrl: string;
  instanceId?: string;
}

export interface BridgeConfiguration {
  baseUrl: URL;
  port: number;
  readonly originSource: string;
  runtimeDirectory?: string;
}

export class BridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

const safeBridgeMessage = (code: string): string => {
  switch (code) {
    case "BRIDGE_IDENTITY_MISMATCH":
      return "The loopback service did not identify itself as Shubi Shot Director.";
    case "CAPABILITIES_CONTRACT_UNSUPPORTED":
      return "The local bridge capability contract is unsupported.";
    case "CAPABILITIES_INVALID":
      return "The local bridge capabilities are invalid.";
    case "SEMANTIC_BOUNDARY_VIOLATION":
      return "The local bridge violates the host semantic boundary.";
    case "BRIDGE_PROTOCOL_UNSUPPORTED":
      return "The local bridge protocol is unsupported.";
    case "SCENE_SCHEMA_UNSUPPORTED":
      return "The local bridge SceneSpec schema is unsupported.";
    case "PATCH_SCHEMA_UNSUPPORTED":
      return "The local bridge ScenePatch schema is unsupported.";
    case "INTENT_REPORT_SCHEMA_UNSUPPORTED":
      return "The local bridge IntentReport schema is unsupported.";
    case "STALE_REVISION":
      return "The scene revision is stale.";
    case "SCHEMA_VALIDATION_FAILED":
      return "Scene data failed schema validation.";
    case "ENTITY_NOT_FOUND":
      return "A requested scene entity was not found.";
    case "ENTITY_LOCKED":
      return "A requested scene entity is locked.";
    case "CONTACT_CONSTRAINT_ACTIVE":
      return "An active contact constraint prevents this change.";
    case "EXPORT_PREVIEW_UNAVAILABLE":
      return "Open the browser Shot Preview before exporting PNG.";
    case "EXPORT_PREVIEW_TIMEOUT":
      return "The browser Shot Preview did not finish the PNG export.";
    case "EXPORT_PREVIEW_REVISION_MISMATCH":
      return "The scene revision changed during PNG export.";
    case "EXPORT_PREVIEW_FAILED":
    case "EXPORT_PREVIEW_INVALID":
      return "The browser Shot Preview could not export the PNG.";
    default:
      return "The local bridge rejected the request.";
  }
};

const parsePort = (source: string | undefined): number => {
  if (source === undefined || source === "") {
    return DEFAULT_BRIDGE_PORT;
  }
  if (!/^[1-9][0-9]*$/.test(source)) {
    throw new BridgeError(
      "BRIDGE_CONFIGURATION_INVALID",
      "The configured bridge port is invalid.",
    );
  }
  const port = Number(source);
  if (!Number.isInteger(port) || port > 65_535) {
    throw new BridgeError(
      "BRIDGE_CONFIGURATION_INVALID",
      "The configured bridge port is invalid.",
    );
  }
  return port;
};

const strictIpv4LoopbackHost = (hostname: string): boolean => {
  const match =
    /^(127)\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/u.exec(
      hostname,
    );
  return (
    match !== null &&
    Number(match[2]) <= 255 &&
    Number(match[3]) <= 255 &&
    Number(match[4]) <= 255
  );
};

const isNumericLoopbackHost = (hostname: string): boolean =>
  hostname === "[::1]" || strictIpv4LoopbackHost(hostname);

const parseStrictLoopbackOriginSource = (
  source: string,
): { hostname: string; port: number } | null => {
  const match =
    /^http:\/\/(\[::1\]|[^/:?#]+):([1-9][0-9]{0,4})(?:\/)?$/u.exec(
      source,
    );
  if (match === null || !isNumericLoopbackHost(match[1])) {
    return null;
  }
  const port = Number(match[2]);
  return port <= 65_535 ? { hostname: match[1], port } : null;
};

const effectiveUrlPort = (parsed: URL): number =>
  parsed.port === "" ? 80 : Number(parsed.port);

const isLoopbackOriginUrl = (parsed: URL): boolean =>
  parsed.protocol === "http:" &&
  isNumericLoopbackHost(parsed.hostname) &&
  parsed.username === "" &&
  parsed.password === "" &&
  (parsed.pathname === "" || parsed.pathname === "/") &&
  parsed.search === "" &&
  parsed.hash === "";

const isUncredentialedLoopbackOrigin = (
  source: string,
  parsed: URL,
): boolean => {
  const strictSource = parseStrictLoopbackOriginSource(source);
  return (
    strictSource !== null &&
    isLoopbackOriginUrl(parsed) &&
    parsed.hostname === strictSource.hostname &&
    effectiveUrlPort(parsed) === strictSource.port
  );
};

const bridgeUrlNotLoopbackError = (): BridgeError =>
  new BridgeError(
    "BRIDGE_URL_NOT_LOOPBACK",
    "The bridge URL must be an uncredentialed loopback HTTP origin.",
  );

const resolveLoopbackRequestUrl = (
  configuration: BridgeConfiguration,
  pathname: string,
): URL => {
  const baseUrl = configuration.baseUrl;
  const originSource = configuration.originSource;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(originSource);
  } catch {
    throw bridgeUrlNotLoopbackError();
  }
  const strictSource = parseStrictLoopbackOriginSource(originSource);
  if (
    strictSource === null ||
    !isUncredentialedLoopbackOrigin(originSource, sourceUrl) ||
    !isLoopbackOriginUrl(baseUrl) ||
    sourceUrl.origin !== baseUrl.origin ||
    sourceUrl.hostname !== baseUrl.hostname ||
    strictSource.hostname !== baseUrl.hostname ||
    !Number.isInteger(configuration.port) ||
    configuration.port < 1 ||
    configuration.port > 65_535 ||
    strictSource.port !== configuration.port ||
    effectiveUrlPort(sourceUrl) !== configuration.port ||
    effectiveUrlPort(baseUrl) !== configuration.port
  ) {
    throw bridgeUrlNotLoopbackError();
  }
  let requestUrl: URL;
  try {
    requestUrl = new URL(pathname, baseUrl);
  } catch {
    throw bridgeUrlNotLoopbackError();
  }
  if (
    requestUrl.origin !== baseUrl.origin ||
    requestUrl.protocol !== "http:" ||
    !isNumericLoopbackHost(requestUrl.hostname) ||
    requestUrl.username !== "" ||
    requestUrl.password !== ""
  ) {
    throw bridgeUrlNotLoopbackError();
  }
  return requestUrl;
};

export const resolveBridgeConfiguration = (
  environment: NodeJS.ProcessEnv = process.env,
): BridgeConfiguration => {
  assertNoForbiddenDirectorEnvironment(environment);
  const configuredUrl = environment.SHUBI_SHOT_URL;
  const port = parsePort(environment.SHUBI_SHOT_PORT);
  const source = configuredUrl ?? `http://127.0.0.1:${port}`;
  let baseUrl: URL;
  try {
    baseUrl = new URL(source);
  } catch {
    throw new BridgeError(
      "BRIDGE_CONFIGURATION_INVALID",
      "The configured bridge URL is invalid.",
    );
  }

  if (!isUncredentialedLoopbackOrigin(source, baseUrl)) {
    throw bridgeUrlNotLoopbackError();
  }

  const resolvedPort = parsePort(
    baseUrl.port ||
      (baseUrl.protocol === "http:" ? "80" : undefined),
  );
  baseUrl.pathname = "";
  return {
    baseUrl,
    port: resolvedPort,
    originSource: source,
    ...(environment.SHUBI_SHOT_RUNTIME_DIR === undefined
      ? {}
      : { runtimeDirectory: environment.SHUBI_SHOT_RUNTIME_DIR }),
  };
};

export const bridgeConfigurationIsLoopback = (
  environment: NodeJS.ProcessEnv = process.env,
): boolean => {
  try {
    resolveBridgeConfiguration(environment);
    return true;
  } catch {
    return false;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const validateLoopbackUiUrl = (source: unknown): string => {
  if (typeof source !== "string") {
    throw new BridgeError(
      "CAPABILITIES_INVALID",
      safeBridgeMessage("CAPABILITIES_INVALID"),
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new BridgeError(
      "CAPABILITIES_INVALID",
      safeBridgeMessage("CAPABILITIES_INVALID"),
    );
  }
  if (!isUncredentialedLoopbackOrigin(source, parsed)) {
    throw new BridgeError(
      "CAPABILITIES_INVALID",
      safeBridgeMessage("CAPABILITIES_INVALID"),
    );
  }
  return parsed.origin;
};

const throwBridgeCompatibilityError = (code: string): never => {
  throw new BridgeError(code, safeBridgeMessage(code));
};

const stringSetsEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length &&
  left.every((value) => right.includes(value));

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const validateBridgeHealth = (
  input: unknown,
  expected: RuntimeCapabilityManifest = getRuntimeCapabilityManifest(),
): BridgeHealth => {
  if (
    !isObject(input) ||
    input.service !== BRIDGE_SERVICE
  ) {
    return throwBridgeCompatibilityError("BRIDGE_IDENTITY_MISMATCH");
  }
  if (input.capabilitiesContractVersion === undefined) {
    return throwBridgeCompatibilityError(
      "CAPABILITIES_CONTRACT_UNSUPPORTED",
    );
  }
  if (
    isPositiveInteger(input.capabilitiesContractVersion) &&
    isPositiveInteger(expected.capabilitiesContractVersion) &&
    input.capabilitiesContractVersion !==
      expected.capabilitiesContractVersion
  ) {
    return throwBridgeCompatibilityError(
      "CAPABILITIES_CONTRACT_UNSUPPORTED",
    );
  }

  let liveManifest: RuntimeCapabilityManifest;
  let expectedManifest: RuntimeCapabilityManifest;
  try {
    liveManifest = parseRuntimeCapabilityManifest(input);
    expectedManifest = parseRuntimeCapabilityManifest(expected);
  } catch (error) {
    if (error instanceof RuntimeCapabilityError) {
      return throwBridgeCompatibilityError(error.code);
    }
    return throwBridgeCompatibilityError("CAPABILITIES_INVALID");
  }

  if (
    liveManifest.capabilitiesContractVersion !==
    expectedManifest.capabilitiesContractVersion
  ) {
    return throwBridgeCompatibilityError(
      "CAPABILITIES_CONTRACT_UNSUPPORTED",
    );
  }
  if (
    liveManifest.bridgeProtocolVersion !==
    expectedManifest.bridgeProtocolVersion
  ) {
    return throwBridgeCompatibilityError(
      "BRIDGE_PROTOCOL_UNSUPPORTED",
    );
  }
  if (
    liveManifest.sceneSchemaVersion !==
    expectedManifest.sceneSchemaVersion
  ) {
    return throwBridgeCompatibilityError("SCENE_SCHEMA_UNSUPPORTED");
  }
  if (
    liveManifest.patchSchemaVersion !==
    expectedManifest.patchSchemaVersion
  ) {
    return throwBridgeCompatibilityError("PATCH_SCHEMA_UNSUPPORTED");
  }
  if (
    liveManifest.intentReportSchemaVersion !==
    expectedManifest.intentReportSchemaVersion
  ) {
    return throwBridgeCompatibilityError(
      "INTENT_REPORT_SCHEMA_UNSUPPORTED",
    );
  }
  if (
    !stringSetsEqual(liveManifest.commands, expectedManifest.commands) ||
    !stringSetsEqual(liveManifest.features, expectedManifest.features)
  ) {
    return throwBridgeCompatibilityError("CAPABILITIES_INVALID");
  }

  if (
    input.status !== "ready" ||
    typeof input.sceneId !== "string" ||
    input.sceneId.length === 0 ||
    typeof input.revision !== "number" ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    (input.instanceId !== undefined &&
      (typeof input.instanceId !== "string" ||
        !/^instance_[a-f0-9]{32}$/.test(input.instanceId)))
  ) {
    return throwBridgeCompatibilityError("CAPABILITIES_INVALID");
  }
  return {
    ...liveManifest,
    status: "ready",
    sceneId: input.sceneId,
    revision: input.revision,
    uiUrl: validateLoopbackUiUrl(input.uiUrl),
    ...(typeof input.instanceId === "string"
      ? { instanceId: input.instanceId }
      : {}),
  };
};

const fetchEnvelope = async (
  configuration: BridgeConfiguration,
  pathname: string,
  options: RequestInit = {},
  timeoutMs = 2_000,
): Promise<JsonEnvelope> => {
  const requestUrl = resolveLoopbackRequestUrl(
    configuration,
    pathname,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      requestUrl,
      {
        ...options,
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      },
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BridgeError(
        "BRIDGE_RESPONSE_INVALID",
        "The loopback service returned an invalid response.",
      );
    }
    if (!isObject(body) || typeof body.ok !== "boolean") {
      throw new BridgeError(
        "BRIDGE_RESPONSE_INVALID",
        "The loopback service returned an invalid response.",
      );
    }
    const envelope = body as unknown as JsonEnvelope;
    if (!response.ok || !envelope.ok) {
      const code =
        isObject(envelope.error) &&
        typeof envelope.error.code === "string"
          ? envelope.error.code
          : "BRIDGE_REQUEST_FAILED";
      throw new BridgeError(code, safeBridgeMessage(code));
    }
    return envelope;
  } catch (error) {
    if (error instanceof BridgeError) {
      throw error;
    }
    throw new BridgeError(
      "BRIDGE_UNAVAILABLE",
      "The local Shubi Shot Director bridge is not running.",
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const probeBridgeHealth = async (
  configuration: BridgeConfiguration,
): Promise<BridgeHealth | null> => {
  let envelope: JsonEnvelope;
  try {
    envelope = await fetchEnvelope(
      configuration,
      "/api/v1/health",
      {},
      1_000,
    );
  } catch (error) {
    if (
      error instanceof BridgeError &&
      error.code === "BRIDGE_UNAVAILABLE"
    ) {
      return null;
    }
    throw error;
  }
  return validateBridgeHealth(envelope.data);
};

export const requireBridgeHealth = async (
  configuration: BridgeConfiguration,
): Promise<BridgeHealth> => {
  const health = await probeBridgeHealth(configuration);
  if (health === null) {
    throw new BridgeError(
      "BRIDGE_UNAVAILABLE",
      "The local Shubi Shot Director bridge is not running.",
    );
  }
  return health;
};

export const requestBridge = async (
  configuration: BridgeConfiguration,
  pathname: string,
  options?: RequestInit,
): Promise<JsonEnvelope> =>
  fetchEnvelope(configuration, pathname, options);

export const requestPreviewPng = async (
  configuration: BridgeConfiguration,
  width: number,
  height: number,
): Promise<{
  sceneId: string;
  revision: number;
  png: Buffer;
}> => {
  const requestUrl = resolveLoopbackRequestUrl(
    configuration,
    "/api/v1/preview-exports/png",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height }),
    });
    if (!response.ok) {
      let code = "BRIDGE_REQUEST_FAILED";
      try {
        const body = (await response.json()) as JsonEnvelope;
        if (typeof body.error?.code === "string") {
          code = body.error.code;
        }
      } catch {
        // Fall through to the stable generic bridge error.
      }
      throw new BridgeError(code, safeBridgeMessage(code));
    }
    if (response.headers.get("content-type") !== "image/png") {
      throw new BridgeError(
        "BRIDGE_RESPONSE_INVALID",
        "The loopback service returned an invalid response.",
      );
    }
    const sceneId =
      response.headers.get("x-shubi-shot-scene-id") ?? "";
    const revisionSource =
      response.headers.get("x-shubi-shot-revision") ?? "";
    if (
      sceneId.length === 0 ||
      !/^(0|[1-9][0-9]*)$/u.test(revisionSource)
    ) {
      throw new BridgeError(
        "BRIDGE_RESPONSE_INVALID",
        "The loopback service returned an invalid response.",
      );
    }
    const png = Buffer.from(await response.arrayBuffer());
    if (
      png.length < 8 ||
      png.length > 40 * 1024 * 1024 ||
      !png.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
    ) {
      throw new BridgeError(
        "BRIDGE_RESPONSE_INVALID",
        "The loopback service returned an invalid response.",
      );
    }
    return {
      sceneId,
      revision: Number(revisionSource),
      png,
    };
  } catch (error) {
    if (error instanceof BridgeError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new BridgeError(
        "EXPORT_PREVIEW_TIMEOUT",
        safeBridgeMessage("EXPORT_PREVIEW_TIMEOUT"),
      );
    }
    throw new BridgeError(
      "BRIDGE_UNAVAILABLE",
      "The local Shubi Shot Director bridge is not running.",
    );
  } finally {
    clearTimeout(timeout);
  }
};

const waitForHealth = async (
  configuration: BridgeConfiguration,
  timeoutMs: number,
): Promise<BridgeHealth> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await probeBridgeHealth(configuration);
      if (health !== null) {
        return health;
      }
    } catch (error) {
      if (
        error instanceof BridgeError &&
        error.code !== "BRIDGE_UNAVAILABLE"
      ) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new BridgeError(
    "BRIDGE_START_TIMEOUT",
    "The local bridge did not become ready in time.",
  );
};

export const ensureBridge = async (
  configuration: BridgeConfiguration,
  paths: {
    repositoryRoot: string;
    tsxCliPath: string;
  },
): Promise<{ health: BridgeHealth; started: boolean }> => {
  const existing = await probeBridgeHealth(configuration);
  if (existing !== null) {
    return { health: existing, started: false };
  }
  if (configuration.baseUrl.hostname !== "127.0.0.1") {
    throw new BridgeError(
      "BRIDGE_AUTOSTART_HOST_UNSUPPORTED",
      "Automatic bridge startup requires the canonical 127.0.0.1 host.",
    );
  }

  const child = spawn(
    process.execPath,
    [
      paths.tsxCliPath,
      path.join(paths.repositoryRoot, "server", "index.ts"),
    ],
    {
      cwd: paths.repositoryRoot,
      detached: true,
      env: createBridgeChildEnvironment(
        configuration.port,
        configuration.runtimeDirectory,
        process.env,
      ),
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  return {
    health: await waitForHealth(configuration, 20_000),
    started: true,
  };
};

export const stopBridge = async (
  configuration: BridgeConfiguration,
): Promise<{ stopped: boolean }> => {
  const health = await probeBridgeHealth(configuration);
  if (health === null) {
    return { stopped: false };
  }
  if (health.instanceId === undefined) {
    throw new BridgeError(
      "BRIDGE_CONTROL_UNAVAILABLE",
      "The running bridge does not support safe self-shutdown.",
    );
  }
  await requestBridge(configuration, "/api/v1/shutdown", {
    method: "POST",
    headers: {
      "X-Shubi-Shot-Instance": health.instanceId,
    },
    body: "{}",
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    try {
      const current = await probeBridgeHealth(configuration);
      if (current === null) {
        return { stopped: true };
      }
      if (current.instanceId !== health.instanceId) {
        throw new BridgeError(
          "BRIDGE_INSTANCE_CHANGED",
          "A different bridge instance started during shutdown.",
        );
      }
    } catch (error) {
      if (
        error instanceof BridgeError &&
        error.code === "BRIDGE_UNAVAILABLE"
      ) {
        return { stopped: true };
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new BridgeError(
    "BRIDGE_STOP_TIMEOUT",
    "The local bridge did not stop in time.",
  );
};
