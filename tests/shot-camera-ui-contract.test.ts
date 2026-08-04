import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import { ShotCameraNavigation } from "../src/editor/ShotCameraNavigation";

const readSource = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const renderNavigation = (
  scene = createDefaultScene(),
  disabled = false,
): string =>
  renderToStaticMarkup(
    createElement(ShotCameraNavigation, {
      scene,
      disabled,
      onUnlockUserProtectedCamera: () => undefined,
      onDraftChange: () => undefined,
      onCommitTransform: async () => undefined,
      onCommitFocalLength: async () => undefined,
    }),
  );

describe("shot camera navigation UI contract", () => {
  it("owns Shot Preview input without a hidden activation mode", () => {
    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );

    expect(source).not.toContain("const [active, setActive]");
    expect(source).not.toContain("aria-pressed={active}");
    expect(source).not.toContain(
      'style={{ pointerEvents: active ? "auto" : "none" }}',
    );
    expect(source).toContain("onPointerDown");
    expect(source).toContain("onPointerMove");
    expect(source).toContain("onPointerUp");
    expect(source).toContain("onPointerCancel");
    expect(source).toContain("onContextMenu");
    expect(source).toMatch(
      /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/u,
    );
    expect(source).not.toMatch(
      /onContextMenu[\s\S]{0,180}pointerGestureRef\.current/u,
    );
    expect(source).toContain(
      'addEventListener("wheel", handleWheel, { passive: false })',
    );
    expect(source).toContain(
      'removeEventListener("wheel", handleWheel)',
    );
    expect(source).not.toContain("onWheel={handleWheel}");
    expect(source).toContain(
      'addEventListener("keydown", handleKeyDown)',
    );
    expect(source).toContain(
      'addEventListener("keyup", handleKeyUp)',
    );
    expect(source).toContain("preventDefault");
    expect(source).toContain("setPointerCapture");
    expect(source).toContain("releasePointerCapture");
    expect(source).toContain("WHEEL_COMMIT_DELAY_MS = 180");
    expect(source).not.toContain("sceneClient");
    expect(source).not.toContain("useEditorStore");
  });

  it("suppresses right-click before a user lock can short-circuit input", () => {
    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );
    const pointerDown = source.slice(
      source.indexOf("const handlePointerDown"),
      source.indexOf("const handlePointerMove"),
    );

    expect(pointerDown).toContain("event.button === 2");
    expect(pointerDown.indexOf("event.preventDefault()"))
      .toBeLessThan(pointerDown.indexOf('camera.lockMode === "user"'));
  });

  it("renders a controlled explicit target selector that defaults to free rotation", () => {
    const markup = renderNavigation();

    expect(markup).toContain("Target lock");
    expect(markup).toContain(
      'aria-label="Right-drag orbit target"',
    );
    expect(markup).toContain("Off (free rotation)");
    expect(markup).toContain("Generic actor");
    expect(markup).toContain("Blocking cube");

    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );
    expect(source).toContain(
      "useState<string | null>(null)",
    );
    expect(source).toContain("listShotOrbitTargets(scene)");
    expect(source).toContain('value={targetEntityId ?? ""}');
  });

  it("builds target options only from the stable visible actor and prop list", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find(
      (entity) => entity.kind === "actor",
    );
    const prop = scene.entities.find(
      (entity) => entity.kind === "prop",
    );
    if (!actor || !prop) throw new Error("Missing target fixtures.");
    actor.visible = false;
    scene.entities.push({
      ...structuredClone(prop),
      id: "prop_generic_2",
      label: "Second prop",
    });

    const markup = renderNavigation(scene);

    expect(markup).not.toContain("Generic actor");
    expect(markup.indexOf("Blocking cube")).toBeLessThan(
      markup.indexOf("Second prop"),
    );
    expect(markup).not.toContain("Room shell");
    expect(markup).not.toContain("Shot camera");
  });

  it("captures target and pan references at pointer-down and does not retarget mid-drag", () => {
    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );
    const pointerDown = source.slice(
      source.indexOf("const handlePointerDown"),
      source.indexOf("const handlePointerMove"),
    );
    const pointerMove = source.slice(
      source.indexOf("const handlePointerMove"),
      source.indexOf("const finishPointerGesture"),
    );

    expect(pointerDown).toContain("resolveShotOrbitTargetCenter");
    expect(pointerDown).toContain("deriveShotPanReferenceDistance");
    expect(pointerDown).toContain("targetEntityId:");
    expect(pointerDown).toContain("targetM:");
    expect(pointerDown).toContain("panReferenceDistanceM:");
    expect(pointerMove).toContain("rotateShotCameraFree");
    expect(pointerMove).toContain("orbitShotCamera");
    expect(pointerMove).toContain("gesture.targetEntityId");
    expect(pointerMove).toContain("gesture.targetM");
    expect(pointerMove).toContain("gesture.panReferenceDistanceM");
    expect(pointerMove).not.toContain("resolveShotOrbitTargetCenter");
    expect(pointerMove).not.toContain("deriveShotPanReferenceDistance");
  });

  it("reconciles target validity independently from revision draft cancellation", () => {
    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );

    expect(source).toContain("reconcileShotOrbitTargetId");
    expect(source).toContain("previous.sceneId");
    expect(source).toContain("previous.cameraId");
    expect(source).toContain("expectedOwnRevisionRef.current === scene.revision");
    expect(source).toMatch(
      /reconcileShotOrbitTargetId[\s\S]*expectedOwnRevisionRef\.current === scene\.revision/u,
    );
  });

  it("disables target changes during protected, disabled, drag, draft, and pending states", () => {
    expect(renderNavigation(createDefaultScene(), true)).toMatch(
      /<select[^>]*aria-label="Right-drag orbit target"[^>]*disabled=""/u,
    );

    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );
    expect(source).toMatch(
      /const targetSelectorDisabled =[\s\S]{0,220}controlsDisabled[\s\S]{0,220}dragging[\s\S]{0,220}draft/u,
    );
    expect(source).toContain("disabled={targetSelectorDisabled}");
    expect(source).toContain("isEditableTarget(event.target)");
  });

  it("keeps shot navigation independent from studio selection and automatic targets", () => {
    const navigation = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");

    expect(navigation).not.toContain("onSelectCamera");
    expect(navigation).not.toContain("deriveShotOrbitTarget");
    expect(navigation).not.toContain("type ShotOrbitTarget");
    expect(navigation).not.toContain("orbitTargetRef");
    expect(workspace).not.toContain("onSelectCamera={onSelect}");
  });

  it("keeps the target selector in the compact wrapping control band", () => {
    const styles = readSource("src/styles.css");

    expect(styles).toContain(".shot-camera-target-control");
    expect(styles).toMatch(
      /\.shot-camera-controls\s*\{[\s\S]*?flex-wrap:\s*wrap/u,
    );
    expect(styles).toMatch(
      /\.shot-preview-image\s*\{[\s\S]*?position:\s*relative[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/u,
    );
    expect(styles).toMatch(
      /\.shot-camera-controls\s*\{[\s\S]*?position:\s*static[\s\S]*?grid-row:\s*2/u,
    );
    expect(styles).toMatch(
      /\.shot-camera-surface\s*\{[\s\S]*?grid-row:\s*1/u,
    );
    const controlsRule = styles.match(
      /\.shot-camera-controls\s*\{([\s\S]*?)\}/u,
    )?.[1];
    expect(controlsRule).not.toMatch(/position:\s*absolute/u);
  });

  it("offers six explicit one-click camera movement controls", () => {
    const source = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );

    for (const label of [
      "镜头前移",
      "镜头后移",
      "镜头左移",
      "镜头右移",
      "镜头上移",
      "镜头下移",
    ]) {
      expect(source).toContain(`aria-label="${label}"`);
    }
    expect(source).toContain("moveShotCameraByKey(baseCamera, key, {})");
    expect(source).toContain("createShotCameraGestureSession(scene, camera.id)");
    expect(source).toContain("disabled={controlsDisabled || draft?.pending}");
  });

  it("offers an in-preview unlock action when the camera is user protected", () => {
    const navigation = readSource(
      "src/editor/ShotCameraNavigation.tsx",
    );
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");
    const app = readSource("src/App.tsx");

    expect(navigation).toContain("onUnlockUserProtectedCamera");
    expect(navigation).toContain("解除保护并调整");
    expect(navigation).toContain('camera.lockMode === "user"');
    expect(workspace).toContain("onUnlockUserProtectedCamera");
    expect(app).toContain(
      "onUnlockUserProtectedCamera={toggleActiveCameraLock}",
    );
  });

  it("projects draft focal length through the final Three camera", () => {
    const source = readSource("src/three/SceneWorld.tsx");

    expect(source).toContain("focalLengthOverrideMm");
    expect(source).toContain(
      "focalLengthOverrideMm ?? cameraEntity.lens.focalLengthMm",
    );
  });

  it("uses filtered high-resolution shadows in the browser-rendered shot", () => {
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");
    const world = readSource("src/three/SceneWorld.tsx");

    expect(workspace).toContain('shadows="percentage"');
    expect(workspace).not.toContain('shadows="basic"');
    expect(world).toContain("shadow-mapSize-width={2048}");
    expect(world).toContain("shadow-mapSize-height={2048}");
    expect(world).toContain("shadow-radius={3}");
  });

  it("shares the effective final-camera transform with shot wall visibility", () => {
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");
    const world = readSource("src/three/SceneWorld.tsx");

    expect(workspace).toContain("effectiveCameraTransform");
    expect(workspace).toContain(
      "shotCameraTransform={effectiveCameraTransform}",
    );
    expect(world).toContain("deriveHiddenShotWallBoxKey");
    expect(world).toContain('view === "shot"');
    expect(world).toContain("hiddenWallBoxKey");
  });

  it("wires lock-preserving drafts through the workspace and App", () => {
    const workspace = readSource("src/editor/ViewportWorkspace.tsx");
    const app = readSource("src/App.tsx");

    expect(workspace).toContain("<ShotCameraNavigation");
    expect(workspace).toContain("focalLengthOverrideMm");
    expect(workspace).toContain("onCameraDraftChange");
    expect(app).toContain("preserveLock: true");
    expect(app).toContain("cameraDraftActive");
    expect(app).toMatch(/exportDisabled[\s\S]*cameraDraftActive/u);
  });
});
