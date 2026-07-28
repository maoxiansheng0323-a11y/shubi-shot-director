import { createHash } from "node:crypto";
import path from "node:path";

const WORKSPACE_ID_PATTERN = /^workspace_[0-9a-f]{32}$/u;
const THREAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isWorkspaceId = (value) =>
  typeof value === "string" && WORKSPACE_ID_PATTERN.test(value);

export const deriveThreadWorkspaceId = (threadId) => {
  if (
    typeof threadId !== "string" ||
    !THREAD_ID_PATTERN.test(threadId)
  ) {
    return undefined;
  }
  const digest = createHash("sha256")
    .update("shubi-shot-workspace-v1\0", "utf8")
    .update(threadId.toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `workspace_${digest}`;
};

const contained = (root, ...segments) => {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  return candidate;
};

export const resolveWorkspacePaths = (routingRoot, workspaceId) => {
  if (!isWorkspaceId(workspaceId)) {
    throw new Error("WORKSPACE_ID_INVALID");
  }
  const workspaceDirectory = contained(
    routingRoot,
    "workspaces",
    workspaceId,
  );
  return Object.freeze({
    workspaceDirectory,
    descriptorFile: contained(workspaceDirectory, "bridge.json"),
    runtimeDirectory: contained(workspaceDirectory, "runtime"),
  });
};
