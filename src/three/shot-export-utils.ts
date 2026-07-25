export class ShotExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ShotExportError";
    this.code = code;
  }
}

/**
 * WebGL readback starts at the bottom-left. Canvas ImageData starts at the
 * top-left, so rows must be swapped exactly once before PNG encoding.
 */
export const flipRgbaRowsInPlace = (
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.byteLength !== width * height * 4
  ) {
    throw new ShotExportError(
      "SHOT_PIXEL_BUFFER_INVALID",
      "The rendered RGBA pixel buffer does not match its dimensions.",
    );
  }

  const rowBytes = width * 4;
  const temporaryRow = new Uint8Array(rowBytes);
  for (let top = 0; top < Math.floor(height / 2); top += 1) {
    const bottom = height - top - 1;
    const topStart = top * rowBytes;
    const bottomStart = bottom * rowBytes;
    temporaryRow.set(pixels.subarray(topStart, topStart + rowBytes));
    pixels.copyWithin(topStart, bottomStart, bottomStart + rowBytes);
    pixels.set(temporaryRow, bottomStart);
  }
  return pixels;
};
