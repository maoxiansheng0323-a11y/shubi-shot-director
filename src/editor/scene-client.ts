import { z } from "zod";
import {
  scenePatchSchema,
  type ScenePatch,
} from "../domain/scene-patch";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../domain/scene-schema";

const historyStatusSchema = z
  .object({
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  })
  .strict();

const sceneSnapshotSchema = z
  .object({
    scene: sceneSpecSchema,
    history: historyStatusSchema,
  })
  .strict();

const sceneUpdateSchema = z
  .object({
    scene: sceneSpecSchema.nullable(),
    history: historyStatusSchema,
  })
  .strict();

const sceneChangeEventSchema = z
  .object({
    eventId: z.string().min(1),
    reason: z.enum(["patch", "replace", "undo", "redo"]),
    scene: sceneSpecSchema,
  })
  .strict();

const apiErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        issues: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type SceneHistoryStatus = z.infer<typeof historyStatusSchema>;
export type SceneSessionSnapshot = z.infer<typeof sceneSnapshotSchema>;
export type SceneSessionUpdate = z.infer<typeof sceneUpdateSchema>;
export type SceneChangeEvent = z.infer<typeof sceneChangeEventSchema>;

export type SceneConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export class SceneClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly issues: readonly unknown[];

  constructor(
    code: string,
    message: string,
    options: {
      status?: number;
      issues?: readonly unknown[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "SceneClientError";
    this.code = code;
    this.status = options.status ?? null;
    this.issues = options.issues ?? [];
  }
}

export interface SceneEventHandlers {
  onScene: (event: SceneChangeEvent) => void;
  onConnectionChange?: (status: SceneConnectionStatus) => void;
  onError?: (error: SceneClientError) => void;
}

export interface SceneClientOptions {
  fetch?: typeof globalThis.fetch;
  eventSourceFactory?: (url: string) => EventSource;
}

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError";

export class SceneClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly eventSourceFactory: (url: string) => EventSource;

  constructor(options: SceneClientOptions = {}) {
    this.fetchImpl =
      options.fetch ??
      ((input, init) => globalThis.fetch(input, init));
    this.eventSourceFactory =
      options.eventSourceFactory ??
      ((url) => new EventSource(url));
  }

  getScene(signal?: AbortSignal): Promise<SceneSessionSnapshot> {
    return this.request("/api/v1/scene", sceneSnapshotSchema, {
      method: "GET",
      signal,
    });
  }

  applyPatch(
    input: ScenePatch,
    signal?: AbortSignal,
  ): Promise<SceneSessionSnapshot> {
    const patch = scenePatchSchema.parse(input);
    return this.request("/api/v1/patches", sceneSnapshotSchema, {
      method: "POST",
      signal,
      body: JSON.stringify(patch),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  replaceScene(
    input: SceneSpec,
    signal?: AbortSignal,
  ): Promise<SceneSessionSnapshot> {
    const scene = sceneSpecSchema.parse(input);
    return this.request("/api/v1/scene", sceneSnapshotSchema, {
      method: "PUT",
      signal,
      body: JSON.stringify(scene),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  undo(signal?: AbortSignal): Promise<SceneSessionUpdate> {
    return this.request("/api/v1/undo", sceneUpdateSchema, {
      method: "POST",
      signal,
    });
  }

  redo(signal?: AbortSignal): Promise<SceneSessionUpdate> {
    return this.request("/api/v1/redo", sceneUpdateSchema, {
      method: "POST",
      signal,
    });
  }

  subscribe(handlers: SceneEventHandlers): () => void {
    handlers.onConnectionChange?.("connecting");

    let source: EventSource;
    try {
      source = this.eventSourceFactory("/api/v1/events");
    } catch (cause) {
      const error = new SceneClientError(
        "EVENT_STREAM_UNAVAILABLE",
        "The browser cannot open the local scene event stream.",
        { cause },
      );
      handlers.onConnectionChange?.("disconnected");
      handlers.onError?.(error);
      return () => undefined;
    }

    let closed = false;

    source.addEventListener("open", () => {
      if (!closed) {
        handlers.onConnectionChange?.("connected");
      }
    });

    source.addEventListener("scene", (event) => {
      if (closed) {
        return;
      }
      try {
        const message = event as Event & { readonly data: string };
        const payload = sceneChangeEventSchema.parse(
          JSON.parse(message.data) as unknown,
        );
        handlers.onScene(payload);
      } catch (cause) {
        handlers.onError?.(
          new SceneClientError(
            "INVALID_EVENT",
            "The local scene bridge sent an invalid scene event.",
            { cause },
          ),
        );
      }
    });

    source.addEventListener("error", () => {
      if (!closed) {
        handlers.onConnectionChange?.("reconnecting");
        handlers.onError?.(
          new SceneClientError(
            "EVENT_STREAM_INTERRUPTED",
            "Scene synchronization was interrupted; the browser will retry.",
          ),
        );
      }
    });

    return () => {
      if (closed) {
        return;
      }
      closed = true;
      source.close();
      handlers.onConnectionChange?.("disconnected");
    };
  }

  private async request<T>(
    path: string,
    dataSchema: z.ZodType<T>,
    init: RequestInit,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(path, init);
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new SceneClientError(
          "REQUEST_ABORTED",
          "The scene request was cancelled.",
          { cause },
        );
      }
      throw new SceneClientError(
        "NETWORK_ERROR",
        "Cannot connect to the local SceneSession.",
        { cause },
      );
    }

    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch (cause) {
      throw new SceneClientError(
        "INVALID_RESPONSE",
        "The local scene bridge returned an unreadable response.",
        { status: response.status, cause },
      );
    }

    const errorEnvelope = apiErrorEnvelopeSchema.safeParse(payload);
    if (!response.ok || errorEnvelope.success) {
      if (errorEnvelope.success) {
        throw new SceneClientError(
          errorEnvelope.data.error.code,
          errorEnvelope.data.error.message,
          {
            status: response.status,
            issues: errorEnvelope.data.error.issues,
          },
        );
      }
      throw new SceneClientError(
        "HTTP_ERROR",
        `The local scene bridge returned HTTP ${response.status}.`,
        { status: response.status },
      );
    }

    const envelope = z
      .object({
        ok: z.literal(true),
        data: dataSchema,
      })
      .strict()
      .safeParse(payload);

    if (!envelope.success) {
      throw new SceneClientError(
        "INVALID_RESPONSE",
        "The local scene bridge returned data that does not match the scene schema.",
        {
          status: response.status,
          issues: envelope.error.issues,
        },
      );
    }

    return envelope.data.data;
  }
}

export const sceneClient = new SceneClient();
