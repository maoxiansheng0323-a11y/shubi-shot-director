import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

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
