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
import { ACTOR_LIMB_PART_IDS } from "../src/domain/actor-anatomy";

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
  maxProperties?: number;
  minProperties?: number;
  properties?: Record<string, JsonSchemaNode>;
  [key: string]: unknown;
};

const addActorLimbUpdateBounds = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) addActorLimbUpdateBounds(item);
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
  for (const child of Object.values(node)) {
    addActorLimbUpdateBounds(child);
  }
};

const generatedSchema = (
  fileName: string,
  schema: z.ZodType,
): unknown => {
  const generated = z.toJSONSchema(schema);
  if (
    fileName === "scene-patch.schema.json" ||
    fileName === "patch-submission.schema.json"
  ) {
    addActorLimbUpdateBounds(generated);
  }
  return generated;
};

await Promise.all(
  schemas.map(([fileName, schema]) =>
    writeFile(
      path.join(outputDirectory, fileName),
      `${JSON.stringify(generatedSchema(fileName, schema), null, 2)}\n`,
      "utf8",
    ),
  ),
);

process.stdout.write(`Generated schemas in ${outputDirectory}\n`);
