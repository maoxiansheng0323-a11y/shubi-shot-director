import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import {
  isWorkspaceId,
  resolveWorkspacePaths,
} from "./workspace-identity.mjs";

const DESCRIPTOR_VERSION = 1;
const DEFAULT_PORT_START = 4317;
const DEFAULT_PORT_END = 4416;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 25;
const INSTANCE_ID_PATTERN = /^instance_[0-9a-f]{32}$/u;
const DESCRIPTOR_KEYS = new Set([
  "version",
  "workspaceId",
  "port",
  "status",
  "instanceId",
  "updatedAt",
  "legacy",
]);
const BINDING_KEYS = new Set([
  "version",
  "workspaceId",
]);
const WORKSPACE_STATUSES = new Set([
  "starting",
  "ready",
  "stopped",
]);

const errorMessages = Object.freeze({
  WORKSPACE_ID_INVALID: "The workspace ID is invalid.",
  WORKSPACE_NOT_FOUND: "The workspace was not found.",
  WORKSPACE_STATE_INVALID: "The workspace routing state is invalid.",
  WORKSPACE_LOCK_UNAVAILABLE:
    "The workspace routing lock is unavailable.",
  WORKSPACE_PORT_UNAVAILABLE:
    "No loopback port is available for the workspace.",
});

export class WorkspaceRoutingError extends Error {
  constructor(code) {
    super(errorMessages[code] ?? "Workspace routing failed.");
    this.name = "WorkspaceRoutingError";
    this.code = code;
  }
}

const isObject = (value) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

const exactKeys = (value, expected) => {
  const keys = Object.keys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => expected.has(key))
  );
};

const isPort = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 65_535;

const isTimestamp = (value) =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value));

const parseDescriptor = (value) => {
  if (
    !isObject(value) ||
    !exactKeys(value, DESCRIPTOR_KEYS) ||
    value.version !== DESCRIPTOR_VERSION ||
    !isWorkspaceId(value.workspaceId) ||
    !isPort(value.port) ||
    !WORKSPACE_STATUSES.has(value.status) ||
    !(
      value.instanceId === null ||
      (typeof value.instanceId === "string" &&
        INSTANCE_ID_PATTERN.test(value.instanceId))
    ) ||
    !isTimestamp(value.updatedAt) ||
    typeof value.legacy !== "boolean"
  ) {
    throw new WorkspaceRoutingError("WORKSPACE_STATE_INVALID");
  }
  return Object.freeze({
    version: value.version,
    workspaceId: value.workspaceId,
    port: value.port,
    status: value.status,
    instanceId: value.instanceId,
    updatedAt: value.updatedAt,
    legacy: value.legacy,
  });
};

const parseBinding = (value) => {
  if (
    !isObject(value) ||
    !exactKeys(value, BINDING_KEYS) ||
    value.version !== DESCRIPTOR_VERSION ||
    !isWorkspaceId(value.workspaceId)
  ) {
    throw new WorkspaceRoutingError("WORKSPACE_STATE_INVALID");
  }
  return value.workspaceId;
};

const readJson = async (filePath, missingValue) => {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return missingValue;
    }
    throw new WorkspaceRoutingError("WORKSPACE_STATE_INVALID");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new WorkspaceRoutingError("WORKSPACE_STATE_INVALID");
  }
};

const writeJsonAtomically = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryFile,
      `${JSON.stringify(value, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    await rename(temporaryFile, filePath);
  } catch (error) {
    await unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
};

const writeJsonExclusively = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const withRoutingLock = async (routingRoot, operation) => {
  await mkdir(routingRoot, { recursive: true });
  const lockFile = path.join(
    routingRoot,
    ".allocation.lock",
  );
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    let handle;
    try {
      handle = await open(lockFile, "wx");
    } catch (error) {
      if (
        error?.code === "EEXIST" &&
        Date.now() < deadline
      ) {
        await delay(LOCK_RETRY_MS);
        continue;
      }
      throw new WorkspaceRoutingError(
        "WORKSPACE_LOCK_UNAVAILABLE",
      );
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockFile).catch(() => undefined);
    }
  }
};

const defaultProbePort = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port,
    });
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

const defaultProbeHealth = async (port) => {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await globalThis.fetch(
      `http://127.0.0.1:${port}/api/v1/health`,
      {
        redirect: "error",
        signal: controller.signal,
      },
    );
    const body = await response.json();
    if (
      response.ok &&
      body?.ok === true &&
      body?.data?.service === "shubi-shot-director"
    ) {
      return body.data;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveDependencies = (dependencies = {}) => ({
  portStart:
    dependencies.portStart ?? DEFAULT_PORT_START,
  portEnd: dependencies.portEnd ?? DEFAULT_PORT_END,
  probePort: dependencies.probePort ?? defaultProbePort,
  probeHealth:
    dependencies.probeHealth ?? defaultProbeHealth,
});

const descriptorValue = ({
  workspaceId,
  port,
  status,
  instanceId = null,
  legacy = false,
}) => ({
  version: DESCRIPTOR_VERSION,
  workspaceId,
  port,
  status,
  instanceId,
  updatedAt: new Date().toISOString(),
  legacy,
});

const bindingFile = (routingRoot, threadWorkspaceId) => {
  if (!isWorkspaceId(threadWorkspaceId)) {
    throw new WorkspaceRoutingError("WORKSPACE_ID_INVALID");
  }
  return path.join(
    path.resolve(routingRoot),
    "bindings",
    `${threadWorkspaceId}.json`,
  );
};

const legacyOwnerFile = (routingRoot) =>
  path.join(
    path.resolve(routingRoot),
    "legacy-owner.json",
  );

const readLegacyOwner = async (routingRoot) => {
  const raw = await readJson(
    legacyOwnerFile(routingRoot),
    undefined,
  );
  return raw === undefined ? undefined : parseBinding(raw);
};

const legacySceneExists = async (legacyRuntimeDirectory) => {
  if (legacyRuntimeDirectory === undefined) {
    return false;
  }
  try {
    return (
      await stat(
        path.join(
          path.resolve(legacyRuntimeDirectory),
          "current.scene.json",
        ),
      )
    ).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new WorkspaceRoutingError("WORKSPACE_STATE_INVALID");
  }
};

const claimLegacyWorkspace = async ({
  routingRoot,
  workspaceId,
  legacyRuntimeDirectory,
}) => {
  const existing = await readLegacyOwner(routingRoot);
  if (existing !== undefined) {
    return existing === workspaceId;
  }
  if (!(await legacySceneExists(legacyRuntimeDirectory))) {
    return false;
  }
  try {
    await writeJsonExclusively(
      legacyOwnerFile(routingRoot),
      {
        version: DESCRIPTOR_VERSION,
        workspaceId,
      },
    );
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    return (
      (await readLegacyOwner(routingRoot)) === workspaceId
    );
  }
};

const readDescriptor = async (routingRoot, workspaceId) => {
  const paths = resolveWorkspacePaths(
    routingRoot,
    workspaceId,
  );
  const raw = await readJson(
    paths.descriptorFile,
    undefined,
  );
  return raw === undefined ? undefined : parseDescriptor(raw);
};

const readAllDescriptors = async (routingRoot) => {
  const workspacesDirectory = path.join(
    path.resolve(routingRoot),
    "workspaces",
  );
  let entries;
  try {
    entries = await readdir(workspacesDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new WorkspaceRoutingError("WORKSPACE_STATE_INVALID");
  }
  const descriptors = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isWorkspaceId(entry.name)) {
      continue;
    }
    const value = await readDescriptor(
      routingRoot,
      entry.name,
    );
    if (value !== undefined) descriptors.push(value);
  }
  return descriptors;
};

const routeFromDescriptor = (
  routingRoot,
  descriptor,
  legacyRuntimeDirectory,
) => {
  const paths = resolveWorkspacePaths(
    routingRoot,
    descriptor.workspaceId,
  );
  return Object.freeze({
    workspaceId: descriptor.workspaceId,
    port: descriptor.port,
    status: descriptor.status,
    instanceId: descriptor.instanceId,
    legacy: descriptor.legacy,
    descriptorFile: paths.descriptorFile,
    runtimeDirectory: descriptor.legacy
      ? path.resolve(legacyRuntimeDirectory)
      : paths.runtimeDirectory,
  });
};

export const ensureWorkspaceRoute = async ({
  routingRoot,
  workspaceId,
  legacyRuntimeDirectory,
  dependencies,
}) => {
  if (!isWorkspaceId(workspaceId)) {
    throw new WorkspaceRoutingError("WORKSPACE_ID_INVALID");
  }
  const resolved = resolveDependencies(dependencies);
  if (
    !isPort(resolved.portStart) ||
    !isPort(resolved.portEnd) ||
    resolved.portEnd < resolved.portStart
  ) {
    throw new WorkspaceRoutingError(
      "WORKSPACE_PORT_UNAVAILABLE",
    );
  }
  return withRoutingLock(routingRoot, async () => {
    const existing = await readDescriptor(
      routingRoot,
      workspaceId,
    );
    if (
      existing !== undefined &&
      existing.status !== "stopped"
    ) {
      return routeFromDescriptor(
        routingRoot,
        existing,
        legacyRuntimeDirectory,
      );
    }

    const legacy = await claimLegacyWorkspace({
      routingRoot,
      workspaceId,
      legacyRuntimeDirectory,
    });
    const descriptors = await readAllDescriptors(routingRoot);
    const reservedPorts = new Set(
      descriptors
        .filter((item) => item.status !== "stopped")
        .map((item) => item.port),
    );
    let selectedPort;
    for (
      let port = resolved.portStart;
      port <= resolved.portEnd;
      port += 1
    ) {
      if (
        !reservedPorts.has(port) &&
        !(await resolved.probePort(port))
      ) {
        selectedPort = port;
        break;
      }
    }
    if (selectedPort === undefined) {
      throw new WorkspaceRoutingError(
        "WORKSPACE_PORT_UNAVAILABLE",
      );
    }
    const next = parseDescriptor(
      descriptorValue({
        workspaceId,
        port: selectedPort,
        status: "starting",
        legacy,
      }),
    );
    const paths = resolveWorkspacePaths(
      routingRoot,
      workspaceId,
    );
    await writeJsonAtomically(paths.descriptorFile, next);
    await mkdir(
      legacy
        ? path.resolve(legacyRuntimeDirectory)
        : paths.runtimeDirectory,
      { recursive: true },
    );
    return routeFromDescriptor(
      routingRoot,
      next,
      legacyRuntimeDirectory,
    );
  });
};

export const readThreadBinding = async (
  routingRoot,
  threadWorkspaceId,
) => {
  const raw = await readJson(
    bindingFile(routingRoot, threadWorkspaceId),
    undefined,
  );
  return raw === undefined ? undefined : parseBinding(raw);
};

export const attachWorkspace = async ({
  routingRoot,
  threadWorkspaceId,
  targetWorkspaceId,
}) => {
  if (
    !isWorkspaceId(threadWorkspaceId) ||
    !isWorkspaceId(targetWorkspaceId)
  ) {
    throw new WorkspaceRoutingError("WORKSPACE_ID_INVALID");
  }
  return withRoutingLock(routingRoot, async () => {
    const target = await readDescriptor(
      routingRoot,
      targetWorkspaceId,
    );
    if (target === undefined) {
      throw new WorkspaceRoutingError("WORKSPACE_NOT_FOUND");
    }
    await writeJsonAtomically(
      bindingFile(routingRoot, threadWorkspaceId),
      {
        version: DESCRIPTOR_VERSION,
        workspaceId: targetWorkspaceId,
      },
    );
    return targetWorkspaceId;
  });
};

export const listWorkspaces = async ({
  routingRoot,
  probeHealth = defaultProbeHealth,
}) => {
  const descriptors = await readAllDescriptors(routingRoot);
  const result = [];
  for (const descriptor of descriptors) {
    let health = null;
    let status = descriptor.status;
    if (
      descriptor.status === "ready" &&
      descriptor.instanceId !== null
    ) {
      const candidate = await probeHealth(descriptor.port);
      const expectedUrl = `http://127.0.0.1:${descriptor.port}`;
      if (
        candidate?.instanceId === descriptor.instanceId &&
        candidate?.uiUrl === expectedUrl
      ) {
        health = candidate;
      } else {
        status = "stopped";
      }
    }
    result.push(
      Object.freeze({
        workspaceId: descriptor.workspaceId,
        port: descriptor.port,
        status,
        legacy: descriptor.legacy,
        ...(health === null
          ? {}
          : {
              sceneId: health.sceneId,
              revision: health.revision,
              uiUrl: health.uiUrl,
              instanceId: health.instanceId,
            }),
      }),
    );
  }
  return result.sort((left, right) =>
    left.workspaceId.localeCompare(right.workspaceId),
  );
};

export const updateWorkspaceRoute = async ({
  routingRoot,
  workspaceId,
  status,
  instanceId = null,
}) => {
  if (
    !isWorkspaceId(workspaceId) ||
    !WORKSPACE_STATUSES.has(status)
  ) {
    throw new WorkspaceRoutingError("WORKSPACE_ID_INVALID");
  }
  return withRoutingLock(routingRoot, async () => {
    const current = await readDescriptor(
      routingRoot,
      workspaceId,
    );
    if (current === undefined) {
      throw new WorkspaceRoutingError("WORKSPACE_NOT_FOUND");
    }
    const next = parseDescriptor(
      descriptorValue({
        ...current,
        status,
        instanceId,
      }),
    );
    const paths = resolveWorkspacePaths(
      routingRoot,
      workspaceId,
    );
    await writeJsonAtomically(paths.descriptorFile, next);
    return next;
  });
};
