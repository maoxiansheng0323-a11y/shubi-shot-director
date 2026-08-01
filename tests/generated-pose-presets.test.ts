import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyScenePatch } from "../src/domain/apply-scene-patch";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  canonicalHumanoidJointIds,
  listPosePresets,
} from "../src/domain/presets/pose-presets";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { isLegacyActorEntity } from "../src/domain/scene-schema";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";

const generatedPosePresetPath = path.resolve(
  ".agents/skills/shubi-shot-director/references/generated/pose-presets.json",
);

interface GeneratedPosePresetReference {
  schemaVersion: number;
  jointIds: string[];
  contactOffsetDecimalPlaces: number;
  presets: Array<{
    id: string;
    version: number;
    label: string;
    contactOffsetHeightRatio: number;
    joints: Record<string, readonly number[]>;
  }>;
}

const readGeneratedPosePresetReference = async (): Promise<
  GeneratedPosePresetReference | null
> => {
  const source = await readFile(generatedPosePresetPath, "utf8").catch(
    () => null,
  );
  return source === null
    ? null
    : (JSON.parse(source) as GeneratedPosePresetReference);
};

describe("generated pose preset reference", () => {
  it("stays in exact sync with the complete normalized runtime registry", async () => {
    const generated = await readGeneratedPosePresetReference();

    expect(generated).not.toBeNull();
    if (generated === null) return;
    const expectedPresets = listPosePresets().map((preset) => ({
      id: preset.id,
      version: preset.version,
      label: preset.label,
      contactOffsetHeightRatio: preset.contactOffsetHeightRatio,
      joints: Object.fromEntries(
        canonicalHumanoidJointIds.map((jointId) => [
          jointId,
          [...preset.joints[jointId]],
        ]),
      ),
    }));

    expect(generated).toEqual({
      schemaVersion: 1,
      jointIds: [...canonicalHumanoidJointIds],
      contactOffsetDecimalPlaces: 5,
      presets: expectedPresets,
    });
    for (const preset of generated.presets) {
      expect(Object.keys(preset.joints)).toEqual([
        ...canonicalHumanoidJointIds,
      ]);
      for (const quaternion of Object.values(preset.joints)) {
        expect(Math.hypot(...quaternion)).toBeCloseTo(1, 12);
      }
    }
  });

  it("builds and applies a schema-valid complete-action Patch from every recipe", async () => {
    const generated = await readGeneratedPosePresetReference();

    expect(generated).not.toBeNull();
    if (generated === null) return;

    for (const [index, recipe] of generated.presets.entries()) {
      const scene = createDefaultScene();
      const actor = scene.entities.find(isLegacyActorEntity);
      if (!actor) throw new Error("Legacy actor fixture is missing.");
      const scale = 10 ** generated.contactOffsetDecimalPlaces;
      const contactOffsetM =
        Math.round(
          actor.body.heightM *
            recipe.contactOffsetHeightRatio *
            scale,
        ) / scale;
      const patch = scenePatchSchema.parse({
        schemaVersion: PATCH_SCHEMA_VERSION,
        patchId: `patch_generated_pose_${index + 1}`,
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "manual",
        preserveLock: false,
        operations: [
          {
            op: "actor.pose.set",
            entityId: actor.id,
            value: {
              preset: {
                registry: "builtin",
                id: recipe.id,
                version: recipe.version,
                parameters: { contactOffsetM },
              },
              joints: recipe.joints,
            },
          },
        ],
      });
      const operation = patch.operations[0];

      expect(operation).toEqual({
        op: "actor.pose.set",
        entityId: actor.id,
        value: {
          preset: {
            registry: "builtin",
            id: recipe.id,
            version: recipe.version,
            parameters: { contactOffsetM },
          },
          joints: recipe.joints,
        },
      });
      if (operation?.op !== "actor.pose.set") {
        throw new Error("Expected a complete-action operation.");
      }
      expect(operation.value.preset.parameters).not.toHaveProperty(
        "contactOffsetHeightRatio",
      );

      const next = applyScenePatch(scene, patch).next;
      const nextActor = next.entities.find(isLegacyActorEntity);
      expect(nextActor?.pose.preset.id).toBe(recipe.id);
      expect(
        nextActor?.pose.preset.parameters.contactOffsetM,
      ).toBe(contactOffsetM);
      expect(nextActor?.pose.joints).toEqual(recipe.joints);
    }
  });
});
