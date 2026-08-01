import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  applyScenePatch,
  type AppliedScenePatch,
} from "../src/domain/apply-scene-patch";
import { enforceGroundContacts } from "../src/domain/contact-constraints";
import {
  validateIntentCoverage,
  validateIntentPolicy,
} from "../src/domain/intent-coverage";
import { parseSceneSpecInput } from "../src/domain/scene-migrations";
import {
  sceneSpecSchema,
  type SceneSpec,
} from "../src/domain/scene-schema";
import {
  getParsedPatchSubmissionProvenance,
  parsePatchSubmission,
  parseSceneSubmission,
  type ParsedPatchSubmissionInput,
} from "../src/domain/scene-submission";

interface HistoryEntry {
  before: SceneSpec;
  after: SceneSpec;
}

export interface SceneChangeEvent {
  eventId: string;
  reason: "patch" | "replace" | "undo" | "redo";
  scene: SceneSpec;
}

export type SceneChangeListener = (
  event: SceneChangeEvent,
) => void | PromiseLike<void>;

export class SceneSession {
  private scene: SceneSpec;
  private readonly historyPast: HistoryEntry[] = [];
  private readonly historyFuture: HistoryEntry[] = [];
  private readonly events = new EventEmitter();
  private readonly maxHistory: number;

  constructor(initialScene: SceneSpec, maxHistory = 100) {
    this.scene = enforceGroundContacts(sceneSpecSchema.parse(initialScene));
    this.maxHistory = maxHistory;
  }

  snapshot(): SceneSpec {
    return structuredClone(this.scene);
  }

  historyStatus(): { canUndo: boolean; canRedo: boolean } {
    return {
      canUndo: this.historyPast.length > 0,
      canRedo: this.historyFuture.length > 0,
    };
  }

  subscribe(listener: SceneChangeListener): () => void {
    this.events.on("change", listener);
    return () => this.events.off("change", listener);
  }

  applyPatch(input: unknown): SceneSpec {
    const applied = applyScenePatch(this.scene, input);
    return this.commitAppliedPatch(applied);
  }

  submitScene(input: unknown): SceneSpec {
    const { scene } = parseSceneSubmission(input);
    return this.replaceScene(scene);
  }

  submitPatch(input: unknown): SceneSpec {
    const parsed = parsePatchSubmission(input);
    return this.submitParsedPatch(parsed);
  }

  submitParsedPatch(parsed: ParsedPatchSubmissionInput): SceneSpec {
    const provenance = getParsedPatchSubmissionProvenance(parsed);
    const submission = parsed.submission;
    validateIntentPolicy(submission.intentReport, "modify");
    const applied = applyScenePatch(this.scene, submission.patch, {
      provenance,
    });
    validateIntentCoverage(submission.intentReport, {
      before: applied.previous,
      after: applied.next,
      patch: applied.patch,
    });
    return this.commitAppliedPatch(applied);
  }

  private commitAppliedPatch(applied: AppliedScenePatch): SceneSpec {
    if (applied.next.revision === applied.previous.revision) {
      return this.snapshot();
    }
    this.recordHistory({
      before: applied.previous,
      after: applied.next,
    });
    this.scene = applied.next;
    this.notifyChange("patch");
    return this.snapshot();
  }

  replaceScene(input: unknown): SceneSpec {
    const next = enforceGroundContacts(parseSceneSpecInput(input));
    const previous = this.snapshot();
    const replaced = {
      ...structuredClone(next),
      revision: this.scene.revision + 1,
    };
    this.recordHistory({
      before: previous,
      after: replaced,
    });
    this.scene = replaced;
    this.notifyChange("replace");
    return this.snapshot();
  }

  undo(): SceneSpec | null {
    const entry = this.historyPast.pop();
    if (!entry) {
      return null;
    }
    const nextRevision = this.scene.revision + 1;
    this.historyFuture.push(entry);
    this.scene = {
      ...structuredClone(entry.before),
      revision: nextRevision,
    };
    this.notifyChange("undo");
    return this.snapshot();
  }

  redo(): SceneSpec | null {
    const entry = this.historyFuture.pop();
    if (!entry) {
      return null;
    }
    const nextRevision = this.scene.revision + 1;
    this.historyPast.push(entry);
    this.scene = {
      ...structuredClone(entry.after),
      revision: nextRevision,
    };
    this.notifyChange("redo");
    return this.snapshot();
  }

  private recordHistory(entry: HistoryEntry): void {
    this.historyPast.push(entry);
    if (this.historyPast.length > this.maxHistory) {
      this.historyPast.shift();
    }
    this.historyFuture.length = 0;
  }

  private notifyChange(reason: SceneChangeEvent["reason"]): void {
    const event = {
      eventId: `event_${randomUUID().replaceAll("-", "")}`,
      reason,
      scene: this.snapshot(),
    } satisfies SceneChangeEvent;
    for (const listener of this.events.listeners("change")) {
      try {
        const result = (listener as SceneChangeListener)(event);
        if (result !== undefined) {
          void Promise.resolve(result).catch(() => undefined);
        }
      } catch {
        // Subscriber failures must not alter the committed scene transaction.
      }
    }
  }
}
