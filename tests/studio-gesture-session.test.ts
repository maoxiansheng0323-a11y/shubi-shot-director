import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  createStudioEntityGestureSession,
  decideStudioEntityGesture,
} from "../src/editor/studio-gesture-session";

describe("studio entity gesture sessions", () => {
  it("captures exact scene, revision, entity, kind, and focus", () => {
    const scene = createDefaultScene();
    const session = createStudioEntityGestureSession(
      scene,
      "actor_generic_1",
      "actor",
      "actor_generic_1",
    );
    expect(session).toMatchObject({
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      entityId: "actor_generic_1",
      entityKind: "actor",
      focusedEntityId: "actor_generic_1",
      cancelled: false,
    });
    expect(decideStudioEntityGesture(session, scene, "actor_generic_1")).toEqual({
      status: "commit",
      preserveLock: false,
    });
  });

  it("preserves workflow locks, blocks user locks, and rejects stale sessions", () => {
    const scene = createDefaultScene();
    const workflow = structuredClone(scene);
    workflow.entities.find((entity) => entity.id === "prop_block_1")!.lockMode =
      "workflow";
    const workflowSession = createStudioEntityGestureSession(
      workflow,
      "prop_block_1",
      "prop",
      "prop_block_1",
    );
    expect(
      decideStudioEntityGesture(workflowSession, workflow, "prop_block_1"),
    ).toEqual({ status: "commit", preserveLock: true });

    const user = structuredClone(scene);
    user.entities.find((entity) => entity.id === "prop_block_1")!.lockMode = "user";
    const userSession = createStudioEntityGestureSession(
      user,
      "prop_block_1",
      "prop",
      "prop_block_1",
    );
    expect(decideStudioEntityGesture(userSession, user, "prop_block_1")).toEqual({
      status: "blocked",
      code: "USER_LOCKED",
    });

    const stale = { ...workflowSession, baseRevision: workflow.revision - 1 };
    expect(decideStudioEntityGesture(stale, workflow, "prop_block_1")).toEqual({
      status: "conflict",
      code: "STUDIO_GESTURE_REVISION_CONFLICT",
    });
  });
});
