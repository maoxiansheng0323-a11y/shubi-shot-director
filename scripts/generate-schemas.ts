import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { intentReportSchema } from "../src/domain/intent-report";
import { scenePatchSchema } from "../src/domain/scene-patch";
import { sceneSpecSchema } from "../src/domain/scene-schema";
import {
  patchSubmissionSchema,
  sceneSubmissionSchema,
} from "../src/domain/scene-submission";
import {
  ACTOR_LIMB_CHAINS,
  ACTOR_LIMB_PART_IDS,
} from "../src/domain/actor-anatomy";
import { canonicalPuppetJointIds } from "../src/domain/actor-joints";
import {
  MAX_ACTOR_HEIGHT_M,
  MIN_ACTOR_HEIGHT_M,
} from "../src/domain/actor-stature";
import {
  canonicalHumanoidJointIds,
  listPosePresets,
  POSE_CONTACT_OFFSET_DECIMAL_PLACES,
} from "../src/domain/presets/pose-presets";

const outputDirectory = path.resolve(
  ".agents/skills/shubi-shot-director/references/generated",
);

await mkdir(outputDirectory, { recursive: true });

const schemas = [
  ["scene-spec.schema.json", sceneSpecSchema],
  ["scene-patch.schema.json", scenePatchSchema],
  ["intent-report.schema.json", intentReportSchema],
  ["scene-submission.schema.json", sceneSubmissionSchema],
  ["patch-submission.schema.json", patchSubmissionSchema],
] as const;

type JsonSchemaNode = {
  const?: unknown;
  items?: unknown;
  maxItems?: number;
  maxProperties?: number;
  minItems?: number;
  minProperties?: number;
  properties?: Record<string, JsonSchemaNode>;
  "x-shubi-limb-hierarchy"?: {
    chains: string[][];
    enforcedBy: "runtime-zod-refinement";
  };
  "x-shubi-normalized-quaternion"?: boolean;
  "x-shubi-resolved-stature"?: {
    formula: "snapshot.body.heightM * heightScale";
    minimumM: number;
    maximumM: number;
    enforcedBy: "runtime-zod-refinement";
  };
  [key: string]: unknown;
};

const actorLimbHierarchyAnnotation = {
  chains: Object.values(ACTOR_LIMB_CHAINS).map((chain) => [...chain]),
  enforcedBy: "runtime-zod-refinement" as const,
};

const hasPropertySignature = (
  node: JsonSchemaNode,
  propertyNames: readonly string[],
): boolean =>
  propertyNames.every(
    (propertyName) => node.properties?.[propertyName] !== undefined,
  );

const isCanonicalLimbSchema = (
  node: JsonSchemaNode | undefined,
): node is JsonSchemaNode => {
  if (node?.properties === undefined) return false;
  const propertyNames = Object.keys(node.properties);
  return (
    propertyNames.length === ACTOR_LIMB_PART_IDS.length &&
    ACTOR_LIMB_PART_IDS.every((partId) =>
      Object.prototype.hasOwnProperty.call(node.properties, partId),
    )
  );
};

const addLimbHierarchyAnnotation = (node: JsonSchemaNode): void => {
  node["x-shubi-limb-hierarchy"] = {
    chains: actorLimbHierarchyAnnotation.chains.map((chain) => [...chain]),
    enforcedBy: actorLimbHierarchyAnnotation.enforcedBy,
  };
};

const addActorSemanticAnnotations = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) addActorSemanticAnnotations(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const node = value as JsonSchemaNode;
  const heightScaleSchema = node.properties?.heightScale;
  if (
    hasPropertySignature(node, [
      "blueprintId",
      "variantId",
      "heightScale",
      "limbPresenceOverrides",
    ]) &&
    heightScaleSchema !== undefined
  ) {
    heightScaleSchema["x-shubi-resolved-stature"] = {
      formula: "snapshot.body.heightM * heightScale",
      minimumM: MIN_ACTOR_HEIGHT_M,
      maximumM: MAX_ACTOR_HEIGHT_M,
      enforcedBy: "runtime-zod-refinement",
    };
  }
  for (const propertyName of [
    "limbPresence",
    "limbPresenceOverrides",
  ] as const) {
    const propertySchema = node.properties?.[propertyName];
    if (isCanonicalLimbSchema(propertySchema)) {
      addLimbHierarchyAnnotation(propertySchema);
    }
  }
  if (
    node.properties?.op?.const === "actor.limb-presence.set" &&
    isCanonicalLimbSchema(node.properties.updates)
  ) {
    addLimbHierarchyAnnotation(node.properties.updates);
  }
  for (const child of Object.values(node)) {
    addActorSemanticAnnotations(child);
  }
};

const addQuaternionBounds = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) addQuaternionBounds(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const node = value as JsonSchemaNode;
  if (node["x-shubi-normalized-quaternion"] === true) {
    node.minItems = 4;
    node.maxItems = 4;
    node.items = false;
  }
  for (const child of Object.values(node)) {
    addQuaternionBounds(child);
  }
};

const addActorUpdateBounds = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) addActorUpdateBounds(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const node = value as JsonSchemaNode;
  if (
    node.properties?.op?.const === "actor.limb-presence.set" &&
    node.properties.updates !== undefined
  ) {
    node.properties.updates.minProperties = 1;
    node.properties.updates.maxProperties = ACTOR_LIMB_PART_IDS.length;
  }
  if (
    node.properties?.op?.const === "actor.pose.joints.set" &&
    node.properties.updates !== undefined
  ) {
    node.properties.updates.minProperties = 1;
    node.properties.updates.maxProperties = canonicalPuppetJointIds.length;
  }
  for (const child of Object.values(node)) {
    addActorUpdateBounds(child);
  }
};

const generatedSchema = (
  fileName: string,
  schema: z.ZodType,
): unknown => {
  const generated = z.toJSONSchema(schema);
  addQuaternionBounds(generated);
  addActorSemanticAnnotations(generated);
  if (
    fileName === "scene-patch.schema.json" ||
    fileName === "patch-submission.schema.json"
  ) {
    addActorUpdateBounds(generated);
  }
  return generated;
};

await Promise.all(
  [
    ...schemas.map(([fileName, schema]) =>
      writeFile(
        path.join(outputDirectory, fileName),
        `${JSON.stringify(generatedSchema(fileName, schema), null, 2)}\n`,
        "utf8",
      ),
    ),
    writeFile(
      path.join(outputDirectory, "pose-presets.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jointIds: [...canonicalHumanoidJointIds],
          contactOffsetDecimalPlaces:
            POSE_CONTACT_OFFSET_DECIMAL_PLACES,
          presets: listPosePresets().map((preset) => ({
            id: preset.id,
            version: preset.version,
            label: preset.label,
            contactOffsetHeightRatio:
              preset.contactOffsetHeightRatio,
            joints: Object.fromEntries(
              canonicalHumanoidJointIds.map((jointId) => [
                jointId,
                [...preset.joints[jointId]],
              ]),
            ),
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ],
);

process.stdout.write(`Generated Skill references in ${outputDirectory}\n`);
