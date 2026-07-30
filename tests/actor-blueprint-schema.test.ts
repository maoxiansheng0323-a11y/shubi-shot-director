import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actorBlueprintDocumentSchema,
  actorBlueprintSnapshotSchema,
  createActorBlueprintSnapshot,
  resolveActorBlueprintVariant,
} from "../src/domain/actor-blueprint";
import {
  canonicalJson,
  canonicalJsonSha256,
} from "../src/domain/canonical-json-sha256";
import { createGenericActorBlueprintDocument } from "./helpers/actor-blueprint-fixtures";

describe("canonical Actor Blueprint hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const value = { z: [3, 2, 1], a: { y: 2, x: 1 }, n: -0 };
    const canonical = '{"a":{"x":1,"y":2},"n":0,"z":[3,2,1]}';

    expect(canonicalJson(value)).toBe(canonical);
    expect(canonicalJsonSha256(value)).toBe(
      createHash("sha256").update(canonical, "utf8").digest("hex"),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite number %s",
    (value) => {
      expect(() => canonicalJson({ value })).toThrow(
        "Canonical JSON requires finite numbers.",
      );
    },
  );
});

describe("Actor Blueprint document v1", () => {
  it("accepts the bounded generic document and creates a verified snapshot", () => {
    const document = actorBlueprintDocumentSchema.parse(
      createGenericActorBlueprintDocument(),
    );
    const snapshot = createActorBlueprintSnapshot(document);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(actorBlueprintSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("requires both delta objects while allowing each to be empty", () => {
    const document = createGenericActorBlueprintDocument();
    document.variants = [
      {
        variantId: "neutral",
        limbPresence: {},
        moduleVisibility: {},
      },
    ];

    expect(actorBlueprintDocumentSchema.parse(document).variants[0]).toEqual(
      document.variants[0],
    );

    const missingVisibility = structuredClone(document) as unknown as {
      variants: Array<Record<string, unknown>>;
    };
    delete missingVisibility.variants[0].moduleVisibility;
    expect(() => actorBlueprintDocumentSchema.parse(missingVisibility)).toThrow();
  });

  it("closes descendants and inherits module visibility from the base", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    const damaged = resolveActorBlueprintVariant(snapshot, "damaged");

    expect(damaged.limbPresence.upper_arm_r).toBe("absent");
    expect(damaged.limbPresence.forearm_r).toBe("absent");
    expect(damaged.limbPresence.hand_r).toBe("absent");
    expect(damaged.limbPresence.lower_leg_l).toBe("absent");
    expect(damaged.limbPresence.foot_l).toBe("absent");
    expect(damaged.moduleVisibility.shoulder_socket_l).toBe(true);
    expect(damaged.moduleVisibility.shoulder_terminals_r).toBe(true);
  });

  it("recomputes repaired from the complete base without stale damaged state", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );
    resolveActorBlueprintVariant(snapshot, "damaged");
    const repaired = resolveActorBlueprintVariant(snapshot, "repaired");

    expect(repaired.limbPresence.upper_arm_r).toBe("present");
    expect(repaired.limbPresence.forearm_r).toBe("present");
    expect(repaired.limbPresence.hand_r).toBe("present");
    expect(repaired.limbPresence.lower_leg_l).toBe("absent");
    expect(repaired.limbPresence.foot_l).toBe("absent");
    expect(repaired.limbPresence.lower_leg_r).toBe("absent");
    expect(repaired.limbPresence.foot_r).toBe("absent");
    expect(repaired.moduleVisibility.shoulder_terminals_r).toBe(false);
    expect(repaired.moduleVisibility.knee_interface_l).toBe(true);
    expect(repaired.moduleVisibility.knee_interface_r).toBe(true);
  });

  it("rejects a present child beneath an effectively absent ancestor", () => {
    const document = createGenericActorBlueprintDocument();
    document.variants.push({
      variantId: "invalid_chain",
      limbPresence: {
        upper_arm_r: "absent",
        hand_r: "present",
      },
      moduleVisibility: {},
    });

    expect(() => actorBlueprintDocumentSchema.parse(document)).toThrow(
      "ACTOR_BLUEPRINT_VARIANT_INVALID",
    );
  });

  it("rejects unknown module overrides and duplicate identifiers", () => {
    const unknownModule = createGenericActorBlueprintDocument();
    unknownModule.variants[0].moduleVisibility.unknown_module = true;
    expect(() => actorBlueprintDocumentSchema.parse(unknownModule)).toThrow(
      "ACTOR_BLUEPRINT_VARIANT_INVALID",
    );

    const duplicateVariant = createGenericActorBlueprintDocument();
    duplicateVariant.variants.push(
      structuredClone(duplicateVariant.variants[0]),
    );
    expect(() => actorBlueprintDocumentSchema.parse(duplicateVariant)).toThrow(
      "ACTOR_BLUEPRINT_VARIANT_INVALID",
    );

    const duplicateModule = createGenericActorBlueprintDocument();
    duplicateModule.modules.push(structuredClone(duplicateModule.modules[0]));
    expect(() => actorBlueprintDocumentSchema.parse(duplicateModule)).toThrow(
      "ACTOR_BLUEPRINT_FILE_INVALID",
    );

    const duplicatePart = createGenericActorBlueprintDocument();
    duplicatePart.modules[0].parts.push(
      structuredClone(duplicatePart.modules[0].parts[0]),
    );
    expect(() => actorBlueprintDocumentSchema.parse(duplicatePart)).toThrow(
      "ACTOR_BLUEPRINT_FILE_INVALID",
    );
  });

  it("enforces strict shape, bounds, counts, IDs, and normalized quaternions", () => {
    const invalidId = {
      ...createGenericActorBlueprintDocument(),
      blueprintId: "private_actor_name",
    };
    expect(() => actorBlueprintDocumentSchema.parse(invalidId)).toThrow();

    const tooShort = createGenericActorBlueprintDocument();
    tooShort.body.heightM = 0.99;
    expect(() => actorBlueprintDocumentSchema.parse(tooShort)).toThrow();

    const invalidQuaternion = createGenericActorBlueprintDocument();
    invalidQuaternion.modules[0].parts[0].transform.rotation = [0, 0, 0, 2];
    expect(() => actorBlueprintDocumentSchema.parse(invalidQuaternion)).toThrow(
      "ACTOR_BLUEPRINT_FILE_INVALID",
    );

    const tooManyModules = createGenericActorBlueprintDocument();
    tooManyModules.modules = Array.from({ length: 65 }, (_, index) => ({
      ...structuredClone(tooManyModules.modules[0]),
      moduleId: `module_${index}`,
    }));
    expect(() => actorBlueprintDocumentSchema.parse(tooManyModules)).toThrow();

    const unknownField = {
      ...createGenericActorBlueprintDocument(),
      sourcePath: "not-allowed",
    };
    expect(() => actorBlueprintDocumentSchema.parse(unknownField)).toThrow();
  });

  it("uses content identity independent of blueprintId", () => {
    const first = createGenericActorBlueprintDocument();
    const second = createGenericActorBlueprintDocument();
    second.blueprintId = "actor_blueprint_2";

    expect(createActorBlueprintSnapshot(first).contentSha256).toBe(
      createActorBlueprintSnapshot(second).contentSha256,
    );

    second.blueprintVersion += 1;
    expect(createActorBlueprintSnapshot(first).contentSha256).not.toBe(
      createActorBlueprintSnapshot(second).contentSha256,
    );
  });

  it("rejects a stored snapshot whose content hash does not match", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );

    expect(() =>
      actorBlueprintSnapshotSchema.parse({
        ...snapshot,
        contentSha256: "0".repeat(64),
      }),
    ).toThrow("ACTOR_BLUEPRINT_HASH_MISMATCH");
  });

  it("rejects an unknown variant deterministically", () => {
    const snapshot = createActorBlueprintSnapshot(
      createGenericActorBlueprintDocument(),
    );

    expect(() => resolveActorBlueprintVariant(snapshot, "unknown")).toThrow(
      "ACTOR_BLUEPRINT_VARIANT_INVALID",
    );
  });
});
