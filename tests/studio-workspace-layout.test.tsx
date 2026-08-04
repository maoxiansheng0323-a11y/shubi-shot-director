import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("persistent studio workspace layout contract", () => {
  it("keeps spatial preview modes limited to editor filters", () => {
    const source = readSource("src/editor/spatial-preview.ts");
    expect(source).toContain('export type SpatialPreviewMode = "overview" | "local"');
    expect(source).not.toContain('SpatialPreviewMode = "overview" | "local" | "shot"');
  });

  it("models shot preview expansion separately from editor filtering", () => {
    const source = readSource("src/editor/ViewportWorkspace.tsx");
    const controls = readSource("src/editor/CompactShotPreviewControls.tsx");
    expect(source).toContain("shotPreviewExpanded");
    expect(source).toContain("CompactShotPreviewControls");
    expect(source).toContain("onActivateShotCamera");
    expect(controls).toContain('data-studio-keyboard-exclusion');
  });

  it("keeps one persistent editor view and one shot view/exporter", () => {
    const source = readSource("src/editor/ViewportWorkspace.tsx");
    expect(source.match(/<View id=/g)?.length).toBe(2);
    expect(source.match(/<ShotExporter\b/g)?.length).toBe(1);
    expect(source).toContain('data-testid="editor-viewport"');
    expect(source).toContain('data-testid="shot-preview"');
  });

  it("does not couple compact workspace tabs to the shot spatial mode", () => {
    const source = readSource("src/App.tsx");
    expect(source).not.toContain('setPreviewMode("shot")');
    expect(source).toContain("shotPreviewExpanded");
  });
});
