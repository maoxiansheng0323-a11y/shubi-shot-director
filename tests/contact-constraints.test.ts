import { describe, expect, it } from "vitest";
import { SceneSession } from "../server/scene-session";
import { applyScenePatch, SceneDomainError } from "../src/domain/apply-scene-patch";
import {
  deriveActorAnatomyDimensions,
  resolveActorLimbPresenceUpdates,
} from "../src/domain/actor-anatomy";
import { actorVisibleRigBounds } from "../src/domain/actor-visible-bounds";
import {
  ContactConstraintError,
  enforceGroundContacts,
  isSupportedContactSurface,
  snapTransformToContact,
  surfaceTopY,
} from "../src/domain/contact-constraints";
import { createDefaultScene } from "../src/domain/default-scene";
import {
  quaternionFromEulerDegrees,
  rotateVector,
  transformPoint,
} from "../src/domain/scene-math";
import { PATCH_SCHEMA_VERSION } from "../src/domain/schema-versions";
import {
  sceneSpecSchema,
  type SceneSpec,
  type TransformSpec,
} from "../src/domain/scene-schema";

const actor = (scene: SceneSpec) => {
  const found = scene.entities.find((entity) => entity.kind === "actor");
  expect(found?.kind).toBe("actor");
  if (!found || found.kind !== "actor") {
    throw new Error("Actor fixture is missing.");
  }
  return found;
};

const expectContactError = (
  callback: () => unknown,
  code: ContactConstraintError["code"],
): void => {
  try {
    callback();
    throw new Error("Expected a ContactConstraintError.");
  } catch (error) {
    expect(error).toBeInstanceOf(ContactConstraintError);
    expect((error as ContactConstraintError).code).toBe(code);
  }
};

const expectDomainError = (
  callback: () => unknown,
  code: string,
): void => {
  try {
    callback();
    throw new Error("Expected a SceneDomainError.");
  } catch (error) {
    expect(error).toBeInstanceOf(SceneDomainError);
    expect((error as SceneDomainError).code).toBe(code);
  }
};

const removeLimbParts = (
  subject: ReturnType<typeof actor>,
  updates: Parameters<typeof resolveActorLimbPresenceUpdates>[1],
): void => {
  subject.body.limbPresence = resolveActorLimbPresenceUpdates(
    subject.body.limbPresence,
    updates,
  );
};

const withBoxSurface = (): SceneSpec => {
  const scene = createDefaultScene();
  const prop = scene.entities.find((entity) => entity.kind === "prop");
  expect(prop?.kind).toBe("prop");
  if (!prop || prop.kind !== "prop") {
    throw new Error("Prop fixture is missing.");
  }
  prop.id = "prop_surface_1";
  prop.geometry.primitive = "box";
  prop.geometry.sizeM = [2, 0.2, 1.4];
  prop.transform.positionM = [0, 1, 0];
  prop.transform.scale = [1, 2, 1];
  prop.transform.rotation = quaternionFromEulerDegrees([0, 35, 0]);

  const contact = scene.constraints.find(
    (constraint) => constraint.type === "ground-contact",
  );
  expect(contact?.type).toBe("ground-contact");
  if (!contact || contact.type !== "ground-contact") {
    throw new Error("Ground-contact fixture is missing.");
  }
  contact.surfaceEntityId = prop.id;
  return sceneSpecSchema.parse(scene);
};

describe("contact constraints", () => {
  it("snaps an actor to a room floor using visible anatomy support", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    const candidate: TransformSpec = {
      ...structuredClone(subject.transform),
      positionM: [1.25, 99, -0.75],
    };

    expect(surfaceTopY(scene, "environment_room_1")).toBeCloseTo(0, 6);
    const snapped = snapTransformToContact(scene, subject.id, candidate);

    expect(snapped.positionM[0]).toBe(1.25);
    expect(Math.abs(snapped.positionM[1] - 0.977)).toBeLessThanOrEqual(0.001);
    expect(snapped.positionM[2]).toBe(-0.75);
    expect(candidate.positionM).toEqual([1.25, 99, -0.75]);
    expect(subject.transform.positionM[1]).toBeCloseTo(0.977, 6);
  });

  it("uses the remaining complete leg as visible support", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    removeLimbParts(subject, { lower_leg_l: "absent" });

    const snapped = snapTransformToContact(scene, subject.id, {
      ...structuredClone(subject.transform),
      positionM: [0, 9, 0],
    });
    const bounds = actorVisibleRigBounds(subject, snapped);

    expect(bounds.primitiveIds).toContain("foot_r");
    expect(bounds.primitiveIds).not.toContain("foot_l");
    expect(bounds.minWorld[1]).toBeCloseTo(0, 6);
    expect(Math.abs(snapped.positionM[1] - 0.977)).toBeLessThanOrEqual(0.001);
  });

  it("grounds visible upper-leg ends when both lower legs are absent", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    removeLimbParts(subject, {
      lower_leg_l: "absent",
      lower_leg_r: "absent",
    });

    const snapped = snapTransformToContact(scene, subject.id, subject.transform);
    const bounds = actorVisibleRigBounds(subject, snapped);
    const dimensions = deriveActorAnatomyDimensions(subject.body);
    const expectedSupportM =
      dimensions.upperLegLength - dimensions.hipOriginY;

    expect(bounds.primitiveIds).toEqual(
      expect.arrayContaining(["upper_leg_l", "upper_leg_r"]),
    );
    expect(bounds.primitiveIds).not.toEqual(
      expect.arrayContaining(["lower_leg_l", "lower_leg_r", "foot_l", "foot_r"]),
    );
    expect(bounds.minWorld[1]).toBeCloseTo(0, 6);
    expect(snapped.positionM[1]).toBeCloseTo(expectedSupportM, 9);
  });

  it("uses affine-safe sphere support under non-uniform scale and rotation", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    removeLimbParts(subject, {
      upper_arm_l: "absent",
      upper_arm_r: "absent",
      lower_leg_l: "absent",
      upper_leg_r: "absent",
    });
    const dimensions = deriveActorAnatomyDimensions(subject.body);
    const rotation = quaternionFromEulerDegrees([0, 0, -45]);
    const scale: TransformSpec["scale"] = [5, 1, 1];
    const cylinderLength = Math.max(
      0.01,
      dimensions.upperLegLength - dimensions.legRadius * 2,
    );
    const bottomY =
      -dimensions.upperLegLength / 2 - cylinderLength / 2;
    const bottomCenterLocal: TransformSpec["positionM"] = [
      dimensions.hipOffsetX,
      dimensions.hipOriginY + bottomY,
      0,
    ];
    const zeroPositionTransform: TransformSpec = {
      positionM: [0, 0, 0],
      rotation,
      scale,
    };
    const centerWorld = transformPoint(
      zeroPositionTransform,
      bottomCenterLocal,
    );
    const columnX = rotateVector([scale[0], 0, 0], rotation);
    const columnY = rotateVector([0, scale[1], 0], rotation);
    const columnZ = rotateVector([0, 0, scale[2]], rotation);
    const worldYRadius =
      dimensions.legRadius *
      Math.hypot(columnX[1], columnY[1], columnZ[1]);
    const expectedSupportM = -(centerWorld[1] - worldYRadius);
    const candidate: TransformSpec = {
      positionM: [0, 9, 0],
      rotation,
      scale,
    };

    const snapped = snapTransformToContact(scene, subject.id, candidate);

    expect(snapped.positionM[1]).toBeCloseTo(expectedSupportM, 9);
    expect(
      actorVisibleRigBounds(subject, snapped).minWorld[1],
    ).toBeCloseTo(0, 9);
  });

  it("uses the lowest remaining torso, pelvis, or arm geometry without leg chains", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    removeLimbParts(subject, {
      upper_leg_l: "absent",
      upper_leg_r: "absent",
    });

    const snapped = snapTransformToContact(scene, subject.id, subject.transform);
    const bounds = actorVisibleRigBounds(subject, snapped);

    expect(bounds.primitiveIds).toEqual(
      expect.arrayContaining(["pelvis", "torso", "upper_arm_l", "upper_arm_r"]),
    );
    expect(bounds.primitiveIds.some((id) => id.includes("leg") || id.includes("foot") || id.includes("knee") || id.includes("hip"))).toBe(false);
    expect(bounds.minWorld[1]).toBeCloseTo(0, 6);
  });

  it("re-solves enabled contact after an atomic limb patch in the same revision", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);

    const result = applyScenePatch(scene, {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_visible_support",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "natural-language",
      preserveLock: false,
      operations: [
        {
          op: "actor.limb-presence.set",
          actorId: subject.id,
          updates: {
            lower_leg_l: "absent",
            lower_leg_r: "absent",
          },
        },
      ],
    });
    const updated = actor(result.next);

    expect(result.next.revision).toBe(scene.revision + 1);
    expect(updated.transform.positionM[1]).toBeLessThan(0.977);
    expect(actorVisibleRigBounds(updated).minWorld[1]).toBeCloseTo(0, 6);
  });

  it("rolls back an indirect surface move when contact would move a user-locked actor", () => {
    const scene = withBoxSurface();
    const subject = actor(scene);
    const surface = scene.entities.find((entity) => entity.id === "prop_surface_1");
    if (!surface || surface.kind !== "prop") {
      throw new Error("Prop fixture is missing.");
    }
    subject.transform = snapTransformToContact(
      scene,
      subject.id,
      subject.transform,
    );
    subject.lockMode = "user";
    const session = new SceneSession(scene);
    const before = session.snapshot();
    const historyBefore = session.historyStatus();

    expectDomainError(
      () => session.applyPatch({
        schemaVersion: PATCH_SCHEMA_VERSION,
        patchId: "patch_locked_indirect_contact",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "natural-language",
        preserveLock: false,
        operations: [
          { op: "scene.title.set", value: "Must roll back" },
          {
            op: "entity.transform.translate",
            entityId: surface.id,
            deltaM: [0, 0.5, 0],
            referenceSpace: "world",
          },
        ],
      }),
      "USER_LOCKED",
    );
    expect(session.snapshot()).toEqual(before);
    expect(session.historyStatus()).toEqual(historyBefore);
  });

  it("computes horizontal box and plane top surfaces within one millimeter", () => {
    const scene = withBoxSurface();
    expect(surfaceTopY(scene, "prop_surface_1")).toBeCloseTo(1.2, 6);

    const prop = scene.entities.find(
      (entity) => entity.id === "prop_surface_1",
    );
    expect(prop?.kind).toBe("prop");
    if (!prop || prop.kind !== "prop") {
      return;
    }
    prop.geometry.primitive = "plane";
    prop.geometry.sizeM = [2, 0.012, 1.4];
    prop.transform.scale = [1, 1.5, 1];
    expect(surfaceTopY(scene, prop.id)).toBeCloseTo(1.009, 6);
  });

  it("keeps disabled contacts unchanged", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    const contact = scene.constraints[0];
    if (contact.type !== "ground-contact") {
      throw new Error("Ground-contact fixture is missing.");
    }
    contact.enabled = false;
    const candidate = structuredClone(subject.transform);
    candidate.positionM[1] = 4.5;

    expect(
      snapTransformToContact(scene, subject.id, candidate).positionM[1],
    ).toBe(4.5);
    expect(
      enforceGroundContacts(scene).entities.find(
        (entity) => entity.id === subject.id,
      )?.transform.positionM[1],
    ).toBeCloseTo(0.977, 6);
  });

  it("moves an actor with its affected surface without mutating the input", () => {
    const scene = withBoxSurface();
    const before = structuredClone(scene);
    const result = enforceGroundContacts(
      scene,
      new Set<string>(["prop_surface_1"]),
    );
    const movedActor = actor(result);

    expect(
      Math.abs(movedActor.transform.positionM[1] - 2.177),
    ).toBeLessThanOrEqual(0.001);
    expect(scene).toEqual(before);
    expect(result).not.toBe(scene);
  });

  it("does not touch unrelated contacts when an affected set is supplied", () => {
    const scene = withBoxSurface();
    const subject = actor(scene);
    subject.transform.positionM[1] = 7;

    const result = enforceGroundContacts(
      scene,
      new Set<string>(["camera_shot_1"]),
    );
    expect(actor(result).transform.positionM[1]).toBe(7);
  });

  it("reports a workflow-lock conflict under strict enforcement", () => {
    const scene = withBoxSurface();
    actor(scene).lockMode = "workflow";

    expectContactError(
      () => enforceGroundContacts(scene, new Set(["prop_surface_1"])),
      "WORKFLOW_LOCKED",
    );
  });

  it("preserves an accepted legacy placement during full normalization", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    const before = structuredClone(subject.transform);

    const result = enforceGroundContacts(scene);
    const preserved = actor(result);

    expect(preserved.transform).toEqual(before);
    expect(
      Math.abs(actorVisibleRigBounds(preserved).minWorld[1]),
    ).toBeLessThanOrEqual(0.001);
  });

  it("canonicalizes a sub-millimeter visible support delta for an affected actor", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);

    const result = enforceGroundContacts(scene, new Set([subject.id]));
    const corrected = actor(result);

    expect(corrected.transform.positionM[1]).not.toBe(
      subject.transform.positionM[1],
    );
    expect(actorVisibleRigBounds(corrected).minWorld[1]).toBeCloseTo(0, 9);
  });

  it("writes a sub-millimeter affected surface correction exactly", () => {
    const scene = withBoxSurface();
    const subject = actor(scene);
    const surface = scene.entities.find((entity) => entity.id === "prop_surface_1");
    if (!surface || surface.kind !== "prop") {
      throw new Error("Prop fixture is missing.");
    }
    subject.transform = snapTransformToContact(
      scene,
      subject.id,
      subject.transform,
    );
    const beforeY = subject.transform.positionM[1];

    const result = applyScenePatch(scene, {
      schemaVersion: PATCH_SCHEMA_VERSION,
      patchId: "patch_submillimeter_contact",
      sceneId: scene.sceneId,
      baseRevision: scene.revision,
      source: "system",
      preserveLock: false,
      operations: [
        {
          op: "entity.transform.translate",
          entityId: surface.id,
          deltaM: [0, 0.0006, 0],
          referenceSpace: "world",
        },
      ],
    });
    const corrected = actor(result.next);

    expect(corrected.transform.positionM[1] - beforeY).toBeCloseTo(0.0006, 9);
    expect(actorVisibleRigBounds(corrected).minWorld[1]).toBeCloseTo(
      surfaceTopY(result.next, surface.id),
      9,
    );
  });

  it("rolls back a sub-millimeter affected surface correction for a user lock", () => {
    const scene = withBoxSurface();
    const subject = actor(scene);
    const surface = scene.entities.find((entity) => entity.id === "prop_surface_1");
    if (!surface || surface.kind !== "prop") {
      throw new Error("Prop fixture is missing.");
    }
    subject.transform = snapTransformToContact(
      scene,
      subject.id,
      subject.transform,
    );
    subject.lockMode = "user";
    const session = new SceneSession(scene);
    const before = session.snapshot();
    const historyBefore = session.historyStatus();

    expectDomainError(
      () => session.applyPatch({
        schemaVersion: PATCH_SCHEMA_VERSION,
        patchId: "patch_locked_submillimeter_contact",
        sceneId: scene.sceneId,
        baseRevision: scene.revision,
        source: "natural-language",
        preserveLock: false,
        operations: [
          {
            op: "entity.transform.translate",
            entityId: surface.id,
            deltaM: [0, 0.0006, 0],
            referenceSpace: "world",
          },
        ],
      }),
      "USER_LOCKED",
    );
    expect(session.snapshot()).toEqual(before);
    expect(session.historyStatus()).toEqual(historyBefore);
  });

  it("preserves workflow locks during an allowed contact correction", () => {
    const scene = withBoxSurface();
    actor(scene).lockMode = "workflow";

    const result = enforceGroundContacts(
      scene,
      new Set(["prop_surface_1"]),
      { preserveLock: true },
    );

    const corrected = actor(result);
    expect(corrected).toMatchObject({
      lockMode: "workflow",
    });
    expect(Math.abs(corrected.transform.positionM[1] - 2.177)).toBeLessThanOrEqual(
      0.001,
    );
  });

  it("always rejects a user-locked contact correction", () => {
    const scene = withBoxSurface();
    actor(scene).lockMode = "user";

    expectContactError(
      () =>
        enforceGroundContacts(
          scene,
          new Set(["prop_surface_1"]),
          { preserveLock: true },
        ),
      "USER_LOCKED",
    );
  });

  it("rejects tilted and unsupported surfaces with stable codes", () => {
    const tilted = withBoxSurface();
    const tiltedProp = tilted.entities.find(
      (entity) => entity.id === "prop_surface_1",
    );
    if (!tiltedProp || tiltedProp.kind !== "prop") {
      throw new Error("Prop fixture is missing.");
    }
    tiltedProp.transform.rotation = quaternionFromEulerDegrees([8, 0, 0]);
    expectContactError(
      () => surfaceTopY(tilted, tiltedProp.id),
      "SURFACE_NOT_HORIZONTAL",
    );

    const unsupported = withBoxSurface();
    const unsupportedProp = unsupported.entities.find(
      (entity) => entity.id === "prop_surface_1",
    );
    if (!unsupportedProp || unsupportedProp.kind !== "prop") {
      throw new Error("Prop fixture is missing.");
    }
    unsupportedProp.geometry.primitive = "cylinder";
    expectContactError(
      () => surfaceTopY(unsupported, unsupportedProp.id),
      "UNSUPPORTED_SURFACE",
    );
    expect(isSupportedContactSurface(unsupported, unsupportedProp.id)).toBe(
      false,
    );
    expect(isSupportedContactSurface(unsupported, "missing_surface")).toBe(
      false,
    );
  });

  it("exposes only surfaces accepted by the contact solver", () => {
    const scene = withBoxSurface();
    expect(isSupportedContactSurface(scene, "prop_surface_1")).toBe(true);
    expect(
      isSupportedContactSurface(scene, "environment_room_1"),
    ).toBe(true);

    const prop = scene.entities.find(
      (entity) => entity.id === "prop_surface_1",
    );
    if (!prop || prop.kind !== "prop") {
      throw new Error("Prop fixture is missing.");
    }
    prop.geometry.primitive = "capsule";
    expect(isSupportedContactSurface(scene, prop.id)).toBe(false);

    prop.geometry.primitive = "plane";
    prop.transform.rotation = quaternionFromEulerDegrees([0, 0, 12]);
    expect(isSupportedContactSurface(scene, prop.id)).toBe(false);
  });

  it("ignores legacy contact offset metadata as geometry authority", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    subject.pose.preset.parameters = {};

    expect(
      Math.abs(
        snapTransformToContact(scene, subject.id, subject.transform)
          .positionM[1] - 0.977,
      ),
    ).toBeLessThanOrEqual(0.001);
  });
});
