import { describe, expect, it } from "vitest";
import { analyzeComposition } from "../src/domain/composition-safety";
import { createDefaultScene } from "../src/domain/default-scene";
import { actorAnchorWorldPoint } from "../src/domain/humanoid-rig";
import { lookAtQuaternion } from "../src/domain/scene-math";
import {
  sceneSpecSchema,
  type ActorEntity,
  type CameraEntity,
} from "../src/domain/scene-schema";

const createSpatialSightlineScene = (z: number) => {
  const base = createDefaultScene();
  const actor = base.entities.find(
    (entity): entity is ActorEntity => entity.kind === "actor",
  )!;
  const camera = base.entities.find(
    (entity): entity is CameraEntity => entity.kind === "camera",
  )!;
  actor.transform.positionM = [2, actor.transform.positionM[1], z];
  camera.transform.positionM = [-2, 1.45, z];
  camera.transform.rotation = lookAtQuaternion(
    camera.transform.positionM,
    actorAnchorWorldPoint(actor, "chest"),
  );
  return sceneSpecSchema.parse({
    ...base,
    entities: [actor, camera],
    constraints: [],
    compositionGoals: {
      criticalEntityIds: [actor.id],
    },
    spatialLayout: {
      floorY: 0,
      regions: [
        {
          id: "region_alpha",
          label: "Alpha",
          footprintXZ: [
            [-4, -2],
            [0, -2],
            [0, 2],
            [-4, 2],
          ],
          heightM: 2.8,
          visible: true,
        },
        {
          id: "region_beta",
          label: "Beta",
          footprintXZ: [
            [0, -2],
            [4, -2],
            [4, 2],
            [0, 2],
          ],
          heightM: 2.8,
          visible: true,
        },
      ],
      boundaries: [
        {
          id: "boundary_alpha_beta",
          label: "Alpha Beta",
          regionIds: ["region_alpha", "region_beta"],
          startXZ: [0, -2],
          endXZ: [0, 2],
          heightM: 2.8,
          thicknessM: 0.1,
          visible: true,
        },
      ],
      openings: [
        {
          id: "opening_alpha_beta",
          label: "Alpha Beta Opening",
          boundaryId: "boundary_alpha_beta",
          offsetM: 1.4,
          widthM: 1.2,
          bottomM: 0,
          heightM: 2.1,
          visible: true,
        },
      ],
      connections: [
        {
          id: "connection_alpha_beta",
          label: "Alpha Beta Connection",
          regionIds: ["region_alpha", "region_beta"],
          openingId: "opening_alpha_beta",
          allowsPassage: true,
          allowsSight: true,
          enabled: true,
        },
      ],
      memberships: [
        { entityId: actor.id, regionId: "region_beta" },
        { entityId: camera.id, regionId: "region_alpha" },
      ],
    },
  });
};

describe("spatial composition safety", () => {
  it("keeps a sightline through an opening clear", () => {
    const report = analyzeComposition(createSpatialSightlineScene(0));

    expect(report.topologySafe.issueCodes).not.toContain(
      "SIGHTLINE_INTERSECTS_WALL",
    );
  });

  it("detects a sightline through a solid boundary segment", () => {
    const report = analyzeComposition(createSpatialSightlineScene(1.2));

    expect(report.topologySafe.issueCodes).toContain(
      "SIGHTLINE_INTERSECTS_WALL",
    );
  });

  it("does not treat a non-sight connection as an open sightline", () => {
    const scene = createSpatialSightlineScene(0);
    scene.spatialLayout!.connections[0].allowsSight = false;

    expect(analyzeComposition(scene).topologySafe.issueCodes).toContain(
      "SIGHTLINE_INTERSECTS_WALL",
    );
  });

  it("detects a camera placed inside a spatial wall", () => {
    const scene = createSpatialSightlineScene(1.2);
    const camera = scene.entities.find(
      (entity): entity is CameraEntity => entity.kind === "camera",
    )!;
    camera.transform.positionM = [0, 1.45, 1.2];

    expect(
      analyzeComposition(scene).cameraCollisionSafe.issueCodes,
    ).toContain("CAMERA_COLLIDES_WALL");
  });
});
