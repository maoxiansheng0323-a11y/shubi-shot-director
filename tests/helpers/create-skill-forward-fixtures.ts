import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { mkdir } from "node:fs/promises";
import {
  createSkillRuntimeAtRoot,
  type SkillRuntimeFixtureOptions,
} from "./skill-runtime-fixture";

export const forwardCaseIds = [
  "current",
  "no-export",
  "v1",
  "future-compatible",
  "future-schema",
  "requires-key",
] as const;

export type ForwardCaseId = (typeof forwardCaseIds)[number];

export const defaultForwardTiers = [
  "generic-tier-a",
  "generic-tier-b",
] as const;

const commandIds = [
  "doctor",
  "ensure",
  "status",
  "stop",
  "health",
  "snapshot",
  "blueprint.validate",
  "scene.create",
  "scene.submit",
  "scene.save",
  "scene.load",
  "patch.apply",
  "patch.submit",
  "composition.inspect",
  "export.png",
  "undo",
  "redo",
  "open.system",
];

const featureIds = [
  "bridge.thread-workspaces",
  "input.intent-report.validate",
  "input.scene-submission.atomic",
  "input.patch-submission.atomic",
  "scene.files",
  "export.software-png",
  "composition.segmented-report",
  "bridge.safe-shutdown",
  "actor.limb-presence",
  "actor.blueprint-snapshots",
  "actor.modular-primitives",
  "actor.variants",
  "actor.resolved-projection",
  "actor.height",
  "actor.pose-joints",
  "actor.blueprint-instance-limb-overrides",
];

const entityLockModes = ["none", "workflow", "user"] as const;
const patchPolicyFields = ["preserveLock"] as const;
const lockErrorCodes = [
  "USER_LOCKED",
  "WORKFLOW_LOCKED",
  "LOCK_PRESERVATION_CONFLICT",
] as const;
const actorLimbPartIds = [
  "upper_arm_l",
  "forearm_l",
  "hand_l",
  "upper_arm_r",
  "forearm_r",
  "hand_r",
  "upper_leg_l",
  "lower_leg_l",
  "foot_l",
  "upper_leg_r",
  "lower_leg_r",
  "foot_r",
] as const;
const actorLimbPresenceModes = ["present", "absent"] as const;
const actorLimbErrorCodes = ["LIMB_HIERARCHY_CONFLICT"] as const;
const actorPuppet = {
  heightLimitsM: { min: 1, max: 2.4 },
  jointIds: [
    "pelvis", "spine", "neck", "upper_arm_l", "forearm_l", "hand_l",
    "upper_arm_r", "forearm_r", "hand_r", "upper_leg_l", "lower_leg_l",
    "foot_l", "upper_leg_r", "lower_leg_r", "foot_r",
  ],
  operationIds: ["actor.height.set", "actor.pose.joints.set"],
  errorCodes: [
    "ACTOR_HEIGHT_TARGET_INVALID",
    "ACTOR_HEIGHT_RANGE_INVALID",
    "ACTOR_JOINT_TARGET_INVALID",
    "ACTOR_JOINT_ID_INVALID",
  ],
} as const;
const actorBlueprint = {
  schemaVersion: 1,
  mounts: [
    "shoulder_l",
    "shoulder_r",
    "elbow_l",
    "elbow_r",
    "wrist_l",
    "wrist_r",
    "hip_l",
    "hip_r",
    "knee_l",
    "knee_r",
  ],
  primitives: ["box", "sphere", "cylinder"],
  variantDeltaFields: ["limbPresence", "moduleVisibility"],
  errorCodes: [
    "ACTOR_BLUEPRINT_FILE_READ_FAILED",
    "ACTOR_BLUEPRINT_FILE_INVALID",
    "ACTOR_BLUEPRINT_SCHEMA_UNSUPPORTED",
    "ACTOR_BLUEPRINT_VARIANT_INVALID",
    "ACTOR_BLUEPRINT_HASH_MISMATCH",
    "ACTOR_BLUEPRINT_HASH_DUPLICATE",
    "ACTOR_BLUEPRINT_REFERENCE_INVALID",
    "ACTOR_BLUEPRINT_ID_CONFLICT",
  ],
} as const;

const modernManifest = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  service: "shubi-shot-director",
  capabilitiesContractVersion: 2,
  applicationVersion: "1.0.0",
  bridgeProtocolVersion: 1,
  workspaceRoutingVersion: 1,
  sceneSchemaVersion: 6,
  patchSchemaVersion: 6,
  intentReportSchemaVersion: 6,
  semanticAuthority: "host",
  inputContract: "structured-only",
  modelIntegration: "none",
  credentialPolicy: "forbidden",
  networkPolicy: "loopback-only",
  commands: [...commandIds],
  features: [...featureIds],
  entityLockModes: [...entityLockModes],
  patchPolicyFields: [...patchPolicyFields],
  lockErrorCodes: [...lockErrorCodes],
  actorLimbPartIds: [...actorLimbPartIds],
  actorLimbPresenceModes: [...actorLimbPresenceModes],
  actorLimbErrorCodes: [...actorLimbErrorCodes],
  actorPuppet: structuredClone(actorPuppet),
  actorBlueprint: structuredClone(actorBlueprint),
  ...overrides,
});

const optionsForCase = (
  caseId: ForwardCaseId,
): SkillRuntimeFixtureOptions => {
  switch (caseId) {
    case "current":
      return { doctorData: modernManifest() };
    case "no-export":
      return {
        doctorData: modernManifest({
          commands: commandIds.filter((id) => id !== "export.png"),
          features: featureIds.filter(
            (id) => id !== "export.software-png",
          ),
        }),
      };
    case "v1":
      return {
        doctorData: modernManifest({
          capabilitiesContractVersion: 1,
          requiresApiKey: false,
        }),
      };
    case "future-compatible":
      return {
        doctorData: modernManifest({ applicationVersion: "999.0.0" }),
      };
    case "future-schema":
      return {
        doctorData: modernManifest({
          applicationVersion: "999.0.0",
          sceneSchemaVersion: 7,
          patchSchemaVersion: 7,
          intentReportSchemaVersion: 7,
        }),
      };
    case "requires-key":
      return {
        doctorData: modernManifest({ requiresApiKey: true }),
      };
  }
};

export interface SkillForwardFixtureSet {
  root: string;
  tiers: string[];
  cases: Record<string, Record<ForwardCaseId, string>>;
}

export interface CreateSkillForwardFixturesOptions {
  root: string;
  tiers?: readonly string[];
}

export const createSkillForwardFixtures = async (
  input: string | CreateSkillForwardFixturesOptions,
  options: { tiers?: readonly string[] } = {},
): Promise<SkillForwardFixtureSet> => {
  const root = path.resolve(
    typeof input === "string" ? input : input.root,
  );
  const tiers = [
    ...(typeof input === "string"
      ? (options.tiers ?? defaultForwardTiers)
      : (input.tiers ?? defaultForwardTiers)),
  ];
  if (
    root === path.parse(root).root ||
    tiers.length === 0 ||
    tiers.some((tier) => tier.length === 0 || path.basename(tier) !== tier)
  ) {
    throw new Error("Forward fixture options are invalid.");
  }

  await mkdir(root, { recursive: true });
  const cases = {} as Record<
    string,
    Record<ForwardCaseId, string>
  >;
  for (const tier of tiers) {
    cases[tier] = {} as Record<ForwardCaseId, string>;
    for (const caseId of forwardCaseIds) {
      const runtimeRoot = path.join(root, tier, caseId);
      await createSkillRuntimeAtRoot(
        runtimeRoot,
        optionsForCase(caseId),
      );
      cases[tier][caseId] = runtimeRoot;
    }
  }
  return { root, tiers, cases };
};

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex === -1 ? undefined : args[rootIndex + 1];
  if (
    root === undefined ||
    args.length !== 2 ||
    rootIndex !== 0
  ) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: { code: "CLI_ARGUMENT_REQUIRED" },
      })}\n`,
    );
    process.exitCode = 1;
  } else {
    try {
      const created = await createSkillForwardFixtures(root);
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          tiers: created.tiers,
          caseIds: forwardCaseIds,
        })}\n`,
      );
    } catch {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: { code: "FIXTURE_CREATE_FAILED" },
        })}\n`,
      );
      process.exitCode = 1;
    }
  }
}
