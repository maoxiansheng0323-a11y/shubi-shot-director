import { randomUUID } from "node:crypto";
import { canonicalJsonSha256 } from "../src/domain/canonical-json-sha256";
import {
  evaluateRenderSpaceEvidence,
  renderSpaceEvidenceSchema,
  type RenderSpaceEvidence,
  type RenderSpaceVerificationReport,
} from "../src/domain/render-space-verification";
import {
  applyShotIntentPatch,
  shotIntentPatchSchema,
  type ShotIntentPatch,
  type ShotIntentPlan,
} from "../src/domain/shot-intent";
import {
  parseShotSolveSubmission,
  solveShotSubmission,
  type ShotSolveSubmission,
} from "../src/domain/shot-solve-submission";
import {
  solveSemanticShot,
  type ShotSolveCandidate,
} from "../src/domain/shot-solver";
import type { SceneSpec } from "../src/domain/scene-schema";

export type ShotCandidateSessionErrorCode =
  | "SHOT_SOLVE_NOT_FOUND"
  | "SHOT_SOLVE_STALE_GENERATION"
  | "SHOT_CANDIDATE_NOT_FOUND"
  | "SHOT_CANDIDATE_NOT_VERIFIED"
  | "SHOT_CANDIDATE_VERIFICATION_FAILED"
  | "SHOT_SOLVE_STALE_SCENE";

export class ShotCandidateSessionError extends Error {
  readonly code: ShotCandidateSessionErrorCode;

  constructor(code: ShotCandidateSessionErrorCode, message: string) {
    super(message);
    this.name = "ShotCandidateSessionError";
    this.code = code;
  }
}

interface StoredCandidate extends ShotSolveCandidate {
  sceneSha256: string;
  renderVerification: RenderSpaceVerificationReport | null;
  finalScore: number | null;
}

interface StoredSolve {
  solveId: string;
  generation: number;
  baseSessionSceneId: string;
  baseSessionRevision: number;
  baseSessionSceneSha256: string;
  submission: ShotSolveSubmission;
  candidates: StoredCandidate[];
}

export interface PublicShotCandidate {
  candidateId: string;
  label: string;
  profile: ShotSolveCandidate["profile"];
  score: number;
  finalScore: number | null;
  sceneSha256: string;
  scene: SceneSpec;
  composition: ShotSolveCandidate["composition"];
  metrics: ShotSolveCandidate["metrics"];
  worldDiagnostics: ShotSolveCandidate["worldDiagnostics"];
  renderVerification: RenderSpaceVerificationReport | null;
}

export interface PublicShotSolve {
  solveId: string;
  generation: number;
  solverVersion: 1;
  baseSessionSceneId: string;
  baseSessionRevision: number;
  plan: ShotIntentPlan;
  candidates: PublicShotCandidate[];
}

const publicSolve = (stored: StoredSolve): PublicShotSolve => ({
  solveId: stored.solveId,
  generation: stored.generation,
  solverVersion: 1,
  baseSessionSceneId: stored.baseSessionSceneId,
  baseSessionRevision: stored.baseSessionRevision,
  plan: structuredClone(stored.submission.plan),
  candidates: stored.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    label: candidate.label,
    profile: candidate.profile,
    score: candidate.score,
    finalScore: candidate.finalScore,
    sceneSha256: candidate.sceneSha256,
    scene: structuredClone(candidate.scene),
    composition: structuredClone(candidate.composition),
    metrics: structuredClone(candidate.metrics),
    worldDiagnostics: structuredClone(candidate.worldDiagnostics),
    renderVerification: structuredClone(candidate.renderVerification),
  })),
});

export class ShotCandidateSession {
  private currentSolve: StoredSolve | null = null;

  current(): PublicShotSolve | null {
    return this.currentSolve ? publicSolve(this.currentSolve) : null;
  }

  clear(): void {
    this.currentSolve = null;
  }

  solve(input: unknown, baseSessionScene: SceneSpec): PublicShotSolve {
    const parsed = parseShotSolveSubmission(input);
    if (
      parsed.plan.operation === "modify" &&
      (
        parsed.scene.sceneId !== baseSessionScene.sceneId ||
        parsed.scene.revision !== baseSessionScene.revision ||
        canonicalJsonSha256(parsed.scene) !== canonicalJsonSha256(baseSessionScene)
      )
    ) {
      throw new ShotCandidateSessionError(
        "SHOT_SOLVE_STALE_SCENE",
        "A modify semantic shot solve must use the exact authoritative SceneSession snapshot.",
      );
    }
    const { submission, result } = solveShotSubmission(parsed);
    const solveId = `solve_${randomUUID().replaceAll("-", "")}`;
    this.currentSolve = {
      solveId,
      generation: 0,
      baseSessionSceneId: baseSessionScene.sceneId,
      baseSessionRevision: baseSessionScene.revision,
      baseSessionSceneSha256: canonicalJsonSha256(baseSessionScene),
      submission,
      candidates: result.candidates.map((candidate) => ({
        ...candidate,
        sceneSha256: canonicalJsonSha256(candidate.scene),
        renderVerification: null,
        finalScore: null,
      })),
    };
    return publicSolve(this.currentSolve);
  }

  modify(patchInput: ShotIntentPatch, baseSessionScene: SceneSpec): PublicShotSolve {
    const stored = this.requireSolve(patchInput.solveId);
    const patch = shotIntentPatchSchema.parse(patchInput);
    if (patch.baseGeneration !== stored.generation) {
      throw new ShotCandidateSessionError(
        "SHOT_SOLVE_STALE_GENERATION",
        "The semantic shot modification targets a stale candidate generation.",
      );
    }
    this.assertSessionFresh(stored, baseSessionScene);
    const plan = applyShotIntentPatch(stored.submission.plan, patch);
    const nextSubmission = {
      ...stored.submission,
      plan,
    };
    const result = solveSemanticShot(nextSubmission.scene, plan);
    stored.generation += 1;
    stored.submission = nextSubmission;
    stored.candidates = result.candidates.map((candidate) => ({
      ...candidate,
      sceneSha256: canonicalJsonSha256(candidate.scene),
      renderVerification: null,
      finalScore: null,
    }));
    return publicSolve(stored);
  }

  verify(evidenceInput: RenderSpaceEvidence): PublicShotSolve {
    const evidence = renderSpaceEvidenceSchema.parse(evidenceInput);
    const stored = this.requireSolve(evidence.solveId);
    const candidate = stored.candidates.find(
      ({ candidateId }) => candidateId === evidence.candidateId,
    );
    if (!candidate) {
      throw new ShotCandidateSessionError(
        "SHOT_CANDIDATE_NOT_FOUND",
        "The requested semantic shot candidate is unavailable.",
      );
    }
    candidate.renderVerification = evaluateRenderSpaceEvidence({
      scene: candidate.scene,
      plan: stored.submission.plan,
      expectedSceneSha256: candidate.sceneSha256,
      evidence,
    });
    candidate.finalScore = candidate.renderVerification.status === "pass"
      ? Math.round(
          (candidate.score + candidate.renderVerification.scoreAdjustment) * 1000,
        ) / 1000
      : null;
    stored.candidates.sort(
      (left, right) =>
        (right.finalScore ?? -Infinity) - (left.finalScore ?? -Infinity) ||
        right.score - left.score ||
        left.candidateId.localeCompare(right.candidateId),
    );
    return publicSolve(stored);
  }

  candidateForAcceptance(
    solveId: string,
    candidateId: string,
    baseSessionScene: SceneSpec,
  ): SceneSpec {
    const stored = this.requireSolve(solveId);
    this.assertSessionFresh(stored, baseSessionScene);
    const candidate = stored.candidates.find(
      (entry) => entry.candidateId === candidateId,
    );
    if (!candidate) {
      throw new ShotCandidateSessionError(
        "SHOT_CANDIDATE_NOT_FOUND",
        "The requested semantic shot candidate is unavailable.",
      );
    }
    if (!candidate.renderVerification) {
      throw new ShotCandidateSessionError(
        "SHOT_CANDIDATE_NOT_VERIFIED",
        "The candidate has not completed browser render-space verification.",
      );
    }
    if (candidate.renderVerification.status !== "pass") {
      throw new ShotCandidateSessionError(
        "SHOT_CANDIDATE_VERIFICATION_FAILED",
        "The candidate failed browser render-space verification.",
      );
    }
    return structuredClone(candidate.scene);
  }

  private requireSolve(solveId: string): StoredSolve {
    if (!this.currentSolve || this.currentSolve.solveId !== solveId) {
      throw new ShotCandidateSessionError(
        "SHOT_SOLVE_NOT_FOUND",
        "The requested semantic shot solve is unavailable.",
      );
    }
    return this.currentSolve;
  }

  private assertSessionFresh(stored: StoredSolve, scene: SceneSpec): void {
    if (
      scene.sceneId !== stored.baseSessionSceneId ||
      scene.revision !== stored.baseSessionRevision ||
      canonicalJsonSha256(scene) !== stored.baseSessionSceneSha256
    ) {
      throw new ShotCandidateSessionError(
        "SHOT_SOLVE_STALE_SCENE",
        "The authoritative SceneSession changed after candidate generation.",
      );
    }
  }
}
