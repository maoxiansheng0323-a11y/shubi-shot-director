import type { SceneSpec } from "../domain/scene-schema";

export interface CompactShotPreviewControlsProps {
  scene: SceneSpec;
  disabled?: boolean;
  onActivateCamera: (cameraId: string) => void;
  onExpand: () => void;
  expanded?: boolean;
  onCollapse?: () => void;
}

export const CompactShotPreviewControls = ({
  scene,
  disabled = false,
  onActivateCamera,
  onExpand,
  expanded = false,
  onCollapse,
}: CompactShotPreviewControlsProps) => {
  const cameras = scene.entities.filter(
    (entity) => entity.kind === "camera",
  );
  const activeCamera = cameras.find(
    (camera) => camera.id === scene.activeCameraId,
  );

  return (
    <div
      className="compact-shot-preview-controls"
      data-studio-keyboard-exclusion="true"
    >
      <div className="compact-shot-preview-heading">
        <span>Active camera</span>
        <strong>{activeCamera?.label ?? "Unavailable camera"}</strong>
      </div>
      <label>
        <span className="visually-hidden">Active shot camera</span>
        <select
          aria-label="Active shot camera"
          disabled={disabled}
          value={scene.activeCameraId}
          onChange={(event) => onActivateCamera(event.currentTarget.value)}
        >
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.label}
            </option>
          ))}
        </select>
      </label>
      <span className="compact-shot-preview-output">
        {scene.output.resolutionPx.width} × {scene.output.resolutionPx.height}
        {" · "}
        {scene.output.aspect.width}:{scene.output.aspect.height}
      </span>
      <button
        aria-label={expanded ? "Close shot preview" : "Expand shot preview"}
        disabled={disabled}
        onClick={expanded ? onCollapse : onExpand}
        type="button"
      >
        {expanded ? "Close" : "Expand"}
      </button>
    </div>
  );
};
