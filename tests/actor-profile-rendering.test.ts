import { describe, expect, it } from "vitest";
import { LatheGeometry, Vector2 } from "three";
import * as sceneWorld from "../src/three/SceneWorld";

type ProfilePoint = { readonly y: number; readonly radius: number };
type ToCappedLathePoints = (
  points: readonly ProfilePoint[],
) => Vector2[];

describe("browser actor profile rendering", () => {
  it("adds zero-radius end caps without moving the authored profile rings", () => {
    const toCappedLathePoints = (
      sceneWorld as unknown as {
        toCappedLathePoints?: ToCappedLathePoints;
      }
    ).toCappedLathePoints;

    expect(toCappedLathePoints).toBeTypeOf("function");
    if (!toCappedLathePoints) return;

    const authored = [
      { y: -1, radius: 0.4 },
      { y: 0, radius: 0.7 },
      { y: 1, radius: 0.3 },
    ] as const;
    const rendered = toCappedLathePoints(authored);

    expect(rendered.map(({ x, y }) => [x, y])).toEqual([
      [0, -1],
      [0.4, -1],
      [0.7, 0],
      [0.3, 1],
      [0, 1],
    ]);

    const geometry = new LatheGeometry(rendered, 12);
    const positions = geometry.getAttribute("position");
    const endpointAxisVertices = { bottom: 0, top: 0 };
    for (let index = 0; index < positions.count; index += 1) {
      const radialLength = Math.hypot(
        positions.getX(index),
        positions.getZ(index),
      );
      if (radialLength > 1e-8) continue;
      if (Math.abs(positions.getY(index) + 1) <= 1e-8) {
        endpointAxisVertices.bottom += 1;
      }
      if (Math.abs(positions.getY(index) - 1) <= 1e-8) {
        endpointAxisVertices.top += 1;
      }
    }
    geometry.dispose();

    expect(endpointAxisVertices.bottom).toBeGreaterThan(0);
    expect(endpointAxisVertices.top).toBeGreaterThan(0);
  });
});
