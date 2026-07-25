export const compactWorkspacePanes = [
  {
    id: "scene",
    label: "场景",
    controls: "compact-scene-panel",
  },
  {
    id: "editor",
    label: "编辑",
    controls: "compact-editor-panel",
  },
  {
    id: "shot",
    label: "镜头",
    controls: "compact-shot-panel",
  },
  {
    id: "inspector",
    label: "属性",
    controls: "compact-inspector-panel",
  },
] as const;

export type CompactWorkspacePane =
  (typeof compactWorkspacePanes)[number]["id"];

export const isCompactViewportPane = (
  pane: CompactWorkspacePane,
): pane is "editor" | "shot" => pane === "editor" || pane === "shot";

export const paneAfterSceneSelection = (): CompactWorkspacePane =>
  "inspector";
