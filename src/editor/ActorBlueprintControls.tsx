import type {
  BlueprintActorEntity,
  SceneSpec,
} from "../domain/scene-schema";

export interface ActorBlueprintControlsProps {
  scene: SceneSpec;
  actor: BlueprintActorEntity;
  disabled: boolean;
  onSetVariant?: (actorId: string, variantId: string) => void;
}

export const dispatchActorVariantChange = (
  actorId: string,
  variantId: string,
  allowedVariantIds: ReadonlySet<string>,
  onSetVariant?: (actorId: string, variantId: string) => void,
): boolean => {
  if (!onSetVariant || !allowedVariantIds.has(variantId)) {
    return false;
  }
  onSetVariant(actorId, variantId);
  return true;
};

export const ActorBlueprintControls = ({
  scene,
  actor,
  disabled,
  onSetVariant,
}: ActorBlueprintControlsProps) => {
  const snapshot = scene.actorBlueprints.find(
    ({ blueprintId }) =>
      blueprintId === actor.blueprintInstance.blueprintId,
  );
  const variantIds = new Set(
    snapshot?.variants.map(({ variantId }) => variantId) ?? [],
  );
  const selectorDisabled =
    disabled ||
    actor.lockMode !== "none" ||
    snapshot === undefined;

  return (
    <section
      className="inspector-section"
      aria-label="Actor Blueprint"
    >
      <div className="section-title-row">
        <h3>Actor Blueprint</h3>
        <span>v{snapshot?.blueprintVersion ?? "?"}</span>
      </div>
      <dl className="property-list">
        <div>
          <dt>ID</dt>
          <dd>{actor.blueprintInstance.blueprintId}</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>
            {snapshot?.contentSha256.slice(0, 12) ?? "unresolved"}
          </dd>
        </div>
        <div>
          <dt>Modules</dt>
          <dd>{snapshot?.modules.length ?? 0}</dd>
        </div>
        <div>
          <dt>Variants</dt>
          <dd>{snapshot?.variants.length ?? 0}</dd>
        </div>
      </dl>
      <label className="inspector-control-row">
        <span>Variant</span>
        <select
          aria-label="Actor blueprint variant"
          disabled={selectorDisabled}
          value={actor.blueprintInstance.variantId}
          onChange={(event) => {
            dispatchActorVariantChange(
              actor.id,
              event.target.value,
              variantIds,
              onSetVariant,
            );
          }}
        >
          {snapshot?.variants.map(({ variantId }) => (
            <option key={variantId} value={variantId}>
              {variantId}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
};
