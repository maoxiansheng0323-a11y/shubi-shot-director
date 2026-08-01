import { describe, expect, it } from "vitest";
import { renderSceneToPng } from "../server/software-png";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  isLegacyActorEntity,
  sceneSpecSchema,
} from "../src/domain/scene-schema";

const createSpatialScene = () => {
  const base = createDefaultScene();
  return sceneSpecSchema.parse({
    ...base,
    entities: base.entities.filter(
      (entity) => entity.kind !== "environment",
    ),
    constraints: [],
    spatialLayout: {
      floorY: 0,
      regions: [
        {
          id: "region_alpha",
          label: "Alpha",
          footprintXZ: [
            [-3, -2],
            [3, -2],
            [3, 2],
            [-3, 2],
          ],
          heightM: 2.8,
          visible: true,
        },
      ],
      boundaries: [
        {
          id: "boundary_alpha_north",
          label: "Alpha North",
          regionIds: ["region_alpha"],
          startXZ: [-3, -2],
          endXZ: [3, -2],
          heightM: 2.8,
          thicknessM: 0.1,
          visible: true,
        },
      ],
      openings: [],
      connections: [],
      memberships: [],
    },
  });
};

describe("software PNG spatial projection", () => {
  it("reports zero accepted actor draw operations when every primitive is clipped", () => {
    const scene = createDefaultScene();
    const actor = scene.entities.find(isLegacyActorEntity);
    if (!actor) throw new Error("Actor fixture is missing.");
    actor.transform.positionM = [10_000, 10_000, 10_000];

    const counts = renderSceneToPng(scene, 320, 180)
      .diagnostics.actorPrimitiveDrawCounts[actor.id];

    expect(counts).toBeDefined();
    expect(Object.values(counts ?? {}).every((count) => count === 0)).toBe(true);
  });

  it("includes generic region boundaries in the exported perspective", () => {
    const visibleScene = createSpatialScene();
    const hiddenScene = sceneSpecSchema.parse({
      ...visibleScene,
      spatialLayout: {
        ...visibleScene.spatialLayout!,
        boundaries: visibleScene.spatialLayout!.boundaries.map(
          (boundary) => ({ ...boundary, visible: false }),
        ),
      },
    });

    const visible = renderSceneToPng(visibleScene, 320, 180).png;
    const hidden = renderSceneToPng(hiddenScene, 320, 180).png;

    expect(visible.equals(hidden)).toBe(false);
  });
});
