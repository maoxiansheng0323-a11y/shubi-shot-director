import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import type { EntityLockMode } from "../src/domain/entity-lock";
import { Inspector } from "../src/editor/Inspector";
import { Outliner } from "../src/editor/Outliner";

const renderLockOutliner = (): string => {
  const scene = createDefaultScene();
  scene.entities[0]!.lockMode = "workflow";
  scene.entities[1]!.lockMode = "user";
  return renderToStaticMarkup(
    createElement(Outliner, {
      scene,
      selectedId: null,
      selectedRegionId: null,
      onSelect: () => undefined,
      onSelectRegion: () => undefined,
    }),
  );
};

const renderTransformInspector = (lockMode: EntityLockMode): string => {
  const scene = createDefaultScene();
  const entity = scene.entities[0]!;
  entity.lockMode = lockMode;
  return renderToStaticMarkup(
    createElement(Inspector, {
      scene,
      selectedId: entity.id,
      disabled: false,
      onCommitTransform: () => undefined,
    }),
  );
};

const positionXInput = (markup: string): string => {
  const input = markup.match(
    /<input[^>]*aria-label="位置 X，单位米"[^>]*>/u,
  )?.[0];
  if (!input) {
    throw new Error("Rendered Inspector is missing the position X input.");
  }
  return input;
};

describe("editor lock semantics", () => {
  it("renders visible Chinese and hidden English meaning for both lock modes", () => {
    const markup = renderLockOutliner();

    expect(markup).toContain(
      '<span aria-hidden="true">流程锁定</span><span class="visually-hidden">Workflow locked</span>',
    );
    expect(markup).toContain(
      '<span aria-hidden="true">用户保护</span><span class="visually-hidden">User protected</span>',
    );
    expect(markup).not.toContain('aria-label="Workflow locked"');
    expect(markup).not.toContain('aria-label="User protected"');
  });

  it.each(["workflow", "user"] as const)(
    "disables transform editing for %s locks",
    (lockMode) => {
      expect(
        positionXInput(renderTransformInspector(lockMode)),
      ).toContain("disabled");
    },
  );

  it("keeps transform editing enabled without a lock", () => {
    expect(
      positionXInput(renderTransformInspector("none")),
    ).not.toContain("disabled");
  });

  it("keeps save handling async and removes the legacy lock API from editor call sites", () => {
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/App.tsx", import.meta.url)),
      "utf8",
    );
    expect(appSource).toContain("await saveScene()");
    expect(appSource).not.toContain("createLockedPatch");

    for (const relativePath of [
      "../src/App.tsx",
      "../src/editor/Outliner.tsx",
      "../src/editor/Inspector.tsx",
      "../src/editor/ActorPresetControls.tsx",
      "../src/editor/ViewportWorkspace.tsx",
      "../src/three/SceneWorld.tsx",
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      );
      expect(source).not.toContain(".locked");
    }
  });

  it("routes limb edits through a fresh authoritative store snapshot", () => {
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/App.tsx", import.meta.url)),
      "utf8",
    );
    const inspectorSource = readFileSync(
      fileURLToPath(new URL("../src/editor/Inspector.tsx", import.meta.url)),
      "utf8",
    );

    expect(appSource).toContain("applyActorLimbPresenceCommand");
    expect(appSource).toContain("const setLimbPresence = useCallback");
    expect(appSource).toContain("useEditorStore.getState");
    expect(appSource).toContain("onSetLimbPresence={setLimbPresence}");
    expect(inspectorSource).toContain("onSetLimbPresence?:");
    expect(inspectorSource).toContain("<ActorLimbControls");
  });

  it("routes stature and joint edits through fresh authoritative store snapshots", () => {
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/App.tsx", import.meta.url)),
      "utf8",
    );
    const inspectorSource = readFileSync(
      fileURLToPath(new URL("../src/editor/Inspector.tsx", import.meta.url)),
      "utf8",
    );

    expect(appSource).toContain("const setActorHeight = useCallback");
    expect(appSource).toContain("const setActorJointRotation = useCallback");
    expect(appSource).toContain("createActorHeightPatch(currentScene");
    expect(appSource).toContain("createActorJointPatch(currentScene");
    expect(appSource.match(/useEditorStore\.getState\(\)/gu)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(appSource).toContain("onSetHeight={setActorHeight}");
    expect(appSource).toContain(
      "onSetJointRotation={setActorJointRotation}",
    );
    expect(inspectorSource).toContain("onSetHeight?:");
    expect(inspectorSource).toContain("onSetJointRotation?:");
    expect(inspectorSource).toContain("<ActorStatureControls");
    expect(inspectorSource).toContain("<ActorJointControls");
  });
});
