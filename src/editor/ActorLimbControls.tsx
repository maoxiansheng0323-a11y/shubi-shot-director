import {
  ACTOR_LIMB_CHAINS,
  createAllPresentLimbPresence,
  type ActorLimbPartId,
  type ActorLimbPresenceMode,
} from "../domain/actor-anatomy";
import { resolveActorBlueprintInstance } from "../domain/actor-blueprint";
import {
  isLegacyActorEntity,
  type AnyActorEntity,
  type SceneSpec,
} from "../domain/scene-schema";

const groupLabels: Record<keyof typeof ACTOR_LIMB_CHAINS, string> = {
  leftArm: "左臂",
  rightArm: "右臂",
  leftLeg: "左腿",
  rightLeg: "右腿",
};

const partLabels: Record<ActorLimbPartId, string> = {
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

export interface ActorLimbControlsProps {
  scene: SceneSpec;
  actor: AnyActorEntity;
  disabled: boolean;
  onSetLimbPresence?: (
    actorId: string,
    partId: ActorLimbPartId,
    mode: ActorLimbPresenceMode,
  ) => void;
}

export const dispatchActorLimbPresenceChange = (
  actor: AnyActorEntity,
  partId: ActorLimbPartId,
  mode: ActorLimbPresenceMode,
  onSetLimbPresence?: ActorLimbControlsProps["onSetLimbPresence"],
): boolean => {
  if (!onSetLimbPresence) return false;
  onSetLimbPresence(actor.id, partId, mode);
  return true;
};

export const ActorLimbControls = ({
  scene,
  actor,
  disabled,
  onSetLimbPresence,
}: ActorLimbControlsProps) => {
  const limbPresence = isLegacyActorEntity(actor)
    ? actor.body.limbPresence
    : (() => {
        const snapshot = scene.actorBlueprints.find(
          ({ blueprintId }) =>
            blueprintId === actor.blueprintInstance.blueprintId,
        );
        return snapshot
          ? resolveActorBlueprintInstance(
              snapshot,
              actor.blueprintInstance.variantId,
              actor.blueprintInstance.limbPresenceOverrides,
            ).limbPresence
          : createAllPresentLimbPresence();
      })();
  const chains = Object.entries(ACTOR_LIMB_CHAINS) as Array<
    [keyof typeof ACTOR_LIMB_CHAINS, readonly ActorLimbPartId[]]
  >;

  return (
    <section className="inspector-section">
      <div className="section-title-row">
        <h3>肢体可见性</h3>
        <span>SceneSpec</span>
      </div>
      <div className="limb-control-groups">
        {chains.map(([groupId, chain]) => (
          <fieldset className="limb-control-group" key={groupId}>
            <legend>{groupLabels[groupId]}</legend>
            {chain.map((partId, partIndex) => {
              const absentAncestor = chain
                .slice(0, partIndex)
                .find(
                  (ancestorId) =>
                    limbPresence[ancestorId] === "absent",
                );
              const reason = disabled
                ? "编辑器当前不可用"
                : actor.lockMode === "workflow"
                  ? "流程锁定，无法编辑"
                  : actor.lockMode === "user"
                    ? "用户保护，无法编辑"
                    : !onSetLimbPresence
                      ? "肢体编辑当前不可用"
                      : absentAncestor
                        ? `请先恢复${partLabels[absentAncestor]}`
                        : undefined;
              const reasonId = `${actor.id}-${partId}-limb-reason`;

              return (
                <label className="limb-control-row" key={partId}>
                  <span>{partLabels[partId]}</span>
                  <select
                    aria-describedby={reason ? reasonId : undefined}
                    aria-label={`${partLabels[partId]} presence`}
                    data-actor-edit
                    data-limb-part={partId}
                    disabled={reason !== undefined}
                    title={reason}
                    value={limbPresence[partId]}
                    onChange={(event) =>
                      dispatchActorLimbPresenceChange(
                        actor,
                        partId,
                        event.currentTarget.value as ActorLimbPresenceMode,
                        onSetLimbPresence,
                      )
                    }
                  >
                    <option value="present">存在</option>
                    <option value="absent">缺失</option>
                  </select>
                  {reason ? (
                    <span className="limb-control-reason" id={reasonId}>
                      {reason}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </section>
  );
};
