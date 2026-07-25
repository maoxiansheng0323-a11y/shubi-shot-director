import { describe, expect, it } from "vitest";
import { normalizePngFileName } from "../src/editor/download";
import {
  ShotExportError,
  flipRgbaRowsInPlace,
} from "../src/three/shot-export-utils";

describe("normalizePngFileName", () => {
  it("uses the stable perspective.png default", () => {
    expect(normalizePngFileName()).toBe("perspective.png");
  });

  it("removes path components and normalizes the extension", () => {
    expect(normalizePngFileName("../exports/Low angle.PNG")).toBe(
      "Low-angle.png",
    );
  });

  it("falls back when no usable name remains", () => {
    expect(normalizePngFileName("...")).toBe("perspective.png");
  });
});

describe("flipRgbaRowsInPlace", () => {
  it("converts bottom-up WebGL rows to top-down PNG rows", () => {
    const bottomLeft = [1, 2, 3, 255];
    const bottomRight = [4, 5, 6, 255];
    const topLeft = [7, 8, 9, 255];
    const topRight = [10, 11, 12, 255];
    const pixels = new Uint8Array([
      ...bottomLeft,
      ...bottomRight,
      ...topLeft,
      ...topRight,
    ]);

    expect([...flipRgbaRowsInPlace(pixels, 2, 2)]).toEqual([
      ...topLeft,
      ...topRight,
      ...bottomLeft,
      ...bottomRight,
    ]);
  });

  it("leaves an odd center row in place", () => {
    const pixels = new Uint8Array([
      1, 0, 0, 255,
      2, 0, 0, 255,
      3, 0, 0, 255,
    ]);

    expect([...flipRgbaRowsInPlace(pixels, 1, 3)]).toEqual([
      3, 0, 0, 255,
      2, 0, 0, 255,
      1, 0, 0, 255,
    ]);
  });

  it("rejects mismatched dimensions with a readable error", () => {
    expect(() =>
      flipRgbaRowsInPlace(new Uint8Array(4), 2, 2),
    ).toThrowError(ShotExportError);
    expect(() =>
      flipRgbaRowsInPlace(new Uint8Array(4), 2, 2),
    ).toThrow("does not match its dimensions");
  });
});
