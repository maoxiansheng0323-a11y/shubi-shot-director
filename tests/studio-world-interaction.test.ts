import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("studio world interaction contract", () => {
  it("keeps entity focus and context-menu clearing in the editor projection", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    expect(source).toContain("onDoubleClick={onDoubleClick}");
    expect(source).toContain("onContextMenu={onContextMenu}");
    expect(source).toContain('focused ? "#ef6a6a"');
    expect(source).toContain('focused ? "#ef4444"');
  });

  it("routes limb pointer movement through a temporary joint draft", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    expect(source).toContain("beginJointDrag");
    expect(source).toContain("onActorJointDraft");
    expect(source).toContain('focusedActorJointId === jointId');
  });

  it("keeps user protection blocking while workflow locks remain editable", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const app = readSource("src/App.tsx");
    expect(source).toContain("canBeginDirectEntityDrag");
    expect(source).toContain("lockMode: entity.lockMode");
    expect(app).toContain('entity.lockMode === "workflow"');
  });

  it("keeps the editor camera imperative between explicit focus requests", () => {
    const source = readSource("src/editor/EditorCameraRig.tsx");
    expect(source).toContain("shouldApplyEditorCameraFrame");
    expect(source).toContain("initialFrameRef");
    expect(source).toContain("frameRequestVersion");
    expect(source).not.toContain("position={frame.positionM}");
    expect(source).not.toContain("target={frame.targetM}");
  });

  it("captures entity drags, applies the shared threshold, and cancels through DOM events", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    expect(source).toContain("event.currentTarget as unknown");
    expect(source).toContain(
      "pointerCaptureTarget(event).setPointerCapture(event.pointerId)",
    );
    expect(source).toContain("capturedTarget.releasePointerCapture(event.pointerId)");
    expect(source).toContain("setEditorCameraControlsEnabled(false)");
    expect(source).toContain("setEditorCameraControlsEnabled(true)");
    expect(source).toContain("hasStudioPointerExceededDragThreshold");
    expect(source).toContain("startPointerPx");
    expect(source).toContain("subscribeStudioPointerCancellation");
    expect(source).toContain("onTransformCancelRef.current?.(entity.id)");
    expect(source).not.toContain("event.nativeEvent.currentTarget as HTMLElement");
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");
    expect(workspace).toContain("await onCommitTransform(entityId, transform);");
    expect(workspace).toContain("onSelect(entityId);");
    expect(workspace).toContain("onTransformCancel={handleTransformCancel}");
  });
});
