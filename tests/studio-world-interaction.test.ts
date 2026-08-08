import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("studio world interaction contract", () => {
  it("keeps entity focus in the editor projection", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    expect(source).toContain("onDoubleClick={onDoubleClick}");
    expect(source).toContain('focused ? "#ef6a6a"');
    expect(source).toContain('focused ? "#ef4444"');
  });

  it("classifies right-click clearing only at the editor surface", () => {
    const controller = readSource(
      "src/editor/StudioInteractionController.tsx",
    );
    const world = readSource("src/three/SceneWorld.tsx");
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");

    for (const eventName of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "pointerleave",
      "contextmenu",
    ]) {
      expect(controller).toContain(
        `surface.addEventListener("${eventName}"`,
      );
    }
    expect(world).not.toContain("onContextMenu={onContextMenu}");
    expect(world).not.toContain("onContextMenu={(event)");
    expect(workspace).not.toContain("onContextMenu={(event)");
    expect(workspace).toContain(
      "Editor viewport. Left-drag to pan, right-drag to orbit, and scroll to zoom.",
    );
  });

  it("routes limb pointer movement through a temporary joint draft", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const jointSection = source.slice(
      source.indexOf("const ActorRigPrimitiveMesh"),
      source.indexOf("const MannequinActor"),
    );
    expect(source).toContain("beginJointDrag");
    expect(source).toContain("onActorJointDraft");
    expect(source).toContain('focusedActorJointId === jointId');
    expect(jointSection).toContain("jointPointerIdRef");
    expect(jointSection).toContain("bindJointDocumentListeners");
    expect(jointSection).not.toContain("setPointerCapture(event.pointerId)");
    expect(jointSection).toContain("editorCameraControls.enabled = false");
    expect(jointSection).toContain("editorCameraControls.enabled = true");
  });

  it("maps the visible head to the neck joint for direct rotation", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const mappingSection = source.slice(
      source.indexOf("const primitiveToJointId"),
      source.indexOf("const EntityProjection"),
    );
    expect(mappingSection).toContain('primitiveId === "neck"');
    expect(mappingSection).toContain('primitiveId === "head"');
    expect(mappingSection).toContain('primitiveId === "face"');
    expect(mappingSection).toContain('return "neck";');
  });

  it("keeps joint pointer handling on loaded refined mannequin sections", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const refinedSection = source.slice(
      source.indexOf("const renderRefined"),
      source.indexOf("return (", source.indexOf("const renderRefined")),
    );
    expect(refinedSection).toContain("<ActorRigPrimitiveMesh");
    expect(refinedSection).toContain("refinedGeometry={geometry}");
    expect(refinedSection).toContain("refinedTransform={transform}");
  });

  it("binds joint pointer handlers to the raycast mesh instead of its group", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const jointSection = source.slice(
      source.indexOf("const ActorRigPrimitiveMesh"),
      source.indexOf("const MannequinActor"),
    );
    expect(jointSection).toContain("onPointerDown={onJointPointerDown}");
    expect(jointSection).toContain("onPointerMove={onJointPointerMove}");
    expect(jointSection).toContain("onPointerUp={onJointPointerUp}");
    expect(jointSection).toContain("onClick={onJointClick}");
  });

  it("focuses an actor and its joint from the first supported-part press", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const actorProjection = source.slice(
      source.indexOf('case "actor":'),
      source.indexOf('case "camera":'),
    );
    expect(actorProjection).toContain("onFocusEntity?.(entity.id);");
    expect(actorProjection).toContain("onFocusActorJoint?.(jointId);");
    expect(actorProjection).not.toContain(
      "focused ? onFocusActorJoint : undefined",
    );
  });

  it("does not request a second editor-camera frame for a joint on the focused actor", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    expect(source).toContain("if (!focused) onFocusEntity?.(entity.id);");
  });

  it("does not commit a joint patch until the part drag crosses the threshold", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const jointSection = source.slice(
      source.indexOf("const ActorRigPrimitiveMesh"),
      source.indexOf("const MannequinActor"),
    );
    expect(jointSection).toContain("moved: boolean");
    expect(jointSection).toContain("hasStudioPointerExceededDragThreshold");
    expect(jointSection).toContain("if (!active.moved)");
    expect(jointSection).toContain("if (active.moved)");
  });

  it("finishes a joint gesture from document pointer events after leaving the mesh", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const jointSection = source.slice(
      source.indexOf("const ActorRigPrimitiveMesh"),
      source.indexOf("const MannequinActor"),
    );
    expect(jointSection).toContain("jointDocumentCleanupRef");
    expect(jointSection).toContain(
      'ownerDocument.addEventListener("pointermove", handleDocumentPointerMove, true);',
    );
    expect(jointSection).toContain(
      'ownerDocument.addEventListener("pointerup", handleDocumentPointerUp, true);',
    );
  });

  it("routes focused camera proxy dragging through rotation capture", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const entitySection = source.slice(
      source.indexOf("const EntityProjection"),
      source.indexOf("export const SceneWorld"),
    );
    expect(entitySection).toContain("directEntityDragMode");
    expect(entitySection).toContain("beginEntityRotationDrag");
    expect(entitySection).toContain("updateEntityRotationDrag");
    expect(entitySection).toContain("directDragDocumentCleanupRef");
    expect(entitySection).toContain("bindDirectRotationDocumentListeners");
    expect(entitySection).toContain("subscribeStudioPointerDrag");
    expect(entitySection).toContain("event.nativeEvent.preventDefault();");
    expect(entitySection).toMatch(
      /if \(capture\.mode === "rotate"\) \{\s*bindDirectRotationDocumentListeners\(\);/,
    );
  });

  it("keeps entity focus while a focused proxy transform is committed", () => {
    const world = readSource("src/three/SceneWorld.tsx");
    const pointerDown = world.slice(
      world.indexOf("const onPointerDown", world.indexOf("const EntityProjection")),
      world.indexOf("const onPointerMove", world.indexOf("const EntityProjection")),
    );
    expect(pointerDown).toContain("if (!focused) onSelectEntity(entity.id);");

    const workspace = readSource("src/editor/ViewportWorkspace.tsx");
    const transformCommit = workspace.slice(
      workspace.indexOf("const handleTransformCommit"),
      workspace.indexOf("const handleActorJointDraft"),
    );
    expect(transformCommit).toContain("focusedEntityId !== entityId");
  });

  it("keeps right-button misses out of the ordinary empty-space selection path", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    expect(source).toContain("onPointerMissed={(event) => {");
    expect(source).toContain(
      'if (view === "editor" && event.button === 0) onSelectEntity(null);',
    );
  });

  it("keeps user protection blocking while workflow locks remain editable", () => {
    const source = readSource("src/three/SceneWorld.tsx");
    const app = readSource("src/App.tsx");
    expect(source).toContain("directEntityDragMode");
    expect(source).toContain("lockMode: entity.lockMode");
    expect(app).toContain('entity.lockMode === "workflow"');
  });

  it("keeps the editor camera imperative between explicit focus requests", () => {
    const source = readSource("src/editor/EditorCameraRig.tsx");
    expect(source).toContain("shouldApplyEditorCameraFrame");
    expect(source).toContain("initialFrameRef");
    expect(source).toContain("frameRequestVersion");
    expect(source).toContain("mouseButtons={EDITOR_VIEW_MOUSE_BUTTONS}");
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
