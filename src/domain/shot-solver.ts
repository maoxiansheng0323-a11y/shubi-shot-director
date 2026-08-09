import {
  analyzePoseDiagnostics,
  PoseDiagnosticsError,
  type PoseDiagnosticsReport,
} from "./pose-diagnostics";
import { sceneSpecSchema, type SceneSpec } from "./scene-schema";
import {
  SceneRelationshipError,
  solveSceneRelationships,
  type SceneRelationshipSolveResult,
} from "./scene-relationship-solver";
import {
  solveCameraCandidates,
  type SolvedCameraCandidate,
} from "./camera-solver";
import {
  rankSemanticShotCandidates,
} from "./shot-candidate-preferences";
import {
  analyzeFinalShotHardConstraints,
  type ShotHardConstraintReport,
} from "./shot-hard-constraint-verifier";
import { shotIntentPlanSchema, type ShotIntentPlan } from "./shot-intent";

export interface ShotWorldDiagnostics {
  pose: PoseDiagnosticsReport;
  appliedRelationshipConstraintIds: string[];
  hardConstraints: ShotHardConstraintReport;
}

export interface ShotSolveCandidate extends SolvedCameraCandidate {
  worldDiagnostics: ShotWorldDiagnostics;
}

export interface ShotSolveResult {
  solverVersion: 1;
  plan: ShotIntentPlan;
  candidates: ShotSolveCandidate[];
}

export const solveSemanticShot = (
  sceneInput: SceneSpec,
  planInput: ShotIntentPlan,
): ShotSolveResult => {
  const scene = sceneSpecSchema.parse(sceneInput);
  const plan = shotIntentPlanSchema.parse(planInput);
  const relationshipResult: SceneRelationshipSolveResult =
    solveSceneRelationships(scene, plan);
  const pose = analyzePoseDiagnostics(relationshipResult.scene);
  if (pose.status !== "pass") {
    throw new PoseDiagnosticsError(pose);
  }
  const ranked = rankSemanticShotCandidates(
    solveCameraCandidates(relationshipResult.scene, plan),
    plan,
  );
  const candidates = ranked.flatMap((candidate): ShotSolveCandidate[] => {
    const finalHardConstraints = analyzeFinalShotHardConstraints(
      candidate.scene,
      plan,
    );
    if (finalHardConstraints.status !== "pass") return [];
    return [{
      ...candidate,
      worldDiagnostics: {
        pose,
        appliedRelationshipConstraintIds:
          relationshipResult.appliedConstraintIds,
        hardConstraints: finalHardConstraints,
      },
    }];
  });
  if (candidates.length === 0) {
    throw new SceneRelationshipError(
      "SHOT_RELATIONSHIP_UNSOLVABLE",
      "No final camera candidate preserves every hard scene relationship.",
    );
  }
  return {
    solverVersion: 1,
    plan,
    candidates,
  };
};
