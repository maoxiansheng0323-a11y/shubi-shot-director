import { describe, expect, it } from "vitest";
import {
  ContactConstraintError,
  enforceGroundContacts,
  isSupportedContactSurface,
  snapTransformToContact,
  surfaceTopY,
} from "../src/domain/contact-constraints";
import { createDefaultScene } from "../src/domain/default-scene";
import { quaternionFromEulerDegrees } from "../src/domain/scene-math";
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
  it("snaps an actor to a room floor using the pose contact offset", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    const candidate: TransformSpec = {
      ...structuredClone(subject.transform),
      positionM: [1.25, 99, -0.75],
    };

    expect(surfaceTopY(scene, "environment_room_1")).toBeCloseTo(0, 6);
    const snapped = snapTransformToContact(scene, subject.id, candidate);

    expect(snapped.positionM).toEqual([1.25, 0.977, -0.75]);
    expect(candidate.positionM).toEqual([1.25, 99, -0.75]);
    expect(subject.transform.positionM[1]).toBeCloseTo(0.977, 6);
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

    expect(movedActor.transform.positionM[1]).toBeCloseTo(2.177, 6);
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

  it("reports a stable conflict when a locked actor would need to move", () => {
    const scene = withBoxSurface();
    actor(scene).locked = true;

    expectContactError(
      () => enforceGroundContacts(scene, new Set(["prop_surface_1"])),
      "LOCKED_ENTITY_CONFLICT",
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

  it("requires an actor pose contact offset", () => {
    const scene = createDefaultScene();
    const subject = actor(scene);
    subject.pose.preset.parameters = {};

    expectContactError(
      () =>
        snapTransformToContact(scene, subject.id, subject.transform),
      "CONTACT_OFFSET_INVALID",
    );
  });
});
