import { describe, expect, it } from "vitest";
import {
  compactWorkspacePanes,
  isCompactViewportPane,
  paneAfterSceneSelection,
} from "../src/editor/compact-workspace";

describe("compact workspace navigation", () => {
  it("keeps every required editor surface reachable through one tab", () => {
    expect(compactWorkspacePanes.map((pane) => pane.id)).toEqual([
      "scene",
      "editor",
      "shot",
      "inspector",
    ]);
    expect(
      new Set(compactWorkspacePanes.map((pane) => pane.controls)).size,
    ).toBe(compactWorkspacePanes.length);
  });

  it("distinguishes both viewport panes from side-panel panes", () => {
    expect(isCompactViewportPane("editor")).toBe(true);
    expect(isCompactViewportPane("shot")).toBe(true);
    expect(isCompactViewportPane("scene")).toBe(false);
    expect(isCompactViewportPane("inspector")).toBe(false);
  });

  it("routes a scene-list selection to the editable properties pane", () => {
    expect(paneAfterSceneSelection()).toBe("inspector");
  });
});
