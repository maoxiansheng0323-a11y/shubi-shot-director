const localizedByCode: Readonly<Record<string, string>> = {
  NETWORK_ERROR: "无法连接本地 SceneSession，请确认运行页仍在启动",
  EVENT_STREAM_UNAVAILABLE: "浏览器无法建立本地场景同步通道",
  EVENT_STREAM_INTERRUPTED: "场景同步已中断，浏览器正在尝试重连",
  INVALID_EVENT: "本地场景同步消息无效",
  INVALID_RESPONSE: "本地 SceneSession 返回了无法读取的数据",
  REQUEST_ABORTED: "场景请求已取消",
  STALE_REVISION: "场景已被其他操作更新，请基于最新 revision 重试",
  SCENE_ID_MISMATCH: "这次修改属于另一个场景，未执行",
  ENTITY_LOCKED: "目标已锁定，未执行修改",
  ENTITY_NOT_FOUND: "目标元素不存在，请重新选择",
  SCHEMA_VALIDATION_FAILED: "提交内容不符合 SceneSpec / ScenePatch 结构",
  SURFACE_NOT_FOUND: "接触表面不存在，请重新选择",
  UNSUPPORTED_SURFACE: "该物体不能作为接触表面",
  SURFACE_NOT_HORIZONTAL: "接触表面必须保持水平",
  LOCKED_ENTITY_CONFLICT: "锁定人物无法移动到接触表面",
  SURFACE_UNSUPPORTED: "该表面不支持当前人物关系",
  ROLE_ACTOR_LOCKED: "关系中的人物已锁定",
  SCENE_FILE_TOO_LARGE: "场景文件超过 1 MiB 限制",
  SCENE_FILE_READ_FAILED: "无法读取所选场景文件",
  SCENE_FILE_INVALID_JSON: "所选文件不是有效 JSON",
  SCENE_FILE_INVALID: "所选文件不是有效 SceneSpec",
  SCENE_DOWNLOAD_UNAVAILABLE: "当前浏览器无法保存场景文件",
  BROWSER_DOWNLOAD_FAILED: "浏览器未能完成文件下载",
};

const errorCode = (error: unknown): string | null =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : null;

export const userFacingError = (
  error: unknown,
  fallback = "场景操作未完成，请检查当前状态后重试",
): string => {
  const code = errorCode(error);
  const localized = code ? localizedByCode[code] : undefined;
  const message =
    localized ??
    (error instanceof Error && error.message.trim().length > 0
      ? error.message
      : fallback);
  return code ? `${message} · ${code}` : message;
};
