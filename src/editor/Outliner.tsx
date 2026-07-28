import type { SceneEntity, SceneSpec } from "../domain/scene-schema";

interface OutlinerProps {
  scene: SceneSpec;
  selectedId: string | null;
  selectedRegionId: string | null;
  onSelect: (entityId: string) => void;
  onSelectRegion: (regionId: string) => void;
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

const lockCopy = {
  workflow: {
    label: "流程锁定",
    accessibleLabel: "Workflow locked",
  },
  user: {
    label: "用户保护",
    accessibleLabel: "User protected",
  },
} as const;

export const Outliner = ({
  scene,
  selectedId,
  selectedRegionId,
  onSelect,
  onSelectRegion,
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
      <span className="panel-count">
        {scene.spatialLayout
          ? `${scene.spatialLayout.regions.length}R · ${scene.entities.length}E`
          : scene.entities.length}
      </span>
    </div>

    <div className="outliner-groups">
      {scene.spatialLayout ? (
        <>
          <section className="outliner-group">
            <h3>区域</h3>
            <div className="outliner-items">
              {scene.spatialLayout.regions.map((region) => (
                <button
                  className={
                    region.id === selectedRegionId
                      ? "outliner-item is-selected"
                      : "outliner-item"
                  }
                  data-region-id={region.id}
                  key={region.id}
                  onClick={() => onSelectRegion(region.id)}
                  type="button"
                >
                  <span className="entity-glyph entity-region">▰</span>
                  <span className="entity-copy">
                    <strong>{region.label}</strong>
                    <small>
                      {region.id} · {region.visible ? "可见" : "隐藏"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
          {scene.spatialLayout.boundaries.length > 0 ? (
            <section className="outliner-group">
              <h3>边界与开口</h3>
              <div className="outliner-items">
                {scene.spatialLayout.boundaries.map((boundary) => {
                  const openingCount =
                    scene.spatialLayout!.openings.filter(
                      (opening) => opening.boundaryId === boundary.id,
                    ).length;
                  return (
                    <div className="outliner-item is-static" key={boundary.id}>
                      <span className="entity-glyph entity-boundary">╱</span>
                      <span className="entity-copy">
                        <strong>{boundary.label}</strong>
                        <small>
                          {boundary.regionIds.join(" ↔ ")} · {openingCount} 个开口
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          {scene.spatialLayout.connections.length > 0 ? (
            <section className="outliner-group">
              <h3>连通关系</h3>
              <div className="outliner-items">
                {scene.spatialLayout.connections.map((connection) => (
                  <div
                    className="outliner-item is-static"
                    key={connection.id}
                  >
                    <span className="entity-glyph entity-connection">⇄</span>
                    <span className="entity-copy">
                      <strong>{connection.label}</strong>
                      <small>
                        {connection.regionIds.join(" ↔ ")} ·{" "}
                        {connection.enabled ? "启用" : "停用"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
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
                  {entity.lockMode !== "none" ? (
                    <span
                      className={`entity-lock entity-lock-${entity.lockMode}`}
                      title={lockCopy[entity.lockMode].label}
                    >
                      <span aria-hidden="true">
                        {lockCopy[entity.lockMode].label}
                      </span>
                      <span className="visually-hidden">
                        {lockCopy[entity.lockMode].accessibleLabel}
                      </span>
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
