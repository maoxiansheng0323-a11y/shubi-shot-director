import { describe, expect, it } from "vitest";
import { createActorBlueprintSnapshot } from "../src/domain/actor-blueprint";
import { CUSTOM_POSE_PRESET_ID } from "../src/domain/actor-joints";
import { applyScenePatch, SceneDomainError } from "../src/domain/apply-scene-patch";
import { snapTransformToContact } from "../src/domain/contact-constraints";
import { createDefaultScene } from "../src/domain/default-scene";
import { resolveActorLimbPresenceUpdates } from "../src/domain/actor-anatomy";
import {
  parseScenePatchInput,
  parseScenePatchInputWithProvenance,
  type ParsedScenePatchInput,
} from "../src/domain/scene-migrations";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  isBlueprintActorEntity,
  isLegacyActorEntity,
  sceneSpecSchema,
  type BlueprintActorEntity,
  type LegacyActorEntity,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  createBlueprintActor,
  createGenericActorBlueprintDocument,
  createLegacyV5BlueprintGroundContactPatch,
} from "./helpers/actor-blueprint-fixtures";

const legacyActor = (scene: SceneSpec): LegacyActorEntity => {
  const actor = scene.entities.find(isLegacyActorEntity);
  if (!actor) throw new Error("Legacy actor fixture is missing.");
  return actor;
};

const createBlueprintScene = (
  baseHeightM = 1.62,
): {
  scene: SceneSpec;
  actor: BlueprintActorEntity;
} => {
  const scene: SceneSpec = structuredClone(createDefaultScene());
  const document = createGenericActorBlueprintDocument();
  document.body.heightM = baseHeightM;
  const snapshot = createActorBlueprintSnapshot(
    document,
  );
  const actor = createBlueprintActor();
  scene.actorBlueprints = [snapshot];
  scene.entities = [
    ...scene.entities.filter((entity) => entity.kind !== "actor"),
    actor,
  ];
  scene.constraints = [];
  const parsed = sceneSpecSchema.parse(scene);
  const parsedActor = parsed.entities.find(isBlueprintActorEntity);
  if (!parsedActor) throw new Error("Blueprint actor fixture is missing.");
  return { scene: parsed, actor: parsedActor };
};

const patchBase = (scene: SceneSpec, patchId: string) => ({
  schemaVersion: PATCH_SCHEMA_VERSION,
  patchId,
  sceneId: scene.sceneId,
  baseRevision: scene.revision,
  source: "manual" as const,
  preserveLock: false,
});

describe("authoritative actor puppet Patch operations", () => {
  it("changes legacy stature while preserving body proportions", () => {
    const scene = createDefaultScene();
    const actor = legacyActor(scene);
    const beforeShoulderWidth = actor.body.shoulderWidthM;
    const beforeTransformScale = [...actor.transform.scale];
    const beforePosition = [...actor.transform.positionM];
    const beforeContactOffsetM = actor.pose.preset.parameters.contactOffsetM;

    const next = applyScenePatch(scene, {
      ...patchBase(scene, "patch_legacy_height_1"),
      operations: [
        {
          op: "actor.height.set",
          actorId: actor.id,
          heightM: 1.55,
        },
      ],
    }).next;
    const nextActor = legacyActor(next);

    expect(nextActor.body.heightM).toBe(1.55);
    expect(nextActor.body.shoulderWidthM).toBeCloseTo(
      beforeShoulderWidth * (1.55 / 1.72),
      8,
    );
    expect(nextActor.transform.scale).toEqual(beforeTransformScale);
    expect(nextActor.transform.positionM[0]).toBe(beforePosition[0]);
    expect(nextActor.transform.positionM[1]).not.toBe(beforePosition[1]);
    expect(nextActor.transform.positionM[2]).toBe(beforePosition[2]);
    expect(nextActor.pose.preset.parameters.contactOffsetM).toBeCloseTo(
      (beforeContactOffsetM as number) * (1.55 / 1.72),
      8,
    );
    expect(next.revision).toBe(scene.revision + 1);
    expect(actor.body.heightM).toBe(1.72);
  });

  it.each([
    {
      caseId: "upper",
      shoulderWidthM: 0.8,
      heightM: 2.4,
      expected: 0.8,
    },
    {
      caseId: "lower",
      shoulderWidthM: 0.25,
      heightM: 1,
      expected: 0.25,
    },
  ])(
    "clamps proportional legacy shoulder width to $expected meters",
    ({ caseId, shoulderWidthM, heightM, expected }) => {
      const scene = createDefaultScene();
      const actor = legacyActor(scene);
      actor.body.shoulderWidthM = shoulderWidthM;
      const proportionalWidthM =
        shoulderWidthM * (heightM / actor.body.heightM);

      if (caseId === "upper") {
        expect(proportionalWidthM).toBeGreaterThan(0.8);
      } else {
        expect(proportionalWidthM).toBeLessThan(0.25);
      }

      const next = applyScenePatch(scene, {
        ...patchBase(scene, `patch_legacy_height_clamp_${caseId}`),
        operations: [
          {
            op: "actor.height.set",
            actorId: actor.id,
            heightM,
          },
        ],
      }).next;

      expect(legacyActor(next).body.shoulderWidthM).toBe(expected);
    },
  );

  it("changes Blueprint stature through instance scale without mutating the snapshot", () => {
    const { scene, actor } = createBlueprintScene();
    const snapshotBefore = structuredClone(scene.actorBlueprints[0]);
    const transformScaleBefore = [...actor.transform.scale];

    const next = applyScenePatch(scene, {
      ...patchBase(scene, "patch_blueprint_height_1"),
      operations: [
        {
          op: "actor.height.set",
          actorId: actor.id,
          heightM: 1.8,
        },
      ],
    }).next;
    const nextActor = next.entities.find(isBlueprintActorEntity);

    expect(nextActor?.blueprintInstance.heightScale).toBeCloseTo(
      1.8 / snapshotBefore.body.heightM,
      8,
    );
    expect(nextActor?.transform.scale).toEqual(transformScaleBefore);
    expect(next.actorBlueprints[0]).toEqual(snapshotBefore);
  });

  it.each([
    { caseId: "max", baseHeightM: 1.1858312671412776, heightM: 2.4 },
    { caseId: "min", baseHeightM: 1.85, heightM: 1 },
  ])(
    "accepts the exact $heightM meter Blueprint stature boundary despite scale rounding",
    ({ caseId, baseHeightM, heightM }) => {
      const { scene, actor } = createBlueprintScene(baseHeightM);

      const next = applyScenePatch(scene, {
        ...patchBase(scene, `patch_blueprint_height_boundary_${caseId}`),
        operations: [
          {
            op: "actor.height.set",
            actorId: actor.id,
            heightM,
          },
        ],
      }).next;

      const nextActor = next.entities.find(isBlueprintActorEntity);
      expect(nextActor).toBeDefined();
      expect(
        next.actorBlueprints[0].body.heightM *
          (nextActor?.blueprintInstance.heightScale ?? 0),
      ).toBeCloseTo(heightM, 12);
    },
  );

  it("stores minimal Blueprint limb overrides above the selected variant", () => {
    const { scene, actor } = createBlueprintScene();
    const snapshotBefore = structuredClone(scene.actorBlueprints[0]);

    const restored = applyScenePatch(scene, {
      ...patchBase(scene, "patch_blueprint_restore_hand_1"),
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { hand_r: "present" },
        },
      ],
    }).next;
    const restoredActor = restored.entities.find(isBlueprintActorEntity);
    expect(restoredActor?.blueprintInstance.limbPresenceOverrides).toEqual({
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
    });

    const hidden = applyScenePatch(restored, {
      ...patchBase(restored, "patch_blueprint_hide_left_arm_1"),
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { upper_arm_l: "absent" },
        },
      ],
    }).next;
    const hiddenActor = hidden.entities.find(isBlueprintActorEntity);
    expect(hiddenActor?.blueprintInstance.limbPresenceOverrides).toEqual({
      upper_arm_l: "absent",
      forearm_l: "absent",
      hand_l: "absent",
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
    });
    expect(hidden.actorBlueprints[0]).toEqual(snapshotBefore);
  });

  it("retains manual Blueprint limb overrides when selecting another variant", () => {
    const { scene, actor } = createBlueprintScene();
    const withOverride = applyScenePatch(scene, {
      ...patchBase(scene, "patch_blueprint_override_before_variant_1"),
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: actor.id,
          updates: { hand_r: "present" },
        },
      ],
    }).next;
    const switched = applyScenePatch(withOverride, {
      ...patchBase(withOverride, "patch_blueprint_variant_after_override_1"),
      operations: [
        {
          op: "actor.variant.set",
          actorId: actor.id,
          variantId: "repaired",
        },
      ],
    }).next;
    const switchedActor = switched.entities.find(isBlueprintActorEntity);

    expect(switchedActor?.blueprintInstance.variantId).toBe("repaired");
    expect(switchedActor?.blueprintInstance.limbPresenceOverrides).toEqual({
      upper_arm_r: "present",
      forearm_r: "present",
      hand_r: "present",
    });
  });

  it.each(["workflow", "user"] as const)(
    "rejects stature edits for a %s lock",
    (lockMode) => {
      const scene = createDefaultScene();
      const actor = legacyActor(scene);
      actor.lockMode = lockMode;

      expect(() =>
        applyScenePatch(scene, {
          ...patchBase(scene, `patch_height_${lockMode}_lock_1`),
          operations: [
            {
              op: "actor.height.set",
              actorId: actor.id,
              heightM: 1.6,
            },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: lockMode === "workflow" ? "WORKFLOW_LOCKED" : "USER_LOCKED",
        }),
      );
    },
  );

  it.each(["workflow", "user"] as const)(
    "rebases contact-owned Y for a Blueprint actor added by a v5 Patch with a %s lock",
    (lockMode) => {
      const scene = createDefaultScene();
      const before = structuredClone(scene);
      const snapshot = createActorBlueprintSnapshot(
        createGenericActorBlueprintDocument(),
      );
      const actor = createBlueprintActor();
      actor.lockMode = lockMode;
      actor.transform.positionM = [0.65, 0.4536, -0.35];
      actor.transform.rotation = quaternionFromEulerDegrees([0, 24, 0]);
      actor.pose.preset.parameters.contactOffsetM = 0.4536;
      const legacyTransform = structuredClone(actor.transform);
      const legacyPreset = structuredClone(actor.pose.preset);
      const legacyActor = structuredClone(actor) as unknown as Record<
        string,
        unknown
      >;
      const legacyInstance = legacyActor.blueprintInstance as Record<
        string,
        unknown
      >;
      delete legacyInstance.heightScale;
      delete legacyInstance.limbPresenceOverrides;
      const constraint = {
        id: `constraint_ground_v5_locked_${lockMode}`,
        type: "ground-contact" as const,
        entityId: actor.id,
        surfaceEntityId: "environment_room_1",
        enabled: true,
      };

      const applied = (() => {
        try {
          return applyScenePatch(scene, {
            schemaVersion: 5,
            patchId: `patch_v5_locked_contact_${lockMode}`,
            sceneId: scene.sceneId,
            baseRevision: scene.revision,
            source: "manual",
            preserveLock: false,
            operations: [
              { op: "actor.blueprint.register", snapshot },
              { op: "entity.add", value: legacyActor },
              { op: "constraint.set", value: constraint },
            ],
          });
        } catch (error) {
          if (error instanceof SceneDomainError) {
            throw new Error(
              `Expected the v5 Patch to succeed, received ${error.code}.`,
              { cause: error },
            );
          }
          throw error;
        }
      })();
      const nextActor = applied.next.entities.find(
        (entity) => entity.id === actor.id,
      );
      if (!isBlueprintActorEntity(nextActor)) {
        throw new Error("Migrated Blueprint actor is missing.");
      }
      const snapped = snapTransformToContact(
        applied.next,
        nextActor.id,
        nextActor.transform,
      );

      expect(applied.next.revision).toBe(scene.revision + 1);
      expect(nextActor.lockMode).toBe(lockMode);
      expect(nextActor.transform.positionM[1]).not.toBeCloseTo(
        legacyTransform.positionM[1],
        4,
      );
      expect(nextActor.transform.positionM[0]).toBe(
        legacyTransform.positionM[0],
      );
      expect(nextActor.transform.positionM[2]).toBe(
        legacyTransform.positionM[2],
      );
      expect(nextActor.transform.rotation).toEqual(legacyTransform.rotation);
      expect(nextActor.transform.scale).toEqual(legacyTransform.scale);
      expect(nextActor.pose.preset).toEqual(legacyPreset);
      expect(nextActor.transform).toEqual(snapped);
      expect(scene).toEqual(before);

      const v6Scene = createDefaultScene();
      const v6Before = structuredClone(v6Scene);
      expect(() =>
        applyScenePatch(v6Scene, {
          schemaVersion: PATCH_SCHEMA_VERSION,
          patchId: `patch_v6_locked_contact_${lockMode}`,
          sceneId: v6Scene.sceneId,
          baseRevision: v6Scene.revision,
          source: "manual",
          preserveLock: false,
          operations: [
            { op: "actor.blueprint.register", snapshot },
            { op: "entity.add", value: actor },
            { op: "constraint.set", value: constraint },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: lockMode === "workflow" ? "WORKFLOW_LOCKED" : "USER_LOCKED",
        }),
      );
      expect(v6Scene).toEqual(v6Before);
    },
  );

  it.each(["workflow", "user"] as const)(
    "uses controlled v5 provenance when applying a canonical Patch with a %s lock",
    (lockMode) => {
      const scene = createDefaultScene();
      const fixture = createLegacyV5BlueprintGroundContactPatch(
        scene,
        lockMode,
      );
      const parsedPatch = parseScenePatchInputWithProvenance(fixture.patch);

      const applied = applyScenePatch(scene, parsedPatch.patch, {
        provenance: parsedPatch,
      });
      const actor = applied.next.entities.find(
        (entity) => entity.id === fixture.actorId,
      );

      expect(isBlueprintActorEntity(actor)).toBe(true);
      if (!isBlueprintActorEntity(actor)) {
        throw new Error("Migrated Blueprint actor is missing.");
      }
      expect(actor.lockMode).toBe(lockMode);
      expect(actor.transform.positionM[1]).not.toBeCloseTo(
        fixture.legacyTransform.positionM[1],
        4,
      );
      expect(actor.transform).toEqual(
        snapTransformToContact(applied.next, actor.id, actor.transform),
      );
      expect(JSON.stringify(applied.next)).not.toContain(
        "sourceSchemaVersion",
      );
    },
  );

  it("rejects provenance bound to another canonical Blueprint Patch", () => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);
    const trustedV5 = parseScenePatchInputWithProvenance(
      createLegacyV5BlueprintGroundContactPatch(scene, "user").patch,
    );
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const actor = createBlueprintActor({
      id: "actor_entity_blueprint_v6_spoofed_v5",
    });
    actor.lockMode = "user";
    actor.blueprintInstance.heightScale = 1.1;
    actor.transform.positionM = [0.65, 0.4536, -0.35];
    actor.pose.preset.parameters.contactOffsetM = 0.4536;
    const patch = {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_v6_spoofed_v5_provenance",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "manual" as const,
      preserveLock: false,
      operations: [
        { op: "actor.blueprint.register" as const, snapshot },
        { op: "entity.add" as const, value: actor },
        {
          op: "constraint.set" as const,
          value: {
            id: "constraint_ground_v6_spoofed_v5",
            type: "ground-contact" as const,
            entityId: actor.id,
            surfaceEntityId: "environment_room_1",
            enabled: true,
          },
        },
      ],
    };

    expect(() => applyScenePatch(scene, patch)).toThrowError(
      expect.objectContaining({ code: "USER_LOCKED" }),
    );
    expect(scene).toEqual(before);

    expect(() =>
      applyScenePatch(scene, patch, {
        provenance: trustedV5,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PATCH_SOURCE_SCHEMA_MISMATCH" }),
    );
    expect(scene).toEqual(before);
  });

  it("rejects a bare v5 source option for a reversible native v6 Blueprint Patch", () => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);
    const fixture = createLegacyV5BlueprintGroundContactPatch(scene, "user");
    const canonicalV6Patch = parseScenePatchInput(fixture.patch);
    expect(canonicalV6Patch.schemaVersion).toBe(PATCH_SCHEMA_VERSION);

    expect(() => applyScenePatch(scene, canonicalV6Patch)).toThrowError(
      expect.objectContaining({ code: "USER_LOCKED" }),
    );
    expect(scene).toEqual(before);

    const spoofedOptions = {
      sourceSchemaVersion: 5,
    } as Parameters<typeof applyScenePatch>[2];
    expect(() =>
      applyScenePatch(scene, canonicalV6Patch, spoofedOptions),
    ).toThrowError(
      expect.objectContaining({ code: "PATCH_SOURCE_SCHEMA_INVALID" }),
    );
    expect(scene).toEqual(before);
  });

  it.each([
    [
      "structured clone",
      (trusted: ParsedScenePatchInput) => structuredClone(trusted),
    ],
    [
      "manual copy",
      (trusted: ParsedScenePatchInput) => ({
        patch: trusted.patch,
        sourceSchemaVersion: trusted.sourceSchemaVersion,
      }),
    ],
  ])("rejects a %s of an official provenance carrier", (_label, clone) => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);
    const trusted = parseScenePatchInputWithProvenance(
      createLegacyV5BlueprintGroundContactPatch(scene, "workflow").patch,
    );
    const untrusted = clone(trusted) as ParsedScenePatchInput;

    expect(() =>
      applyScenePatch(scene, trusted.patch, {
        provenance: untrusted,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PATCH_SOURCE_SCHEMA_INVALID" }),
    );
    expect(scene).toEqual(before);
  });

  it("prevents official Patch provenance from being rewritten", () => {
    const scene = createDefaultScene();
    const trusted = parseScenePatchInputWithProvenance(
      createLegacyV5BlueprintGroundContactPatch(scene, "workflow").patch,
    );

    expect(Reflect.set(trusted, "sourceSchemaVersion", PATCH_SCHEMA_VERSION))
      .toBe(false);
    expect(trusted.sourceSchemaVersion).toBe(5);
  });

  it("derives canonical Patch and provenance from one schemaVersion read", () => {
    const scene = createDefaultScene();
    const fixture = createLegacyV5BlueprintGroundContactPatch(scene, "user");
    const rawPatch = parseScenePatchInput(fixture.patch);
    let schemaVersionReads = 0;
    Object.defineProperty(rawPatch, "schemaVersion", {
      configurable: true,
      enumerable: true,
      get: () => {
        schemaVersionReads += 1;
        return schemaVersionReads === 1 ? PATCH_SCHEMA_VERSION : 5;
      },
    });

    const parsed = parseScenePatchInputWithProvenance(rawPatch);

    expect(schemaVersionReads).toBe(1);
    expect(parsed.patch.schemaVersion).toBe(PATCH_SCHEMA_VERSION);
    expect(parsed.sourceSchemaVersion).toBe(PATCH_SCHEMA_VERSION);
  });

  it("stabilizes raw apply before structure and provenance parsing", () => {
    const scene = createDefaultScene();
    const before = structuredClone(scene);
    const fixture = createLegacyV5BlueprintGroundContactPatch(scene, "user");
    const rawPatch = parseScenePatchInput(fixture.patch);
    let schemaVersionReads = 0;
    Object.defineProperty(rawPatch, "schemaVersion", {
      configurable: true,
      enumerable: true,
      get: () => {
        schemaVersionReads += 1;
        return schemaVersionReads === 1 ? PATCH_SCHEMA_VERSION : 5;
      },
    });

    expect(() => applyScenePatch(scene, rawPatch)).toThrowError(
      expect.objectContaining({ code: "USER_LOCKED" }),
    );
    expect(schemaVersionReads).toBe(1);
    expect(scene).toEqual(before);
  });

  it.each([
    [
      "Proxy input",
      (patch: ReturnType<typeof parseScenePatchInput>) => new Proxy(patch, {}),
    ],
    [
      "throwing getter",
      (patch: ReturnType<typeof parseScenePatchInput>) => {
        Object.defineProperty(patch, "schemaVersion", {
          configurable: true,
          enumerable: true,
          get: () => {
            throw new Error("marker_private_schema_getter");
          },
        });
        return patch;
      },
    ],
  ])("safely rejects %s before provenance parsing", (_label, createInput) => {
    const scene = createDefaultScene();
    const fixture = createLegacyV5BlueprintGroundContactPatch(scene, "user");
    const input = createInput(parseScenePatchInput(fixture.patch));

    expect(() => parseScenePatchInputWithProvenance(input)).toThrowError(
      "ScenePatch input could not be stabilized.",
    );
  });

  it("rejects non-actor targets without committing an earlier operation", () => {
    const scene = createDefaultScene();
    const actor = legacyActor(scene);
    const prop = scene.entities.find((entity) => entity.kind === "prop");
    if (!prop) throw new Error("Prop fixture is missing.");
    const before = structuredClone(scene);

    try {
      applyScenePatch(scene, {
        ...patchBase(scene, "patch_height_atomic_failure_1"),
        operations: [
          {
            op: "actor.height.set",
            actorId: actor.id,
            heightM: 1.6,
          },
          {
            op: "actor.height.set",
            actorId: prop.id,
            heightM: 1.5,
          },
        ],
      });
      throw new Error("Expected actor height target validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SceneDomainError);
      expect(error).toMatchObject({ code: "ACTOR_HEIGHT_TARGET_INVALID" });
    }

    expect(scene).toEqual(before);
  });

  it("uses the shared hierarchy resolver for Blueprint desired states", () => {
    const current = {
      upper_arm_l: "absent",
      forearm_l: "absent",
      hand_l: "absent",
      upper_arm_r: "absent",
      forearm_r: "absent",
      hand_r: "absent",
      upper_leg_l: "absent",
      lower_leg_l: "absent",
      foot_l: "absent",
      upper_leg_r: "absent",
      lower_leg_r: "absent",
      foot_r: "absent",
    } as const;
    expect(resolveActorLimbPresenceUpdates(current, { hand_r: "present" }))
      .toMatchObject({
        upper_arm_r: "present",
        forearm_r: "present",
        hand_r: "present",
      });
  });

  it("merges one legacy joint update, marks a custom pose, and re-enforces contact", () => {
    const scene = createDefaultScene();
    const actor = legacyActor(scene);
    const preservedSpine = quaternionFromEulerDegrees([8, -3, 5]);
    const pelvisUpdate = quaternionFromEulerDegrees([0, 0, 24]);
    actor.pose.joints.spine = preservedSpine;
    const beforePositionY = actor.transform.positionM[1];

    const next = applyScenePatch(scene, {
      ...patchBase(scene, "patch_legacy_joint_1"),
      operations: [
        {
          op: "actor.pose.joints.set",
          actorId: actor.id,
          updates: { pelvis: pelvisUpdate },
        },
      ],
    }).next;
    const nextActor = legacyActor(next);

    expect(nextActor.pose.preset.id).toBe(CUSTOM_POSE_PRESET_ID);
    expect(nextActor.pose.joints.spine).toEqual(preservedSpine);
    expect(nextActor.pose.joints.pelvis).toEqual(pelvisUpdate);
    expect(nextActor.transform.positionM[1]).not.toBe(beforePositionY);
    expect(actor.pose.preset.id).not.toBe(CUSTOM_POSE_PRESET_ID);
  });

  it("applies a partial joint update to a Blueprint actor without changing its snapshot", () => {
    const { scene, actor } = createBlueprintScene();
    const snapshotBefore = structuredClone(scene.actorBlueprints[0]);
    const neckUpdate = quaternionFromEulerDegrees([12, 18, -7]);

    const next = applyScenePatch(scene, {
      ...patchBase(scene, "patch_blueprint_joint_1"),
      operations: [
        {
          op: "actor.pose.joints.set",
          actorId: actor.id,
          updates: { neck: neckUpdate },
        },
      ],
    }).next;
    const nextActor = next.entities.find(isBlueprintActorEntity);

    expect(nextActor?.pose.preset.id).toBe(CUSTOM_POSE_PRESET_ID);
    expect(nextActor?.pose.joints.neck).toEqual(neckUpdate);
    expect(next.actorBlueprints[0]).toEqual(snapshotBefore);
  });
});
