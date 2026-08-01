import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Euler, MathUtils, Quaternion } from "three";
import {
  canonicalPuppetJointIds,
  type CanonicalPuppetJointId,
} from "../domain/actor-joints";
import { quaternionFromEulerDegrees } from "../domain/scene-math";
import type {
  AnyActorEntity,
  QuaternionTuple,
  SceneSpec,
  Vec3,
} from "../domain/scene-schema";

export interface ActorJointControlsProps {
  scene: SceneSpec;
  actor: AnyActorEntity;
  disabled: boolean;
  onSetJointRotation?: (
    actorId: string,
    jointId: CanonicalPuppetJointId,
    rotation: QuaternionTuple,
  ) => void;
}

const IDENTITY_ROTATION: QuaternionTuple = [0, 0, 0, 1];
const MIN_JOINT_DEGREES = -180;
const MAX_JOINT_DEGREES = 180;

const axisSemantics = {
  x: "弯曲",
  y: "扭转",
  z: "侧弯",
} as const;

const jointLabels: Record<CanonicalPuppetJointId, string> = {
  pelvis: "骨盆",
  spine: "脊柱",
  neck: "颈部",
  upper_arm_l: "左上臂",
  forearm_l: "左前臂",
  hand_l: "左手",
  upper_arm_r: "右上臂",
  forearm_r: "右前臂",
  hand_r: "右手",
  upper_leg_l: "左大腿",
  lower_leg_l: "左小腿",
  foot_l: "左脚",
  upper_leg_r: "右大腿",
  lower_leg_r: "右小腿",
  foot_r: "右脚",
};

const jointGroups: ReadonlyArray<{
  label: string;
  jointIds: readonly CanonicalPuppetJointId[];
}> = [
  { label: "躯干", jointIds: ["pelvis", "spine", "neck"] },
  {
    label: "左臂",
    jointIds: ["upper_arm_l", "forearm_l", "hand_l"],
  },
  {
    label: "右臂",
    jointIds: ["upper_arm_r", "forearm_r", "hand_r"],
  },
  {
    label: "左腿",
    jointIds: ["upper_leg_l", "lower_leg_l", "foot_l"],
  },
  {
    label: "右腿",
    jointIds: ["upper_leg_r", "lower_leg_r", "foot_r"],
  },
];

const degreesFromQuaternion = (rotation: QuaternionTuple): Vec3 => {
  const [x, y, z, w] = rotation;
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

const displayDegrees = (value: number): string => {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return normalized.toFixed(1);
};

const degreeDraftFromRotation = (
  rotation: QuaternionTuple,
): [string, string, string] => {
  const degrees = degreesFromQuaternion(rotation);
  return degrees.map(displayDegrees) as [string, string, string];
};

const quaternionsEquivalent = (
  left: QuaternionTuple,
  right: QuaternionTuple,
): boolean => {
  const dot = left.reduce(
    (sum, value, index) => sum + value * right[index],
    0,
  );
  return Math.abs(Math.abs(dot) - 1) <= 1e-6;
};

export const ActorJointControls = ({
  scene,
  actor,
  disabled,
  onSetJointRotation,
}: ActorJointControlsProps) => {
  const [selectedJointId, setSelectedJointId] =
    useState<CanonicalPuppetJointId>(canonicalPuppetJointIds[0]);
  const acceptedRotation =
    actor.pose.joints[selectedJointId] ?? IDENTITY_ROTATION;
  const acceptedRotationKey = acceptedRotation.join(":");
  const [degreeDrafts, setDegreeDrafts] = useState(() =>
    degreeDraftFromRotation(acceptedRotation)
  );
  const [invalidAxes, setInvalidAxes] = useState<[boolean, boolean, boolean]>(
    [false, false, false],
  );
  const draftRef = useRef(degreeDrafts);
  const dirtyAxesRef = useRef<[boolean, boolean, boolean]>([
    false,
    false,
    false,
  ]);
  const editingDisabled =
    disabled || actor.lockMode !== "none" || !onSetJointRotation;

  const setDrafts = (next: [string, string, string]) => {
    draftRef.current = next;
    setDegreeDrafts(next);
  };

  const restoreAccepted = () => {
    dirtyAxesRef.current = [false, false, false];
    setInvalidAxes([false, false, false]);
    setDrafts(degreeDraftFromRotation(acceptedRotation));
  };

  useEffect(() => {
    restoreAccepted();
  }, [actor.id, acceptedRotationKey, scene.revision, selectedJointId]);

  const updateAxisDraft = (axisIndex: 0 | 1 | 2, value: string) => {
    const next = [...draftRef.current] as [string, string, string];
    next[axisIndex] = value;
    dirtyAxesRef.current[axisIndex] = true;
    setInvalidAxes((current) => {
      const nextInvalid = [...current] as [boolean, boolean, boolean];
      nextInvalid[axisIndex] = false;
      return nextInvalid;
    });
    setDrafts(next);
  };

  const commitDrafts = (restoreInvalid: boolean): boolean => {
    const trimmed = draftRef.current.map((value) => value.trim());
    const parsed = trimmed.map((value) => Number(value));
    const nextInvalid = parsed.map(
      (value, index) =>
        trimmed[index].length === 0 ||
        !Number.isFinite(value) ||
        value < MIN_JOINT_DEGREES ||
        value > MAX_JOINT_DEGREES,
    ) as [boolean, boolean, boolean];
    if (nextInvalid.some(Boolean)) {
      setInvalidAxes(nextInvalid);
      if (restoreInvalid) restoreAccepted();
      return false;
    }

    const nextDegrees = parsed as Vec3;
    const nextRotation = quaternionFromEulerDegrees(nextDegrees);
    if (!quaternionsEquivalent(nextRotation, acceptedRotation)) {
      onSetJointRotation?.(actor.id, selectedJointId, nextRotation);
    }
    restoreAccepted();
    return true;
  };

  const handleEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    restoreAccepted();
    event.currentTarget.blur();
  };

  return (
    <section className="inspector-section actor-joint-controls">
      <div className="section-title-row">
        <h3>关节旋转</h3>
        <span>角度 ° · XYZ</span>
      </div>
      <label className="joint-selector-field">
        <span>当前关节</span>
        <select
          aria-label="人物关节选择"
          data-actor-edit
          disabled={editingDisabled}
          value={selectedJointId}
          onChange={(event) => {
            setSelectedJointId(
              event.currentTarget.value as CanonicalPuppetJointId,
            );
          }}
        >
          {jointGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.jointIds.map((jointId) => (
                <option
                  key={jointId}
                  data-joint-id={jointId}
                  value={jointId}
                >
                  {jointLabels[jointId]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="joint-axis-grid">
        {(["x", "y", "z"] as const).map((axis, index) => {
          const axisIndex = index as 0 | 1 | 2;
          const numericDraft = Number(degreeDrafts[axisIndex]);
          const rangeValue = Number.isFinite(numericDraft)
            ? Math.min(
                MAX_JOINT_DEGREES,
                Math.max(MIN_JOINT_DEGREES, numericDraft),
              )
            : degreesFromQuaternion(acceptedRotation)[axisIndex];
          const axisLabel = `${axis.toUpperCase()} ${axisSemantics[axis]}`;
          const label = `${jointLabels[selectedJointId]} ${axisLabel}`;

          return (
            <div
              className="joint-axis-control"
              data-joint-axis={axis}
              key={axis}
            >
              <label htmlFor={`${actor.id}-${selectedJointId}-${axis}-number`}>
                <span className={`axis axis-${axis}`} aria-hidden="true">
                  {axis.toUpperCase()}
                </span>
                <span className="joint-axis-meaning">{axisSemantics[axis]}</span>
                <span className="visually-hidden">{label}，单位度</span>
              </label>
              <input
                id={`${actor.id}-${selectedJointId}-${axis}-number`}
                aria-label={`${label}，单位度`}
                aria-invalid={invalidAxes[axisIndex]}
                data-actor-edit
                data-joint-angle-number
                disabled={editingDisabled}
                max={MAX_JOINT_DEGREES}
                min={MIN_JOINT_DEGREES}
                step={0.1}
                type="number"
                value={degreeDrafts[axisIndex]}
                onBlur={() => {
                  if (dirtyAxesRef.current[axisIndex]) {
                    commitDrafts(true);
                  }
                }}
                onChange={(event) =>
                  updateAxisDraft(axisIndex, event.currentTarget.value)
                }
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    if (
                      !dirtyAxesRef.current[axisIndex] ||
                      commitDrafts(false)
                    ) {
                      event.currentTarget.blur();
                    }
                  } else {
                    handleEscape(event);
                  }
                }}
              />
              <input
                aria-label={`${label}滑块`}
                data-actor-edit
                data-joint-angle-range
                disabled={editingDisabled}
                max={MAX_JOINT_DEGREES}
                min={MIN_JOINT_DEGREES}
                step={0.5}
                type="range"
                value={rangeValue}
                onBlur={() => {
                  if (dirtyAxesRef.current[axisIndex]) {
                    commitDrafts(true);
                  }
                }}
                onChange={(event) =>
                  updateAxisDraft(axisIndex, event.currentTarget.value)
                }
                onKeyDown={handleEscape}
                onKeyUp={(event) => {
                  if (
                    dirtyAxesRef.current[axisIndex] &&
                    (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight" ||
                      event.key === "ArrowDown" ||
                      event.key === "ArrowUp" ||
                      event.key === "Home" ||
                      event.key === "End"
                    )
                  ) {
                    commitDrafts(false);
                  }
                }}
                onPointerUp={() => {
                  if (dirtyAxesRef.current[axisIndex]) {
                    commitDrafts(true);
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      <button
        className="joint-reset-button"
        data-actor-edit
        data-joint-reset
        disabled={editingDisabled}
        type="button"
        onClick={() => {
          onSetJointRotation?.(
            actor.id,
            selectedJointId,
            [...IDENTITY_ROTATION],
          );
          restoreAccepted();
        }}
      >
        重置当前关节
      </button>
    </section>
  );
};
