import type { SceneSpec } from "../domain/scene-schema";

interface PreviewShotExporter {
  exportPng(options: {
    download: false;
    width: number;
    height: number;
  }): Promise<{ blob: Blob }>;
}

interface PreviewExportRequest {
  requestId: string;
  sceneId: string;
  revision: number;
  width: number;
  height: number;
}

interface PreviewEventSource {
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
}

interface PreviewExportBridgeOptions {
  getScene: () => SceneSpec | null;
  getExporter: () => PreviewShotExporter | null;
  fetchFn?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  createEventSource?: (url: string) => PreviewEventSource;
}

const parseRequest = (source: string): PreviewExportRequest | null => {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.requestId !== "string" ||
    !/^export_[a-f0-9]{32}$/u.test(request.requestId) ||
    typeof request.sceneId !== "string" ||
    request.sceneId.length === 0 ||
    !Number.isInteger(request.revision) ||
    !Number.isInteger(request.width) ||
    !Number.isInteger(request.height)
  ) {
    return null;
  }
  return request as unknown as PreviewExportRequest;
};

export const connectPreviewExportBridge = (
  options: PreviewExportBridgeOptions,
): (() => void) => {
  const fetchFn = options.fetchFn ?? fetch;
  const eventSource = options.createEventSource
    ? options.createEventSource("/api/v1/preview-exports/events")
    : (new EventSource(
        "/api/v1/preview-exports/events",
      ) as unknown as PreviewEventSource);

  const reportFailure = async (requestId: string): Promise<void> => {
    try {
      await fetchFn(
        `/api/v1/preview-exports/${encodeURIComponent(requestId)}/error`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch {
      // The CLI request will time out with its own stable error if the bridge
      // disappears before this best-effort failure report arrives.
    }
  };

  eventSource.addEventListener("png", (event) => {
    const request = parseRequest(event.data);
    if (!request) {
      return;
    }
    void (async () => {
      const scene = options.getScene();
      const exporter = options.getExporter();
      if (
        !scene ||
        !exporter ||
        scene.sceneId !== request.sceneId ||
        scene.revision !== request.revision
      ) {
        await reportFailure(request.requestId);
        return;
      }

      try {
        const result = await exporter.exportPng({
          download: false,
          width: request.width,
          height: request.height,
        });
        const currentScene = options.getScene();
        if (
          !currentScene ||
          currentScene.sceneId !== request.sceneId ||
          currentScene.revision !== request.revision
        ) {
          await reportFailure(request.requestId);
          return;
        }
        const response = await fetchFn(
          `/api/v1/preview-exports/${encodeURIComponent(request.requestId)}/result`,
          {
            method: "POST",
            headers: {
              "Content-Type": "image/png",
              "X-Shubi-Shot-Scene-Id": request.sceneId,
              "X-Shubi-Shot-Revision": String(request.revision),
            },
            body: result.blob,
          },
        );
        if (!response.ok) {
          throw new Error("Preview export upload was rejected.");
        }
      } catch {
        await reportFailure(request.requestId);
      }
    })();
  });

  return () => eventSource.close();
};
