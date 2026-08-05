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
    expect(source).toContain('entity.lockMode === "user"');
    expect(app).toContain('entity.lockMode === "workflow"');
  });
});
