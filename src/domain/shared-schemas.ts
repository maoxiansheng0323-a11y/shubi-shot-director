export {
  cameraLensSchema,
  compositionGoalsSchema,
  jsonObjectSchema,
  outputSpecSchema,
  poseSchema,
  quaternionSchema,
  sceneConstraintSchema,
  sceneEntitySchema,
  transformSchema,
  vec3Schema,
} from "./scene-schema";

import { z } from "zod";

export const entityIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);
