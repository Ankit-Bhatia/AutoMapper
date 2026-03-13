import type { ProjectHistoryItem } from '@contracts';

interface ProjectHistoryPanelProps {
  projects: ProjectHistoryItem[];
  loading: boolean;
  error?: string | null;
  activeProjectId?: string | null;
  onRefresh: () => void;
  onOpenReview: (projectId: string) => void;
  onOpenExport: (projectId: string) => void;
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function ProjectHistoryPanel({
  projects,
  loading,
  error,
  activeProjectId,
  onRefresh,
  onOpenReview,
  onOpenExport,
}: ProjectHistoryPanelProps) {
  return (
    <section className="history-panel">
      <header className="history-panel-header">
        <div>
          <h3 className="history-panel-title">Past Projects</h3>
          <p className="history-panel-subtitle">Reopen mapped projects without rerunning the pipeline.</p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={onRefresh}>
          Refresh
        </button>
      </header>

      {loading && <p className="history-panel-state">Loading projects…</p>}
      {!loading && error && <p className="history-panel-state history-panel-state--error">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <p className="history-panel-state">No prior projects found for this user yet.</p>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="history-list" role="list" aria-label="Past projects">
          {projects.map((item) => {
            const sourceName = item.sourceSystem?.name ?? 'Unknown source';
            const targetName = item.targetSystem?.name ?? 'Unknown target';
            const isActive = activeProjectId === item.project.id;
            return (
              <article
                key={item.project.id}
                role="listitem"
                className={`history-card ${isActive ? 'is-active' : ''}`}
              >
                <div className="history-card-title-row">
                  <h4 className="history-card-title">{item.project.name}</h4>
                  <span className="history-card-updated">{formatDate(item.project.updatedAt)}</span>
                </div>
                <p className="history-card-route">{sourceName} → {targetName}</p>
                <div className="history-card-metrics">
                  <span>{item.fieldMappingCount} mappings</span>
                  <span>{item.unresolvedConflicts} unresolved conflicts</span>
                  <span>{item.canExport ? 'Export ready' : 'Needs review'}</span>
                </div>
                <div className="history-card-actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => onOpenReview(item.project.id)}
                  >
                    Open Review
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => onOpenExport(item.project.id)}
                  >
                    Open Export
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
