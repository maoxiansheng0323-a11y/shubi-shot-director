import type { SceneEntity, SceneSpec } from "../domain/scene-schema";

interface OutlinerProps {
  scene: SceneSpec;
  selectedId: string | null;
  onSelect: (entityId: string) => void;
}

const entityKindLabel: Record<SceneEntity["kind"], string> = {
  environment: "环境",
  actor: "人物",
  prop: "物体",
  camera: "摄像机",
};

const entityKindGlyph: Record<SceneEntity["kind"], string> = {
  environment: "▧",
  actor: "●",
  prop: "◆",
  camera: "◉",
};

const kindOrder: SceneEntity["kind"][] = [
  "camera",
  "actor",
  "prop",
  "environment",
];

export const Outliner = ({
  scene,
  selectedId,
  onSelect,
}: OutlinerProps) => (
  <aside
    className="panel outliner"
    id="compact-scene-panel"
    aria-label="场景元素"
  >
    <div className="panel-heading">
      <div>
        <p className="panel-kicker">SCENE</p>
        <h2>场景元素</h2>
      </div>
      <span className="panel-count">{scene.entities.length}</span>
    </div>

    <div className="outliner-groups">
      {kindOrder.map((kind) => {
        const entities = scene.entities.filter(
          (entity) => entity.kind === kind,
        );
        if (entities.length === 0) {
          return null;
        }
        return (
          <section className="outliner-group" key={kind}>
            <h3>{entityKindLabel[kind]}</h3>
            <div className="outliner-items">
              {entities.map((entity) => (
                <button
                  className={
                    entity.id === selectedId
                      ? "outliner-item is-selected"
                      : "outliner-item"
                  }
                  data-entity-id={entity.id}
                  key={entity.id}
                  onClick={() => onSelect(entity.id)}
                  type="button"
                >
                  <span className={`entity-glyph entity-${kind}`}>
                    {entityKindGlyph[kind]}
                  </span>
                  <span className="entity-copy">
                    <strong>{entity.label}</strong>
                    <small>
                      {entity.kind === "actor" ? entity.slot : entity.id}
                    </small>
                  </span>
                  {entity.locked ? (
                    <span className="entity-lock" aria-label="已锁定">
                      ⌁
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  </aside>
);
