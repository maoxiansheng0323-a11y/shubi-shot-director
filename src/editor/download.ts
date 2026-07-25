const DEFAULT_DOWNLOAD_NAME = "download";
const MAX_DOWNLOAD_NAME_LENGTH = 120;

export class BrowserDownloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserDownloadError";
    this.code = code;
  }
}

const safeLeafName = (requestedName: string, fallback: string): string => {
  const leafName =
    requestedName
      .trim()
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) ?? "";
  const normalized = leafName
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  return normalized.slice(0, MAX_DOWNLOAD_NAME_LENGTH) || fallback;
};

/**
 * Produces a path-free PNG name while retaining readable Unicode characters.
 */
export const normalizePngFileName = (
  requestedName = "perspective.png",
): string => {
  const withoutExtension = requestedName.replace(/\.png$/i, "");
  return `${safeLeafName(withoutExtension, "perspective")}.png`;
};

/**
 * Starts a browser download without keeping a generated object URL alive.
 */
export const triggerBlobDownload = (
  blob: Blob,
  requestedName = DEFAULT_DOWNLOAD_NAME,
): string => {
  const fileName = safeLeafName(requestedName, DEFAULT_DOWNLOAD_NAME);

  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    throw new BrowserDownloadError(
      "BROWSER_DOWNLOAD_UNAVAILABLE",
      "File downloads are only available in a browser document.",
    );
  }

  const objectUrl = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } catch (cause) {
    URL.revokeObjectURL(objectUrl);
    throw new BrowserDownloadError(
      "BROWSER_DOWNLOAD_FAILED",
      `The browser could not start the ${fileName} download.`,
      { cause },
    );
  } finally {
    anchor?.remove();
  }

  // Revoking on the same task can cancel downloads in some browsers.
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  return fileName;
};
