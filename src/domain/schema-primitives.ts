import { z } from "zod";

export const finiteNumberSchema = z.number().finite();
export const positiveFiniteNumberSchema = finiteNumberSchema.positive();

export const entityIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);
