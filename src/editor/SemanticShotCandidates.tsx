import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useState } from "react";
import type { RenderSpaceEvidence } from "../domain/render-space-verification";
import { RenderSpaceVerifier } from "../three/RenderSpaceVerifier";
import { SceneWorld, ShotCamera } from "../three/SceneWorld";
import { sceneClient, type SemanticShotSolve } from "./scene-client";

export const SemanticShotCandidates = () => {
  const [solve, setSolve] = useState<SemanticShotSolve | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await sceneClient.getCurrentSemanticShotSolve();
        if (active) {
          setSolve(next);
          setError(null);
        }
      } catch {
        if (active) setError("候选状态暂时不可用");
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1200);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const submitEvidence = useCallback(async (evidence: RenderSpaceEvidence) => {
    setSolve(await sceneClient.submitSemanticShotEvidence(evidence));
  }, []);

  const acceptCandidate = useCallback(async (candidateId: string) => {
    if (!solve) return;
    try {
      await sceneClient.acceptSemanticShotCandidate(solve.solveId, candidateId);
    } catch {
      setError("候选尚未通过验证，无法接受");
      return;
    }
    setSolve(null);
    setError(null);
  }, [solve]);

  if (!solve && !error) return null;

  return (
    <section className="semantic-candidate-strip" aria-label="Semantic shot candidates">
      <header className="semantic-candidate-heading">
        <div>
          <strong>Semantic Shot Candidates</strong>
          <span>generation {solve?.generation ?? "—"} · browser ID-mask verification</span>
        </div>
        {error ? <span className="semantic-candidate-error">{error}</span> : null}
      </header>
      {solve ? (
        <div className="semantic-candidate-list">
          {solve.candidates.map((candidate) => {
            const verified = candidate.renderVerification?.status === "pass";
            return (
              <article className="semantic-candidate" key={candidate.candidateId}>
                <div className="semantic-candidate-preview">
                  <Canvas dpr={1} gl={{ antialias: false, preserveDrawingBuffer: false }}>
                    <color attach="background" args={["#20252c"]} />
                    <ShotCamera scene={candidate.scene} />
                    <SceneWorld
                      scene={candidate.scene}
                      view="shot"
                      selectedEntityId={null}
                      onSelectEntity={() => undefined}
                    />
                    {candidate.renderVerification === null ? (
                      <RenderSpaceVerifier
                        solveId={solve.solveId}
                        candidateId={candidate.candidateId}
                        sceneSha256={candidate.sceneSha256}
                        plan={solve.plan}
                        onEvidence={submitEvidence}
                      />
                    ) : null}
                  </Canvas>
                </div>
                <div className="semantic-candidate-meta">
                  <strong>{candidate.label}</strong>
                  <span>
                    {candidate.finalScore ?? candidate.score} · {candidate.renderVerification?.status ?? "verifying"}
                  </span>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!verified}
                    onClick={() => void acceptCandidate(candidate.candidateId)}
                  >
                    接受候选
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};
