import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  isBlueprintActorEntity,
  sceneSpecSchema,
  type ActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import { Inspector } from "../src/editor/Inspector";
import { createActorLimbPresencePatch } from "../src/editor/manual-patches";
import { dispatchActorLimbPresenceChange } from "../src/editor/ActorLimbControls";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
} from "./helpers/actor-blueprint-fixtures";

const requireActor = (scene: SceneSpec): ActorEntity => {
  const actor = scene.entities.find(
    (entity): entity is ActorEntity => entity.kind === "actor",
  );
  if (!actor) {
    throw new Error("Default scene is missing a generic actor fixture.");
  }
  return actor;
};

const renderActorInspector = (
  scene: SceneSpec,
  options: {
    disabled?: boolean;
    withCallback?: boolean;
  } = {},
): string => {
  const actor = requireActor(scene);
  return renderToStaticMarkup(
    createElement(Inspector, {
      scene,
      selectedId: actor.id,
      disabled: options.disabled ?? false,
      onSetLimbPresence:
        options.withCallback === false ? undefined : () => undefined,
    }),
  );
};

const limbSelects = (markup: string): Map<string, string> =>
  new Map(
    [...markup.matchAll(/<select(?=[^>]*data-limb-part="([^"]+)")[^>]*>[\s\S]*?<\/select>/gu)].map(
      (match) => [match[1], match[0]],
    ),
  );

const selectedMode = (selectMarkup: string): string | undefined =>
  selectMarkup.match(/<option value="([^"]+)" selected="">/u)?.[1];

describe("authoritative actor limb Inspector controls", () => {
  it("renders twelve labeled controls from the four canonical limb groups", () => {
    const markup = renderActorInspector(createDefaultScene());
    const controls = limbSelects(markup);

    expect([...controls.keys()]).toEqual([
      "upper_arm_l",
      "forearm_l",
      "hand_l",
      "upper_arm_r",
      "forearm_r",
      "hand_r",
      "upper_leg_l",
      "lower_leg_l",
      "foot_l",
      "upper_leg_r",
      "lower_leg_r",
      "foot_r",
    ]);
    for (const groupLabel of ["左臂", "右臂", "左腿", "右腿"]) {
      expect(markup).toContain(groupLabel);
    }
    for (const partLabel of [
      "左上臂",
      "左前臂",
      "左手",
      "右上臂",
      "右前臂",
      "右手",
      "左大腿",
      "左小腿",
      "左脚",
      "右大腿",
      "右小腿",
      "右脚",
    ]) {
      expect(markup).toContain(partLabel);
    }
    for (const select of controls.values()) {
      expect(select).toContain('value="present"');
      expect(select).toContain(">存在</option>");
      expect(select).toContain('value="absent"');
      expect(select).toContain(">缺失</option>");
    }
  });

  it("renders Blueprint variant and instance overrides as effective limb presence", () => {
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
    actor.blueprintInstance.limbPresenceOverrides = {
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
    };

    const markup = renderToStaticMarkup(
      createElement(Inspector, {
        scene: parsed,
        selectedId: actor.id,
        disabled: false,
        onSetLimbPresence: () => undefined,
      }),
    );
    const controls = limbSelects(markup);

    expect(controls).toHaveLength(12);
    expect(selectedMode(controls.get("upper_arm_r") ?? "")).toBe("present");
    expect(selectedMode(controls.get("forearm_r") ?? "")).toBe("present");
    expect(selectedMode(controls.get("hand_r") ?? "")).toBe("present");
    expect(selectedMode(controls.get("lower_leg_l") ?? "")).toBe("absent");
    expect(selectedMode(controls.get("foot_l") ?? "")).toBe("absent");
  });

  it("disables descendants when an ancestor is absent and explains why", () => {
    const scene = createDefaultScene();
    const actor = requireActor(scene);
    const updated = applyScenePatch(scene, {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_ui_absent_ancestor",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { upper_arm_r: "absent" },
        },
      ],
    }).next;
    const markup = renderActorInspector(updated);
    const controls = limbSelects(markup);

    expect(controls.get("upper_arm_r")).not.toContain("disabled");
    expect(controls.get("forearm_r")).toContain("disabled");
    expect(controls.get("forearm_r")).toContain("请先恢复右上臂");
    expect(controls.get("forearm_r")).toContain("aria-describedby");
    expect(controls.get("hand_r")).toContain("disabled");
    expect(controls.get("hand_r")).toContain("请先恢复右上臂");
    expect(markup).toContain(
      'class="limb-control-reason" id="actor_generic_1-forearm_r-limb-reason">请先恢复右上臂</span>',
    );
  });

  it.each(["workflow", "user"] as const)(
    "disables all twelve controls for a %s lock",
    (lockMode) => {
      const scene = createDefaultScene();
      requireActor(scene).lockMode = lockMode;
      const controls = limbSelects(renderActorInspector(scene));

      expect(controls).toHaveLength(12);
      for (const select of controls.values()) {
        expect(select).toContain("disabled");
      }
    },
  );

  it("disables all controls when editor editing or the callback is unavailable", () => {
    for (const markup of [
      renderActorInspector(createDefaultScene(), { disabled: true }),
      renderActorInspector(createDefaultScene(), { withCallback: false }),
    ]) {
      const controls = limbSelects(markup);
      expect(controls).toHaveLength(12);
      for (const select of controls.values()) {
        expect(select).toContain("disabled");
      }
    }
  });

  it("renders only the limb presence stored in each authoritative SceneSpec", () => {
    const allPresentScene = createDefaultScene();
    const actor = requireActor(allPresentScene);
    const acceptedScene = applyScenePatch(allPresentScene, {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_ui_authoritative_revision",
      sceneId: allPresentScene.sceneId,
      baseRevision: allPresentScene.revision,
      source: "manual",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { lower_leg_l: "absent" },
        },
      ],
    }).next;

    const before = limbSelects(renderActorInspector(allPresentScene));
    const after = limbSelects(renderActorInspector(acceptedScene));

    expect(selectedMode(before.get("lower_leg_l") ?? "")).toBe("present");
    expect(selectedMode(before.get("foot_l") ?? "")).toBe("present");
    expect(selectedMode(after.get("lower_leg_l") ?? "")).toBe("absent");
    expect(selectedMode(after.get("foot_l") ?? "")).toBe("absent");

    const controlsPath = fileURLToPath(
      new URL("../src/editor/ActorLimbControls.tsx", import.meta.url),
    );
    expect(existsSync(controlsPath)).toBe(true);
    if (existsSync(controlsPath)) {
      expect(readFileSync(controlsPath, "utf8")).not.toContain("useState");
    }
  });

  it("opens descendants only after accepted ancestor revisions", () => {
    const allPresent = createDefaultScene();
    const actor = requireActor(allPresent);
    const upperAbsent = applyScenePatch(
      allPresent,
      createActorLimbPresencePatch(allPresent, actor.id, {
        upper_arm_r: "absent",
      }),
    ).next;
    const middleRestored = applyScenePatch(
      upperAbsent,
      createActorLimbPresencePatch(upperAbsent, actor.id, {
        upper_arm_r: "present",
      }),
    ).next;
    const terminalRestored = applyScenePatch(
      middleRestored,
      createActorLimbPresencePatch(middleRestored, actor.id, {
        forearm_r: "present",
      }),
    ).next;

    expect(limbSelects(renderActorInspector(upperAbsent)).get("forearm_r"))
      .toContain("disabled");
    expect(
      limbSelects(renderActorInspector(middleRestored)).get("forearm_r"),
    ).not.toContain("disabled");
    expect(
      limbSelects(renderActorInspector(middleRestored)).get("hand_r"),
    ).toContain("disabled");
    expect(
      limbSelects(renderActorInspector(terminalRestored)).get("hand_r"),
    ).not.toContain("disabled");
  });

  it("dispatches real select changes for upper, middle, and terminal modes", () => {
    const actor = requireActor(createDefaultScene());
    const calls: Array<[string, string, string]> = [];
    const onSet = (actorId: string, partId: string, mode: string) => {
      calls.push([actorId, partId, mode]);
    };

    expect(
      dispatchActorLimbPresenceChange(actor, "upper_arm_l", "absent", onSet),
    ).toBe(true);
    dispatchActorLimbPresenceChange(actor, "forearm_l", "present", onSet);
    dispatchActorLimbPresenceChange(actor, "hand_l", "absent", onSet);
    dispatchActorLimbPresenceChange(actor, "hand_l", "present", onSet);

    expect(calls).toEqual([
      [actor.id, "upper_arm_l", "absent"],
      [actor.id, "forearm_l", "present"],
      [actor.id, "hand_l", "absent"],
      [actor.id, "hand_l", "present"],
    ]);
  });

  it("does not dispatch a select change without a callback", () => {
    const actor = requireActor(createDefaultScene());
    expect(
      dispatchActorLimbPresenceChange(actor, "upper_arm_l", "absent"),
    ).toBe(false);
  });

  it("uses the shared resolved projection for actor rendering", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/three/SceneWorld.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("resolveActorProjection");
    expect(
      source.match(/resolveActorProjection\(scene, actor\)/gu),
    ).toHaveLength(1);
    expect(source).not.toContain("DownwardLimb");
    expect(source).not.toContain("deriveActorAnatomyDimensions(actor.body)");
    expect(source).not.toContain("height * 0.19");
    expect(source).not.toContain("terminal={hand}");
    expect(source).not.toContain("terminal={foot}");
  });
});
