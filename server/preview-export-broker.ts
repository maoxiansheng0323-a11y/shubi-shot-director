import { randomUUID } from "node:crypto";

export interface PreviewExportRequest {
  requestId: string;
  sceneId: string;
  revision: number;
  width: number;
  height: number;
}

export interface PreviewExportResult {
  sceneId: string;
  revision: number;
  png: Buffer;
}

export class PreviewExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PreviewExportError";
    this.code = code;
  }
}

type PreviewExportListener = (request: PreviewExportRequest) => void;

interface PendingExport {
  request: PreviewExportRequest;
  resolve: (result: PreviewExportResult) => void;
  reject: (error: PreviewExportError) => void;
  timer: ReturnType<typeof setTimeout>;
  remainingListeners: PreviewExportListener[];
}

export class PreviewExportBroker {
  private readonly timeoutMs: number;
  private readonly listeners = new Set<PreviewExportListener>();
  private readonly pending = new Map<string, PendingExport>();

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  subscribe(
    listener: PreviewExportListener,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(
    input: Omit<PreviewExportRequest, "requestId">,
  ): Promise<PreviewExportResult> {
    const listeners = [...this.listeners];
    if (listeners.length === 0) {
      return Promise.reject(
        new PreviewExportError(
          "EXPORT_PREVIEW_UNAVAILABLE",
          "No browser Shot Preview renderer is connected.",
        ),
      );
    }

    const request: PreviewExportRequest = {
      ...input,
      requestId: `export_${randomUUID().replaceAll("-", "")}`,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId);
        reject(
          new PreviewExportError(
            "EXPORT_PREVIEW_TIMEOUT",
            "The browser Shot Preview did not finish the PNG export.",
          ),
        );
      }, this.timeoutMs);
      this.pending.set(request.requestId, {
        request,
        resolve,
        reject,
        timer,
        remainingListeners: listeners,
      });
      this.dispatchNextRenderer(request.requestId);
    });
  }

  private dispatchNextRenderer(
    requestId: string,
    failureCode = "EXPORT_PREVIEW_FAILED",
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    const listener = pending.remainingListeners.pop();
    if (!listener) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(
        new PreviewExportError(
          failureCode,
          "The browser Shot Preview could not export the PNG.",
        ),
      );
      return;
    }
    try {
      listener(pending.request);
    } catch {
      this.dispatchNextRenderer(requestId, failureCode);
    }
  }

  complete(input: {
    requestId: string;
    sceneId: string;
    revision: number;
    png: Buffer;
  }): void {
    const pending = this.pending.get(input.requestId);
    if (!pending) {
      throw new PreviewExportError(
        "EXPORT_REQUEST_NOT_FOUND",
        "The preview export request is no longer active.",
      );
    }
    if (
      input.sceneId !== pending.request.sceneId ||
      input.revision !== pending.request.revision
    ) {
      throw new PreviewExportError(
        "EXPORT_PREVIEW_REVISION_MISMATCH",
        "The browser Shot Preview revision changed during export.",
      );
    }
    if (
      input.png.length < 8 ||
      !input.png.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
    ) {
      throw new PreviewExportError(
        "EXPORT_PREVIEW_INVALID",
        "The browser Shot Preview returned an invalid PNG.",
      );
    }

    clearTimeout(pending.timer);
    this.pending.delete(input.requestId);
    pending.resolve({
      sceneId: input.sceneId,
      revision: input.revision,
      png: input.png,
    });
  }

  fail(requestId: string, code = "EXPORT_PREVIEW_FAILED"): void {
    this.dispatchNextRenderer(requestId, code);
  }
}
