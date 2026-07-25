import {
  compactWorkspacePanes,
  type CompactWorkspacePane,
} from "./compact-workspace";

interface CompactWorkspaceTabsProps {
  activePane: CompactWorkspacePane;
  onChange: (pane: CompactWorkspacePane) => void;
}

export const CompactWorkspaceTabs = ({
  activePane,
  onChange,
}: CompactWorkspaceTabsProps) => (
  <nav
    className="workspace-tabs"
    aria-label="工作区面板"
    role="tablist"
  >
    {compactWorkspacePanes.map((pane) => (
      <button
        aria-controls={pane.controls}
        aria-selected={pane.id === activePane}
        className={
          pane.id === activePane
            ? "workspace-tab is-active"
            : "workspace-tab"
        }
        data-testid={`workspace-tab-${pane.id}`}
        key={pane.id}
        onClick={() => onChange(pane.id)}
        role="tab"
        type="button"
      >
        {pane.label}
      </button>
    ))}
  </nav>
);
