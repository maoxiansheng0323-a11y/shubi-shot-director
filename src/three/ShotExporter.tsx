import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import {
  Color,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import {
  outputSpecSchema,
  type OutputSpec,
} from "../domain/scene-schema";
import {
  BrowserDownloadError,
  normalizePngFileName,
  triggerBlobDownload,
} from "../editor/download";
import {
  ShotExportError,
  flipRgbaRowsInPlace,
} from "./shot-export-utils";

export {
  ShotExportError,
  flipRgbaRowsInPlace,
} from "./shot-export-utils";

export interface ShotExportOptions {
  /**
   * Defaults to perspective.png. Directory components are discarded.
   */
  fileName?: string;
  /**
   * Set false when a caller needs the Blob without starting a download.
   */
  download?: boolean;
  /** Optional bridge override; the toolbar continues to use SceneSpec output. */
  width?: number;
  height?: number;
}

export interface ShotExportResult {
  width: number;
  height: number;
  fileName: string;
  blob: Blob;
}

export interface ShotExporterHandle {
  exportPng: (options?: ShotExportOptions) => Promise<ShotExportResult>;
}

export interface ShotExporterProps {
  output: OutputSpec;
  registerExporter: (exporter: ShotExporterHandle | null) => void;
  defaultFileName?: string;
}

interface RendererState {
  renderTarget: WebGLRenderTarget | null;
  activeCubeFace: number;
  activeMipmapLevel: number;
  viewport: Vector4;
  scissor: Vector4;
  scissorTest: boolean;
  clearColor: Color;
  clearAlpha: number;
  autoClear: boolean;
  autoClearColor: boolean;
  autoClearDepth: boolean;
  autoClearStencil: boolean;
}

const captureRendererState = (renderer: WebGLRenderer): RendererState => ({
  renderTarget: renderer.getRenderTarget(),
  activeCubeFace: renderer.getActiveCubeFace(),
  activeMipmapLevel: renderer.getActiveMipmapLevel(),
  viewport: renderer.getViewport(new Vector4()),
  scissor: renderer.getScissor(new Vector4()),
  scissorTest: renderer.getScissorTest(),
  clearColor: renderer.getClearColor(new Color()),
  clearAlpha: renderer.getClearAlpha(),
  autoClear: renderer.autoClear,
  autoClearColor: renderer.autoClearColor,
  autoClearDepth: renderer.autoClearDepth,
  autoClearStencil: renderer.autoClearStencil,
});

const restoreRendererState = (
  renderer: WebGLRenderer,
  state: RendererState,
): void => {
  // setRenderTarget can alter viewport and scissor, so restore it first.
  renderer.setRenderTarget(
    state.renderTarget,
    state.activeCubeFace,
    state.activeMipmapLevel,
  );
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.autoClear = state.autoClear;
  renderer.autoClearColor = state.autoClearColor;
  renderer.autoClearDepth = state.autoClearDepth;
  renderer.autoClearStencil = state.autoClearStencil;
};

const encodePng = async (
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> => {
  if (typeof document === "undefined") {
    throw new ShotExportError(
      "SHOT_PNG_ENCODER_UNAVAILABLE",
      "PNG encoding is only available in a browser document.",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context || typeof canvas.toBlob !== "function") {
    throw new ShotExportError(
      "SHOT_PNG_ENCODER_UNAVAILABLE",
      "This browser does not provide a compatible PNG encoder.",
    );
  }

  const imageData = context.createImageData(width, height);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((encoded) => {
      if (!encoded) {
        reject(
          new ShotExportError(
            "SHOT_PNG_ENCODING_FAILED",
            "The browser could not encode the rendered shot as PNG.",
          ),
        );
        return;
      }
      resolve(encoded);
    }, "image/png");
  });

  if (blob.size === 0) {
    throw new ShotExportError(
      "SHOT_PNG_ENCODING_FAILED",
      "The browser returned an empty PNG file.",
    );
  }
  return blob;
};

const renderShotPixels = (
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  width: number,
  height: number,
): Uint8Array => {
  const maxTextureSize = renderer.capabilities.maxTextureSize;
  if (width > maxTextureSize || height > maxTextureSize) {
    throw new ShotExportError(
      "SHOT_RESOLUTION_UNSUPPORTED",
      `The requested ${width} × ${height} export exceeds this GPU's ${maxTextureSize}px limit.`,
    );
  }

  const renderTarget = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  renderTarget.texture.name = "shubi-shot-png-export";
  renderTarget.texture.colorSpace = renderer.outputColorSpace;

  const rendererState = captureRendererState(renderer);
  const pixels = new Uint8Array(width * height * 4);

  try {
    renderer.setRenderTarget(renderTarget);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissor(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(
      renderTarget,
      0,
      0,
      width,
      height,
      pixels,
    );
  } finally {
    try {
      restoreRendererState(renderer, rendererState);
    } finally {
      renderTarget.dispose();
    }
  }

  return flipRgbaRowsInPlace(pixels, width, height);
};

/**
 * Mount inside the final-shot R3F View, after ShotCamera. The registered handle
 * always renders that View's current scene and default camera.
 */
export const ShotExporter = ({
  output,
  registerExporter,
  defaultFileName = "perspective.png",
}: ShotExporterProps) => {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const { width, height } = output.resolutionPx;

  const exportPng = useCallback(
    async (options: ShotExportOptions = {}): Promise<ShotExportResult> => {
      const outputResult = outputSpecSchema.safeParse(output);
      if (!outputResult.success) {
        throw new ShotExportError(
          "SHOT_OUTPUT_INVALID",
          "The scene output settings are not a valid 16:9 resolution.",
          { cause: outputResult.error },
        );
      }

      const fileName = normalizePngFileName(
        options.fileName ?? defaultFileName,
      );
      const exportWidth = options.width ?? width;
      const exportHeight = options.height ?? height;
      if (
        !Number.isInteger(exportWidth) ||
        !Number.isInteger(exportHeight) ||
        exportWidth < 16 ||
        exportHeight < 16 ||
        exportWidth > 7680 ||
        exportHeight > 7680 ||
        exportWidth * exportHeight > 7680 * 4320
      ) {
        throw new ShotExportError(
          "SHOT_RESOLUTION_UNSUPPORTED",
          "The requested PNG export resolution is unsupported.",
        );
      }

      try {
        const pixels = renderShotPixels(
          renderer,
          scene,
          camera,
          exportWidth,
          exportHeight,
        );
        const blob = await encodePng(
          pixels,
          exportWidth,
          exportHeight,
        );
        if (options.download !== false) {
          triggerBlobDownload(blob, fileName);
        }
        return {
          width: exportWidth,
          height: exportHeight,
          fileName,
          blob,
        };
      } catch (cause) {
        if (cause instanceof ShotExportError) {
          throw cause;
        }
        if (cause instanceof BrowserDownloadError) {
          throw new ShotExportError(
            "SHOT_DOWNLOAD_FAILED",
            cause.message,
            { cause },
          );
        }
        throw new ShotExportError(
          "SHOT_EXPORT_FAILED",
          `Could not export the ${exportWidth} × ${exportHeight} perspective PNG.`,
          { cause },
        );
      }
    },
    [
      camera,
      defaultFileName,
      height,
      output,
      renderer,
      scene,
      width,
    ],
  );

  const handle = useMemo<ShotExporterHandle>(
    () => ({ exportPng }),
    [exportPng],
  );

  useEffect(() => {
    registerExporter(handle);
    return () => registerExporter(null);
  }, [handle, registerExporter]);

  return null;
};
