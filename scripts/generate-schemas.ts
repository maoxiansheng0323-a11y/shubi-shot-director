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

await Promise.all(
  schemas.map(([fileName, schema]) =>
    writeFile(
      path.join(outputDirectory, fileName),
      `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`,
      "utf8",
    ),
  ),
);

process.stdout.write(`Generated schemas in ${outputDirectory}\n`);
