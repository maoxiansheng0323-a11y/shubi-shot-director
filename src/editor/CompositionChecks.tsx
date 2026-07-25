import {
  analyzeComposition,
  type CompositionCheckResult,
  type CompositionIssueCode,
} from "../domain/composition-safety";
import type { SceneSpec } from "../domain/scene-schema";

const issueLabels: Partial<Record<CompositionIssueCode, string>> = {
  ACTIVE_CAMERA_MISSING: "最终摄像机缺失",
  KEEP_VISIBLE_CAMERA_MISSING: "可见性摄像机缺失",
  KEEP_VISIBLE_SUBJECT_MISSING: "可见目标缺失",
  KEEP_VISIBLE_SUBJECT_HIDDEN: "可见目标已隐藏",
  ANCHOR_BEHIND_CAMERA: "锚点在摄像机后方",
  ANCHOR_BEFORE_NEAR_CLIP: "锚点进入近裁剪面",
  ANCHOR_BEYOND_FAR_CLIP: "锚点超出远裁剪面",
  ANCHOR_OUT_OF_FRAME: "锚点已出框",
  ANCHOR_NEAR_SAFE_EDGE: "锚点接近安全边缘",
  ANCHOR_OCCLUDED_APPROXIMATE: "锚点可能被遮挡",
  FRAMING_SUBJECT_MISSING: "构图目标缺失",
  FRAMING_SUBJECT_HIDDEN: "构图目标已隐藏",
  FRAMING_BOUNDS_OUT_OF_FRAME: "目标范围被裁切",
  FRAMING_BOUNDS_NEAR_EDGE: "目标范围接近画面边缘",
  HEADROOM_INSUFFICIENT: "头顶空间不足",
  EYELINE_OUTSIDE_GUIDE: "视线偏离构图参考区",
  RESERVED_ZONE_TARGET_UNPROJECTABLE: "安全区目标无法投影",
  SUBJECT_OVERLAPS_CAPTION_ZONE: "主体进入字幕区",
  SUBJECT_OVERLAPS_SIDE_UI_ZONE: "主体进入侧边 UI 区",
  SUBJECT_OCCLUDED_APPROXIMATE: "主体可能被遮挡",
  TOPOLOGY_ENVIRONMENT_UNAVAILABLE: "缺少可检查的房间",
  CRITICAL_ENTITY_OUTSIDE_ROOM: "关键主体位于房间外",
  SIGHTLINE_INTERSECTS_WALL: "视线穿过墙体",
  CAMERA_COLLIDES_WALL: "摄像机位于墙体内",
  CAMERA_INSIDE_PROP: "摄像机位于道具内",
};

const resultStatusLabel: Record<CompositionCheckResult["status"], string> = {
  pass: "PASS",
  check: "CHECK",
  fail: "FAIL",
  unchecked: "未检查",
};

const resultStatusClass = (
  result: CompositionCheckResult,
): string =>
  result.status === "pass"
    ? "check-status check-safe"
    : result.status === "unchecked"
      ? "check-status check-unchecked"
      : "check-status check-warning";

export const CompositionChecks = ({ scene }: { scene: SceneSpec }) => {
  const report = analyzeComposition(scene);
  const overallLabel =
    report.overallStatus === "safe"
      ? "SAFE"
      : report.overallStatus === "fail"
        ? "FAIL"
        : report.overallStatus === "check"
          ? "CHECK"
          : "未检查";
  const overallClass =
    report.overallStatus === "safe"
      ? "check-status check-safe"
      : report.overallStatus === "unchecked"
        ? "check-status check-unchecked"
        : "check-status check-warning";
  const checks: Array<{
    label: string;
    result: CompositionCheckResult;
  }> = [
    { label: "锚点", result: report.anchorSafe },
    { label: "景别 / 构图", result: report.framingSafe },
    { label: "字幕 / UI", result: report.captionSafe },
    { label: "遮挡", result: report.occlusionSafe },
    { label: "空间拓扑", result: report.topologySafe },
    { label: "摄像机碰撞", result: report.cameraCollisionSafe },
  ];

  return (
    <section className="inspector-section composition-checks">
      <div className="section-title-row">
        <h3>构图安全</h3>
        <span className={overallClass}>{overallLabel}</span>
      </div>

      <ul className="check-list" aria-label="构图安全分项">
        {checks.map(({ label, result }) => (
          <li key={label}>
            <strong>{label}</strong>
            <span className={resultStatusClass(result)}>
              {resultStatusLabel[result.status]}
            </span>
            <span>
              置信度 {Math.round(result.confidence * 100)}%
              {result.approximate ? " · 近似" : ""}
              {!result.required ? " · 未配置目标" : ""}
            </span>
          </li>
        ))}
      </ul>

      {report.issues.length === 0 ? (
        <p className="check-empty">
          {report.overallStatus === "unchecked"
            ? "尚未配置需要验证的构图目标。"
            : "已配置的构图目标没有发现明确问题；近似项仍需目视确认。"}
        </p>
      ) : (
        <ul className="check-list" aria-label="构图问题">
          {report.issues.map((issue, index) => (
            <li
              key={`${issue.constraintId ?? issue.code}-${issue.occluderEntityId ?? issue.subjectEntityId ?? index}`}
            >
              <strong>{issueLabels[issue.code] ?? issue.code}</strong>
              <span>
                {issue.relatedEntityIds.join(" · ")}
                {issue.approximate ? " · 近似检测" : ""}
                {typeof issue.occlusionRatio === "number"
                  ? ` · ${Math.round(issue.occlusionRatio * 100)}%`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
