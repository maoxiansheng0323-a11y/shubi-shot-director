import { useEffect, useMemo, useState } from "react";
import {
  listPosePresets,
  listRelationshipPresets,
} from "../domain/presets";
import { isSupportedContactSurface } from "../domain/contact-constraints";
import type {
  ActorEntity,
  SceneSpec,
} from "../domain/scene-schema";

export interface ActorPresetControlsProps {
  scene: SceneSpec;
  actor: ActorEntity;
  disabled: boolean;
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

const WORLD_GROUND = "__world_ground__";

export const ActorPresetControls = ({
  scene,
  actor,
  disabled,
  onApplyPose,
  onApplyRelationship,
  onSetGroundContact,
}: ActorPresetControlsProps) => {
  const otherActors = useMemo(
    () =>
      scene.entities.filter(
        (entity): entity is ActorEntity =>
          entity.kind === "actor" && entity.id !== actor.id,
      ),
    [actor.id, scene.entities],
  );
  const surfaces = useMemo(
    () =>
      scene.entities.filter(
        (entity) =>
          (entity.kind === "environment" || entity.kind === "prop") &&
          isSupportedContactSurface(scene, entity.id),
      ),
    [scene],
  );
  const contact = scene.constraints.find(
    (constraint) =>
      constraint.type === "ground-contact" &&
      constraint.entityId === actor.id,
  );
  const currentSurfaceValue =
    contact?.type === "ground-contact" &&
    contact.surfaceEntityId !== null
      ? contact.surfaceEntityId
      : WORLD_GROUND;
  const [secondaryActorId, setSecondaryActorId] = useState(
    otherActors[0]?.id ?? "",
  );
  const [relationshipPresetId, setRelationshipPresetId] = useState(
    listRelationshipPresets()[0]?.id ?? "",
  );
  const [relationshipSurfaceId, setRelationshipSurfaceId] = useState(
    currentSurfaceValue,
  );

  useEffect(() => {
    if (
      secondaryActorId.length === 0 ||
      !otherActors.some((candidate) => candidate.id === secondaryActorId)
    ) {
      setSecondaryActorId(otherActors[0]?.id ?? "");
    }
  }, [otherActors, secondaryActorId]);

  useEffect(() => {
    setRelationshipSurfaceId(currentSurfaceValue);
  }, [actor.id, currentSurfaceValue]);

  const editingDisabled = disabled || actor.lockMode !== "none";
  const contactEnabled =
    contact?.type === "ground-contact" ? contact.enabled : false;
  const posePresets = listPosePresets();
  const hasCurrentPosePreset = posePresets.some(
    (preset) => preset.id === actor.pose.preset.id,
  );
  const overUnderSelected =
    relationshipPresetId ===
    "relationship.over-under-focus-lower-v1";

  return (
    <section className="inspector-section preset-controls">
      <div className="section-title-row">
        <h3>姿势与接触</h3>
        <span
          title={
            actor.lockMode === "workflow"
              ? "流程锁定"
              : actor.lockMode === "user"
                ? "用户保护"
                : undefined
          }
        >
          {actor.lockMode === "workflow"
            ? (
                <>
                  <span aria-hidden="true">流程锁定</span>
                  <span className="visually-hidden">
                    Workflow locked
                  </span>
                </>
              )
            : actor.lockMode === "user"
              ? (
                  <>
                    <span aria-hidden="true">用户保护</span>
                    <span className="visually-hidden">
                      User protected
                    </span>
                  </>
                )
              : "PRESET"}
        </span>
      </div>

      <label className="control-field">
        <span>人物姿势</span>
        <select
          aria-label="人物姿势预设"
          disabled={editingDisabled || !onApplyPose}
          value={actor.pose.preset.id}
          onChange={(event) =>
            onApplyPose?.(actor.id, event.currentTarget.value)
          }
        >
          {!hasCurrentPosePreset ? (
            <option value={actor.pose.preset.id}>
              Current custom pose
            </option>
          ) : null}
          {posePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="contact-toggle">
        <input
          aria-label="启用人物接触吸附"
          checked={contactEnabled}
          disabled={editingDisabled || !onSetGroundContact}
          type="checkbox"
          onChange={(event) =>
            onSetGroundContact?.(
              actor.id,
              currentSurfaceValue === WORLD_GROUND
                ? null
                : currentSurfaceValue,
              event.currentTarget.checked,
            )
          }
        />
        <span>保持接触</span>
      </label>

      <label className="control-field">
        <span>接触表面</span>
        <select
          aria-label="人物接触表面"
          disabled={editingDisabled || !onSetGroundContact}
          value={currentSurfaceValue}
          onChange={(event) =>
            onSetGroundContact?.(
              actor.id,
              event.currentTarget.value === WORLD_GROUND
                ? null
                : event.currentTarget.value,
              contactEnabled,
            )
          }
        >
          <option value={WORLD_GROUND}>World ground</option>
          {surfaces.map((surface) => (
            <option key={surface.id} value={surface.id}>
              {surface.label}
            </option>
          ))}
        </select>
      </label>

      {otherActors.length > 0 ? (
        <div className="relationship-controls">
          <div className="section-title-row">
            <h3>双人关系</h3>
            <span>ATOMIC</span>
          </div>
          <label className="control-field">
            <span>关系预设</span>
            <select
              aria-label="双人关系预设"
              disabled={editingDisabled}
              value={relationshipPresetId}
              onChange={(event) =>
                setRelationshipPresetId(event.currentTarget.value)
              }
            >
              {listRelationshipPresets().map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <p className="relationship-role-summary">
            {overUnderSelected
              ? `当前人物＝上方（${actor.slot}） · 另一人物＝下方、脸部优先`
              : `当前人物＝角色 A（${actor.slot}） · 另一人物＝角色 B`}
          </p>
          <label className="control-field">
            <span>另一人物</span>
            <select
              aria-label="双人关系对象"
              disabled={editingDisabled}
              value={secondaryActorId}
              onChange={(event) =>
                setSecondaryActorId(event.currentTarget.value)
              }
            >
              {otherActors.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label className="control-field">
            <span>支撑表面</span>
            <select
              aria-label="双人关系支撑表面"
              disabled={editingDisabled}
              value={relationshipSurfaceId}
              onChange={(event) =>
                setRelationshipSurfaceId(event.currentTarget.value)
              }
            >
              <option value={WORLD_GROUND}>World ground</option>
              {surfaces.map((surface) => (
                <option key={surface.id} value={surface.id}>
                  {surface.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="preset-apply-button"
            disabled={
              editingDisabled ||
              !onApplyRelationship ||
              secondaryActorId.length === 0
            }
            type="button"
            onClick={() =>
              onApplyRelationship?.(
                relationshipPresetId,
                actor.id,
                secondaryActorId,
                relationshipSurfaceId === WORLD_GROUND
                  ? undefined
                  : relationshipSurfaceId,
              )
            }
          >
            应用双人关系
          </button>
        </div>
      ) : null}
    </section>
  );
};
