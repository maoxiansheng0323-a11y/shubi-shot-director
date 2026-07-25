import { sceneSpecSchema, type SceneSpec } from "../domain/scene-schema";
import {
  sceneClient,
  type SceneClient,
  type SceneSessionSnapshot,
} from "./scene-client";

const MAX_SCENE_FILE_BYTES = 1024 * 1024;

export class SceneFileError extends Error {
  readonly code: string;
  readonly issues: readonly unknown[];

  constructor(
    code: string,
    message: string,
    options: {
      issues?: readonly unknown[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "SceneFileError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export const parseSceneFile = async (file: Blob): Promise<SceneSpec> => {
  if (file.size > MAX_SCENE_FILE_BYTES) {
    throw new SceneFileError(
      "SCENE_FILE_TOO_LARGE",
      "Scene files must be 1 MiB or smaller.",
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch (cause) {
    throw new SceneFileError(
      "SCENE_FILE_READ_FAILED",
      "The selected scene file could not be read.",
      { cause },
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new SceneFileError(
      "SCENE_FILE_INVALID_JSON",
      "The selected file is not valid JSON.",
      { cause },
    );
  }

  const result = sceneSpecSchema.safeParse(input);
  if (!result.success) {
    throw new SceneFileError(
      "SCENE_FILE_INVALID",
      "The selected file is not a valid SceneSpec.",
      { issues: result.error.issues },
    );
  }

  return result.data;
};

export const serializeSceneFile = (input: SceneSpec): string => {
  const scene = sceneSpecSchema.parse(input);
  return `${JSON.stringify(scene, null, 2)}\n`;
};

const normalizeDownloadName = (
  scene: SceneSpec,
  requestedName?: string,
): string => {
  const rawName = (requestedName ?? scene.sceneId).trim();
  const safeName =
    rawName
      .replace(/\.scene\.json$/i, "")
      .replace(/\.json$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || scene.sceneId;
  return `${safeName}.scene.json`;
};

export const downloadSceneFile = (
  input: SceneSpec,
  requestedName?: string,
): string => {
  const scene = sceneSpecSchema.parse(input);
  const fileName = normalizeDownloadName(scene, requestedName);

  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new SceneFileError(
      "SCENE_DOWNLOAD_UNAVAILABLE",
      "Scene downloads are only available in a browser.",
    );
  }

  const blob = new Blob([serializeSceneFile(scene)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);

  return fileName;
};

export const loadSceneFile = async (
  file: Blob,
  client: Pick<SceneClient, "replaceScene"> = sceneClient,
): Promise<SceneSessionSnapshot> => {
  // Validation deliberately completes before replaceScene can issue a PUT.
  const scene = await parseSceneFile(file);
  return client.replaceScene(scene);
};
