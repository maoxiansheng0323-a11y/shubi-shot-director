import { z } from "zod";

export const ENTITY_LOCK_MODES = ["none", "workflow", "user"] as const;
export const entityLockModeSchema = z.enum(ENTITY_LOCK_MODES);
export type EntityLockMode = z.infer<typeof entityLockModeSchema>;
export type EntityLockErrorCode =
  | "USER_LOCKED"
  | "WORKFLOW_LOCKED";

export const mutationBlockedByLock = (
  mode: EntityLockMode,
  preserveLock: boolean,
): EntityLockErrorCode | null => {
  if (mode === "user") {
    return "USER_LOCKED";
  }
  if (mode === "workflow" && !preserveLock) {
    return "WORKFLOW_LOCKED";
  }
  return null;
};

export const isLocked = (mode: EntityLockMode): boolean =>
  mode !== "none";

export const legacyLockedToMode = (locked: boolean): EntityLockMode =>
  locked ? "workflow" : "none";
