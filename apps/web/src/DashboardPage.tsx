import { useMemo, useState } from 'react';
import type { ProjectHistoryItem } from '@contracts';

interface DashboardPageProps {
  projects: ProjectHistoryItem[];
  loading: boolean;
  error?: string | null;
  activeProjectId?: string | null;
  onRefresh: () => void;
  onOpen: (projectId: string) => void;
  onDuplicate: (projectId: string) => Promise<void> | void;
  onArchive: (projectId: string, archived: boolean) => Promise<void> | void;
  onRename: (projectId: string, name: string) => Promise<void> | void;
  onNewProject: () => void;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  const deltaMs = timestamp - Date.now();
  const absMs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['week', 1000 * 60 * 60 * 24 * 7],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
  ];

  for (const [unit, size] of steps) {
    if (absMs >= size || unit === 'minute') {
      return rtf.format(Math.round(deltaMs / size), unit);
    }
  }

  return 'just now';
}

function coveragePercent(project: ProjectHistoryItem): number {
  const total = project.coverage.total;
  if (total <= 0) return 0;
  return Math.round((project.coverage.mapped / total) * 100);
}

function coverageTone(percent: number): 'good' | 'warn' | 'bad' {
  if (percent >= 80) return 'good';
  if (percent >= 50) return 'warn';
  return 'bad';
}

function exportStatus(project: ProjectHistoryItem): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (project.canExport) {
    return { label: 'Ready to Export', tone: 'good' };
  }
  if (project.coverage.mapped > 0 || project.openConflicts > 0 || (project.unresolvedRoutingDecisions ?? 0) > 0) {
    return { label: 'Has Warnings', tone: 'warn' };
  }
  return { label: 'Incomplete', tone: 'bad' };
}

function connectorLabel(project: ProjectHistoryItem, side: 'source' | 'target'): string {
  if (side === 'source') {
    return project.sourceConnectorName ?? project.sourceSystem?.name ?? project.project.sourceSystemId;
  }
  return project.targetConnectorName ?? project.targetSystem?.name ?? project.project.targetSystemId;
}

export function DashboardPage({
  projects,
  loading,
  error,
  activeProjectId,
  onRefresh,
  onOpen,
  onDuplicate,
  onArchive,
  onRename,
  onNewProject,
}: DashboardPageProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  const activeProjects = useMemo(
    () => projects.filter((project) => !(project.project.archived ?? false)),
    [projects],
  );

  const visibleProjects = useMemo(
    () => (showArchived ? projects : activeProjects),
    [activeProjects, projects, showArchived],
  );

  const summary = useMemo(() => {
    const mapped = activeProjects.reduce((sum, project) => sum + project.coverage.mapped, 0);
    const total = activeProjects.reduce((sum, project) => sum + project.coverage.total, 0);
    const exportReady = activeProjects.filter((project) => project.canExport).length;
    const openConflicts = activeProjects.reduce((sum, project) => sum + project.openConflicts, 0);
    return {
      mapped,
      total,
      exportReady,
      openConflicts,
      activeProjects: activeProjects.length,
    };
  }, [activeProjects]);

  async function handleRename(projectId: string) {
    const nextName = draftNames[projectId]?.trim();
    const current = projects.find((project) => project.project.id === projectId)?.project.name ?? '';
    if (!nextName || nextName === current) {
      setEditingProjectId(null);
      setDraftNames((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      return;
    }

    setBusyProjectId(projectId);
    setActionError(null);
    try {
      await onRename(projectId, nextName);
      setEditingProjectId(null);
      setDraftNames((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not rename project');
    } finally {
      setBusyProjectId((currentBusy) => (currentBusy === projectId ? null : currentBusy));
    }
  }

  async function handleProjectAction(
    projectId: string,
    action: () => Promise<void> | void,
    fallbackMessage: string,
  ) {
    setBusyProjectId(projectId);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      setBusyProjectId((currentBusy) => (currentBusy === projectId ? null : currentBusy));
    }
  }

  return (
    <section className="dashboard-page">
      <header className="dashboard-hero">
        <div>
          <p className="dashboard-eyebrow">Portfolio</p>
          <h1 className="dashboard-title">Migration Dashboard</h1>
          <p className="dashboard-subtitle">
            Reopen active projects, duplicate working baselines, and monitor portfolio-wide export readiness.
          </p>
        </div>
        <div className="dashboard-hero-actions">
          <label className="dashboard-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            <span>Show archived</span>
          </label>
          <button type="button" className="btn btn--secondary" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={onNewProject}>
            New Project
          </button>
        </div>
      </header>

      <div className="dashboard-summary-bar" role="list" aria-label="Portfolio summary">
        <article className="dashboard-summary-card" role="listitem">
          <span className="dashboard-summary-label">Fields mapped</span>
          <strong className="dashboard-summary-value">{summary.mapped} / {summary.total}</strong>
        </article>
        <article className="dashboard-summary-card" role="listitem">
          <span className="dashboard-summary-label">Export-ready</span>
          <strong className="dashboard-summary-value">{summary.exportReady}</strong>
        </article>
        <article className="dashboard-summary-card" role="listitem">
          <span className="dashboard-summary-label">Open conflicts</span>
          <strong className="dashboard-summary-value">{summary.openConflicts}</strong>
        </article>
        <article className="dashboard-summary-card" role="listitem">
          <span className="dashboard-summary-label">Active projects</span>
          <strong className="dashboard-summary-value">{summary.activeProjects}</strong>
        </article>
      </div>

      {error && <p className="dashboard-state dashboard-state--error">{error}</p>}
      {actionError && <p className="dashboard-state dashboard-state--error">{actionError}</p>}
      {loading && <p className="dashboard-state">Loading projects…</p>}

      {!loading && activeProjects.length === 0 && !showArchived && (
        <div className="dashboard-empty-state">
          <p className="dashboard-empty-title">No projects yet</p>
          <p className="dashboard-empty-copy">Start a new migration to populate your dashboard.</p>
          <button type="button" className="btn btn--primary" onClick={onNewProject}>
            Start New Migration
          </button>
        </div>
      )}

      {!loading && visibleProjects.length > 0 && (
        <div className="dashboard-grid" role="list" aria-label="Projects dashboard">
          {visibleProjects.map((project) => {
            const projectId = project.project.id;
            const percent = coveragePercent(project);
            const tone = coverageTone(percent);
            const exportPill = exportStatus(project);
            const isArchived = project.project.archived ?? false;
            const isActive = activeProjectId === projectId;
            const isBusy = busyProjectId === projectId;
            const draftName = draftNames[projectId] ?? project.project.name;

            return (
              <article
                key={projectId}
                role="listitem"
                className={[
                  'dashboard-card',
                  `is-${tone}`,
                  isArchived ? 'is-archived' : '',
                  isActive ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="dashboard-card-header">
                  <div className="dashboard-card-name-group">
                    {editingProjectId === projectId ? (
                      <input
                        autoFocus
                        className="dashboard-project-name-input"
                        value={draftName}
                        onChange={(event) => setDraftNames((prev) => ({ ...prev, [projectId]: event.target.value }))}
                        onBlur={() => { void handleRename(projectId); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleRename(projectId);
                          }
                          if (event.key === 'Escape') {
                            setEditingProjectId(null);
                            setDraftNames((prev) => {
                              const next = { ...prev };
                              delete next[projectId];
                              return next;
                            });
                          }
                        }}
                      />
                    ) : (
                      <>
                        <h2 className="dashboard-card-title">{project.project.name}</h2>
                        <button
                          type="button"
                          className="dashboard-inline-edit"
                          onClick={() => {
                            setEditingProjectId(projectId);
                            setDraftNames((prev) => ({ ...prev, [projectId]: project.project.name }));
                          }}
                        >
                          Rename
                        </button>
                      </>
                    )}
                  </div>
                  <span className={`dashboard-status-pill is-${exportPill.tone}`}>
                    {exportPill.label}
                  </span>
                </div>

                <div className="dashboard-connector-row">
                  <span className="dashboard-connector-badge">{connectorLabel(project, 'source')}</span>
                  <span className="dashboard-connector-arrow">→</span>
                  <span className="dashboard-connector-badge">{connectorLabel(project, 'target')}</span>
                </div>

                <div className="dashboard-coverage-block">
                  <div className="dashboard-coverage-copy">
                    <span>Coverage</span>
                    <strong>{project.coverage.mapped} / {project.coverage.total} fields</strong>
                  </div>
                  <div className="dashboard-coverage-track" aria-label={`Coverage ${percent}%`}>
                    <span className={`dashboard-coverage-fill is-${tone}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>

                <div className="dashboard-card-metrics">
                  <span>{project.openConflicts} open conflicts</span>
                  <span>{formatRelativeTime(project.project.updatedAt)}</span>
                </div>

                <div className="dashboard-card-actions">
                  <button type="button" className="btn btn--secondary" onClick={() => onOpen(projectId)} disabled={isBusy}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => { void handleProjectAction(projectId, () => onDuplicate(projectId), 'Could not duplicate project'); }}
                    disabled={isBusy}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      void handleProjectAction(
                        projectId,
                        () => onArchive(projectId, !isArchived),
                        'Could not update archive state',
                      );
                    }}
                    disabled={isBusy}
                  >
                    {isArchived ? 'Restore' : 'Archive'}
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
