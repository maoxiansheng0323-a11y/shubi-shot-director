import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Euler, MathUtils, Quaternion } from "three";
import type {
  SceneEntity,
  SceneSpec,
  TransformSpec,
  Vec3,
} from "../domain/scene-schema";
import { quaternionFromEulerDegrees } from "../domain/scene-math";
import { ActorPresetControls } from "./ActorPresetControls";
import { CompositionChecks } from "./CompositionChecks";

export interface InspectorProps {
  scene: SceneSpec;
  selectedId: string | null;
  disabled?: boolean;
  onCommitTransform?: (entityId: string, transform: TransformSpec) => void;
  onCommitFocalLength?: (cameraId: string, focalLengthMm: number) => void;
  onApplyPose?: (actorId: string, presetId: string) => void;
  onApplyRelationship?: (
    presetId: string,
    primaryActorId: string,
    secondaryActorId: string,
    surfaceEntityId?: string,
  ) => void;
  onSetGroundContact?: (
    actorId: string,
    surfaceEntityId: string | null,
    enabled: boolean,
  ) => void;
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision: number;
  disabled: boolean;
  axis?: "x" | "y" | "z";
  onCommit: (value: number) => void;
}

const POSITION_LIMIT_M = 10_000;
const ROTATION_LIMIT_DEGREES = 360;
const FOCAL_LENGTH_MIN_MM = 12;
const FOCAL_LENGTH_MAX_MM = 300;

const numberInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 26,
  padding: "0 5px",
  border: 0,
  outline: 0,
  color: "#cfd6de",
  background: "transparent",
  fontFamily: '"SFMono-Regular", Consolas, monospace',
  fontSize: 9,
  textAlign: "right",
};

const focalNumberStyle: CSSProperties = {
  width: 78,
  padding: "5px 7px",
  border: "1px solid #333b45",
  borderRadius: 6,
  color: "#eff4f9",
  background: "#11151a",
  fontFamily: '"SFMono-Regular", Consolas, monospace',
  fontSize: 18,
  fontWeight: 620,
};

const displayNumber = (value: number, precision = 2): string => {
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return rounded.toFixed(precision);
};

const eulerDegreesFromTransform = (transform: TransformSpec): Vec3 => {
  const [x, y, z, w] = transform.rotation;
  const euler = new Euler().setFromQuaternion(
    new Quaternion(x, y, z, w),
    "XYZ",
  );
  return [
    MathUtils.radToDeg(euler.x),
    MathUtils.radToDeg(euler.y),
    MathUtils.radToDeg(euler.z),
  ];
};

const NumberField = ({
  id,
  label,
  value,
  min,
  max,
  step,
  precision,
  disabled,
  axis,
  onCommit,
}: NumberFieldProps) => {
  const [draft, setDraft] = useState(() => displayNumber(value, precision));
  const [invalid, setInvalid] = useState(false);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraft(displayNumber(value, precision));
      setInvalid(false);
    }
  }, [precision, value]);

  const restore = () => {
    editingRef.current = false;
    setInvalid(false);
    setDraft(displayNumber(value, precision));
  };

  const commit = (restoreInvalid: boolean): boolean => {
    const parsed = Number(draft.trim());
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setInvalid(true);
      if (restoreInvalid) {
        restore();
      }
      return false;
    }

    const normalized = Math.abs(parsed) < 1e-8 ? 0 : parsed;
    editingRef.current = false;
    setInvalid(false);
    setDraft(displayNumber(normalized, precision));
    if (Math.abs(normalized - value) > 1e-8) {
      onCommit(normalized);
    }
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      if (commit(false)) {
        event.currentTarget.blur();
      }
    } else if (event.key === "Escape") {
      restore();
      event.currentTarget.blur();
    }
  };

  return (
    <div>
      {axis ? (
        <label
          className={`axis axis-${axis}`}
          htmlFor={id}
          title={label}
        >
          {axis.toUpperCase()}
          <span className="visually-hidden">{label}</span>
        </label>
      ) : null}
      <input
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        style={{
          ...numberInputStyle,
          color: invalid ? "#ff9c93" : numberInputStyle.color,
        }}
        type="number"
        value={draft}
        onBlur={() => {
          if (editingRef.current) {
            commit(true);
          }
        }}
        onChange={(event) => {
          editingRef.current = true;
          setInvalid(false);
          setDraft(event.target.value);
        }}
        onFocus={(event) => {
          editingRef.current = true;
          event.currentTarget.select();
        }}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
};

const TransformEditor = ({
  entity,
  disabled,
  onCommit,
}: {
  entity: SceneEntity;
  disabled: boolean;
  onCommit?: (entityId: string, transform: TransformSpec) => void;
}) => {
  const transformRef = useRef(entity.transform);
  const lastPropTransformRef = useRef(entity.transform);
  if (lastPropTransformRef.current !== entity.transform) {
    lastPropTransformRef.current = entity.transform;
    transformRef.current = entity.transform;
  }
  const rotationDegrees = eulerDegreesFromTransform(entity.transform);
  const editingDisabled = disabled || entity.locked || !onCommit;

  const commitPosition = (axisIndex: 0 | 1 | 2, value: number) => {
    const current = transformRef.current;
    const positionM = [...current.positionM] as Vec3;
    positionM[axisIndex] = value;
    const next = { ...current, positionM };
    transformRef.current = next;
    onCommit?.(entity.id, next);
  };

  const commitRotation = (axisIndex: 0 | 1 | 2, value: number) => {
    const current = transformRef.current;
    const eulerDegrees = eulerDegreesFromTransform(current);
    eulerDegrees[axisIndex] = value;
    const next = {
      ...current,
      rotation: quaternionFromEulerDegrees(eulerDegrees),
    };
    transformRef.current = next;
    onCommit?.(entity.id, next);
  };

  return (
    <section className="inspector-section">
      <div className="section-title-row">
        <h3>位置</h3>
        <span>{entity.locked ? "已锁定" : "米"}</span>
      </div>
      <div className="vector-readout">
        {(["x", "y", "z"] as const).map((axis, index) => (
          <NumberField
            key={`${entity.id}-position-${axis}`}
            axis={axis}
            disabled={editingDisabled}
            id={`${entity.id}-position-${axis}`}
            label={`位置 ${axis.toUpperCase()}，单位米`}
            max={POSITION_LIMIT_M}
            min={-POSITION_LIMIT_M}
            precision={2}
            step={0.01}
            value={entity.transform.positionM[index]}
            onCommit={(value) =>
              commitPosition(index as 0 | 1 | 2, value)
            }
          />
        ))}
      </div>

      <div className="section-title-row" style={{ marginTop: 12 }}>
        <h3>旋转</h3>
        <span>角度 ° · XYZ</span>
      </div>
      <div className="vector-readout">
        {(["x", "y", "z"] as const).map((axis, index) => (
          <NumberField
            key={`${entity.id}-rotation-${axis}`}
            axis={axis}
            disabled={editingDisabled}
            id={`${entity.id}-rotation-${axis}`}
            label={`旋转 ${axis.toUpperCase()}，单位度`}
            max={ROTATION_LIMIT_DEGREES}
            min={-ROTATION_LIMIT_DEGREES}
            precision={1}
            step={0.1}
            value={rotationDegrees[index]}
            onCommit={(value) =>
              commitRotation(index as 0 | 1 | 2, value)
            }
          />
        ))}
      </div>

      <p className="quaternion-readout">
        Q&nbsp;{entity.transform.rotation.map((value) => displayNumber(value)).join(" · ")}
      </p>
    </section>
  );
};

const FocalLengthEditor = ({
  cameraId,
  value,
  disabled,
  onCommit,
}: {
  cameraId: string;
  value: number;
  disabled: boolean;
  onCommit?: (cameraId: string, focalLengthMm: number) => void;
}) => {
  const [draft, setDraft] = useState(() => displayNumber(value, 1));
  const [invalid, setInvalid] = useState(false);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraft(displayNumber(value, 1));
      setInvalid(false);
    }
  }, [value]);

  const restore = () => {
    editingRef.current = false;
    setInvalid(false);
    setDraft(displayNumber(value, 1));
  };

  const commit = (restoreInvalid: boolean): boolean => {
    const parsed = Number(draft.trim());
    if (
      !Number.isFinite(parsed) ||
      parsed < FOCAL_LENGTH_MIN_MM ||
      parsed > FOCAL_LENGTH_MAX_MM
    ) {
      setInvalid(true);
      if (restoreInvalid) {
        restore();
      }
      return false;
    }

    editingRef.current = false;
    setInvalid(false);
    setDraft(displayNumber(parsed, 1));
    if (Math.abs(parsed - value) > 1e-8) {
      onCommit?.(cameraId, parsed);
    }
    return true;
  };

  const rangeValue = Number(draft);
  const safeRangeValue = Number.isFinite(rangeValue)
    ? Math.min(
        FOCAL_LENGTH_MAX_MM,
        Math.max(FOCAL_LENGTH_MIN_MM, rangeValue),
      )
    : value;
  const editingDisabled = disabled || !onCommit;

  return (
    <>
      <div className="lens-value">
        <label htmlFor={`${cameraId}-focal-length`}>
          <span className="visually-hidden">摄像机焦距，单位毫米</span>
          <input
            id={`${cameraId}-focal-length`}
            aria-label="摄像机焦距，单位毫米"
            aria-invalid={invalid}
            disabled={editingDisabled}
            max={FOCAL_LENGTH_MAX_MM}
            min={FOCAL_LENGTH_MIN_MM}
            step={0.1}
            style={{
              ...focalNumberStyle,
              borderColor: invalid ? "#a34c47" : "#333b45",
            }}
            type="number"
            value={draft}
            onBlur={() => {
              if (editingRef.current) {
                commit(true);
              }
            }}
            onChange={(event) => {
              editingRef.current = true;
              setInvalid(false);
              setDraft(event.target.value);
            }}
            onFocus={(event) => {
              editingRef.current = true;
              event.currentTarget.select();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (commit(false)) {
                  event.currentTarget.blur();
                }
              } else if (event.key === "Escape") {
                restore();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <span>mm</span>
      </div>
      <label
        htmlFor={`${cameraId}-focal-length-range`}
        style={{ display: "block", marginTop: 9 }}
      >
        <span className="visually-hidden">焦距滑块</span>
        <input
          id={`${cameraId}-focal-length-range`}
          aria-label="焦距滑块"
          disabled={editingDisabled}
          max={FOCAL_LENGTH_MAX_MM}
          min={FOCAL_LENGTH_MIN_MM}
          step={0.5}
          style={{ width: "100%", accentColor: "#8ba3bb" }}
          type="range"
          value={safeRangeValue}
          onBlur={() => {
            if (editingRef.current) {
              commit(true);
            }
          }}
          onChange={(event) => {
            editingRef.current = true;
            setInvalid(false);
            setDraft(event.target.value);
          }}
          onFocus={() => {
            editingRef.current = true;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              restore();
              event.currentTarget.blur();
            }
          }}
          onKeyUp={(event) => {
            if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Home" ||
              event.key === "End"
            ) {
              commit(false);
            }
          }}
          onPointerDown={() => {
            editingRef.current = true;
          }}
          onPointerUp={() => {
            commit(true);
          }}
        />
      </label>
    </>
  );
};

export const Inspector = ({
  scene,
  selectedId,
  disabled = false,
  onCommitTransform,
  onCommitFocalLength,
  onApplyPose,
  onApplyRelationship,
  onSetGroundContact,
}: InspectorProps) => {
  const selected = scene.entities.find((entity) => entity.id === selectedId);
  const camera =
    selected?.kind === "camera"
      ? selected
      : scene.entities.find(
          (entity) =>
            entity.id === scene.activeCameraId && entity.kind === "camera",
        );

  return (
    <aside
      className="panel inspector"
      id="compact-inspector-panel"
      aria-label="属性检查器"
    >
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">INSPECTOR</p>
          <h2>{selected?.label ?? "未选择元素"}</h2>
        </div>
        {selected ? (
          <span className={`kind-pill kind-${selected.kind}`}>
            {selected.kind}
          </span>
        ) : null}
      </div>

      {selected ? (
        <>
          <TransformEditor
            key={selected.id}
            disabled={disabled}
            entity={selected}
            onCommit={onCommitTransform}
          />
          {selected.kind === "actor" ? (
            <>
              <section className="inspector-section">
                <div className="section-title-row">
                  <h3>人偶</h3>
                  <span>{selected.body.build}</span>
                </div>
                <dl className="property-list">
                  <div>
                    <dt>槽位</dt>
                    <dd>{selected.slot}</dd>
                  </div>
                  <div>
                    <dt>身高</dt>
                    <dd>{selected.body.heightM.toFixed(2)} m</dd>
                  </div>
                  <div>
                    <dt>姿势</dt>
                    <dd>{selected.pose.preset.id}</dd>
                  </div>
                </dl>
              </section>
              <ActorPresetControls
                actor={selected}
                disabled={disabled}
                scene={scene}
                onApplyPose={onApplyPose}
                onApplyRelationship={onApplyRelationship}
                onSetGroundContact={onSetGroundContact}
              />
            </>
          ) : null}
          {selected.kind === "prop" ? (
            <section className="inspector-section">
              <div className="section-title-row">
                <h3>灰模体块</h3>
                <span>{selected.geometry.primitive}</span>
              </div>
              <p className="dimension-readout">
                {selected.geometry.sizeM.map((value) => displayNumber(value)).join(" × ")} m
              </p>
              <p className="dimension-readout">
                缩放&nbsp;
                {selected.transform.scale.map((value) => displayNumber(value)).join(" × ")}
              </p>
            </section>
          ) : null}
        </>
      ) : (
        <div className="empty-inspector">
          <span>←</span>
          <p>从场景列表或主视口选择人物、物体或摄像机。</p>
        </div>
      )}

      <section className="inspector-section camera-summary">
        <div className="section-title-row">
          <h3>最终镜头</h3>
          <span>16:9</span>
        </div>
        {camera?.kind === "camera" ? (
          <>
            <FocalLengthEditor
              key={camera.id}
              cameraId={camera.id}
              disabled={disabled || camera.locked}
              value={camera.lens.focalLengthMm}
              onCommit={onCommitFocalLength}
            />
            <p>
              传感器宽 {camera.lens.sensorWidthMm} mm · 输出{" "}
              {scene.output.resolutionPx.width} ×{" "}
              {scene.output.resolutionPx.height}
            </p>
          </>
        ) : (
          <p>当前场景没有有效的最终摄像机。</p>
        )}
      </section>
      <CompositionChecks scene={scene} />
    </aside>
  );
};
