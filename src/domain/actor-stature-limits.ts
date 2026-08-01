export const MIN_ACTOR_HEIGHT_M = 1;
export const MAX_ACTOR_HEIGHT_M = 2.4;

const ACTOR_HEIGHT_RANGE_TOLERANCE_M = 1e-9;

export const isActorHeightWithinRange = (heightM: number): boolean =>
  Number.isFinite(heightM) &&
  heightM >= MIN_ACTOR_HEIGHT_M - ACTOR_HEIGHT_RANGE_TOLERANCE_M &&
  heightM <= MAX_ACTOR_HEIGHT_M + ACTOR_HEIGHT_RANGE_TOLERANCE_M;
