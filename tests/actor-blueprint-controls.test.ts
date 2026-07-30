import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ActorBlueprintControls,
  dispatchActorVariantChange,
} from "../src/editor/ActorBlueprintControls";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  isBlueprintActorEntity,
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const blueprintFixture = () => {
  const scene: SceneSpec = sceneSpecSchema.parse(createDefaultScene());
  scene.entities = scene.entities.filter(
    (entity) => entity.kind !== "actor",
  );
  scene.constraints = [];
  scene.actorBlueprints = [
    createActorBlueprintSnapshot(createGenericActorBlueprintDocument()),
  ];
  scene.entities.push(createBlueprintActor());
  const parsed = sceneSpecSchema.parse(scene);
  const actor = parsed.entities.find(isBlueprintActorEntity);
  if (!actor) throw new Error("Blueprint actor fixture is missing.");
  return { scene: parsed, actor };
};

describe("ActorBlueprintControls", () => {
  it("shows a read-only summary and only the snapshot's existing variants", () => {
    const { scene, actor } = blueprintFixture();
    const markup = renderToStaticMarkup(
      createElement(ActorBlueprintControls, {
        scene,
        actor,
        disabled: false,
        onSetVariant: () => undefined,
      }),
    );

    expect(markup).toContain("Actor Blueprint");
    expect(markup).toContain("actor_blueprint_1");
    expect(markup).toContain(">damaged<");
    expect(markup).toContain(">repaired<");
    expect(markup).toContain(
      scene.actorBlueprints[0].contentSha256.slice(0, 12),
    );
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<input");
    for (const forbidden of [
      "Import",
      "Rename",
      "Duplicate",
      "Delete",
      "Module geometry",
      "Body proportions",
      "Skeleton editor",
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("submits only an existing variant and disables locked actors", () => {
    const { scene, actor } = blueprintFixture();
    const onSetVariant = vi.fn();
    const unlockedMarkup = renderToStaticMarkup(
      createElement(ActorBlueprintControls, {
        scene,
        actor,
        disabled: false,
        onSetVariant,
      }),
    );
    expect(unlockedMarkup).not.toContain("<select disabled");

    const lockedMarkup = renderToStaticMarkup(
      createElement(ActorBlueprintControls, {
        scene,
        actor: { ...actor, lockMode: "workflow" },
        disabled: false,
        onSetVariant,
      }),
    );
    expect(lockedMarkup).toContain('disabled=""');
    expect(
      dispatchActorVariantChange(
        actor.id,
        "repaired",
        new Set(["damaged", "repaired"]),
        onSetVariant,
      ),
    ).toBe(true);
    expect(onSetVariant).toHaveBeenCalledWith(actor.id, "repaired");
    expect(
      dispatchActorVariantChange(
        actor.id,
        "unlisted",
        new Set(["damaged", "repaired"]),
        onSetVariant,
      ),
    ).toBe(false);
  });
});
