import {
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  actorStatureHeightM,
  MAX_ACTOR_HEIGHT_M,
  MIN_ACTOR_HEIGHT_M,
} from "../domain/actor-stature";
import type {
  AnyActorEntity,
  SceneSpec,
} from "../domain/scene-schema";

export interface ActorStatureControlsProps {
  scene: SceneSpec;
  actor: AnyActorEntity;
  disabled: boolean;
  onSetHeight?: (actorId: string, heightM: number) => void;
}

const displayHeight = (heightM: number): string => heightM.toFixed(2);

export const ActorStatureControls = ({
  scene,
  actor,
  disabled,
  onSetHeight,
}: ActorStatureControlsProps) => {
  const acceptedHeightM = actorStatureHeightM(scene, actor);
  const [draft, setDraft] = useState(() => displayHeight(acceptedHeightM));
  const [invalid, setInvalid] = useState(false);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const editingDisabled =
    disabled || actor.lockMode !== "none" || !onSetHeight;

  const setDraftValue = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };

  const restore = () => {
    dirtyRef.current = false;
    setInvalid(false);
    setDraftValue(displayHeight(acceptedHeightM));
  };

  const commit = (restoreInvalid: boolean): boolean => {
    const value = Number(draftRef.current.trim());
    if (
      !Number.isFinite(value) ||
      value < MIN_ACTOR_HEIGHT_M ||
      value > MAX_ACTOR_HEIGHT_M
    ) {
      setInvalid(true);
      if (restoreInvalid) restore();
      return false;
    }

    if (Math.abs(value - acceptedHeightM) > 1e-8) {
      onSetHeight?.(actor.id, value);
    }
    restore();
    return true;
  };

  const handleEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    restore();
    event.currentTarget.blur();
  };

  const rangeValue = Number(draft);
  const safeRangeValue = Number.isFinite(rangeValue)
    ? Math.min(
        MAX_ACTOR_HEIGHT_M,
        Math.max(MIN_ACTOR_HEIGHT_M, rangeValue),
      )
    : acceptedHeightM;

  return (
    <section className="inspector-section actor-stature-controls">
      <div className="section-title-row">
        <h3>人物身高</h3>
        <span>米 · SceneSpec</span>
      </div>
      <div className="stature-input-row">
        <label htmlFor={`${actor.id}-height-number`}>身高</label>
        <div className="stature-number-field">
          <input
            id={`${actor.id}-height-number`}
            aria-label="人物身高，单位米"
            aria-invalid={invalid}
            data-actor-edit
            data-actor-height
            disabled={editingDisabled}
            max={MAX_ACTOR_HEIGHT_M}
            min={MIN_ACTOR_HEIGHT_M}
            step={0.01}
            type="number"
            value={draft}
            onBlur={() => {
              if (dirtyRef.current) commit(true);
            }}
            onChange={(event) => {
              dirtyRef.current = true;
              setInvalid(false);
              setDraftValue(event.currentTarget.value);
            }}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (!dirtyRef.current || commit(false)) {
                  event.currentTarget.blur();
                }
              } else {
                handleEscape(event);
              }
            }}
          />
          <span>m</span>
        </div>
      </div>
      <label className="stature-range-field" htmlFor={`${actor.id}-height-range`}>
        <span className="visually-hidden">人物身高滑块</span>
        <input
          id={`${actor.id}-height-range`}
          aria-label="人物身高滑块"
          data-actor-edit
          data-actor-height
          disabled={editingDisabled}
          max={MAX_ACTOR_HEIGHT_M}
          min={MIN_ACTOR_HEIGHT_M}
          step={0.01}
          type="range"
          value={safeRangeValue}
          onBlur={() => {
            if (dirtyRef.current) commit(true);
          }}
          onChange={(event) => {
            dirtyRef.current = true;
            setInvalid(false);
            setDraftValue(event.currentTarget.value);
          }}
          onKeyDown={handleEscape}
          onKeyUp={(event) => {
            if (
              dirtyRef.current &&
              (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "ArrowDown" ||
                event.key === "ArrowUp" ||
                event.key === "Home" ||
                event.key === "End"
              )
            ) {
              commit(false);
            }
          }}
          onPointerUp={() => {
            if (dirtyRef.current) commit(true);
          }}
        />
      </label>
    </section>
  );
};
