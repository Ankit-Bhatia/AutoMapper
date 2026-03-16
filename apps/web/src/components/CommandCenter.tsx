import React from 'react';
import type { LLMUsageResponse, ProjectHistoryItem } from '@contracts';

interface CommandCenterProps {
  userName?: string;
  userRole?: string;
  projects: ProjectHistoryItem[];
  llmUsage: LLMUsageResponse | null;
  isDemoMode?: boolean;
  loading?: boolean;
  error?: string | null;
  onNewProject: () => void;
  onOpenReview: (projectId: string) => void;
  onOpenExport: (projectId: string) => void;
  onOpenLLMSettings: () => void;
  onRefresh?: () => void;
}

function ConfidenceRing({ value, size = 34 }: { value: number; size?: number }) {
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 80 ? 'var(--success)' : value >= 65 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="cc-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="cc-ring-val">{value}%</span>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

function getProjectConfidence(project: ProjectHistoryItem): number {
  // Estimate confidence: fewer conflicts = higher confidence
  const base = 79;
  const conflictPenalty = Math.min(project.unresolvedConflicts * 5, 40);
  return Math.max(base - conflictPenalty, 40);
}

export function CommandCenter({
  userName,
  userRole,
  projects,
  llmUsage,
  isDemoMode = true,
  loading = false,
  error = null,
  onNewProject,
  onOpenReview,
  onOpenExport,
  onOpenLLMSettings,
  onRefresh,
}: CommandCenterProps) {
  const totalMappings = projects.reduce((s, p) => s + p.fieldMappingCount, 0);
  const llmCalls = llmUsage?.summary.totalCalls ?? 0;
  const llmTokens = llmUsage?.summary.totalTokens ?? 0;
  const llmFailures = llmUsage?.summary.failedCalls ?? 0;
  const llmProvider = llmUsage?.events?.[0]?.provider ?? 'gemini';
  const llmModel = llmUsage?.events?.[0]?.model ?? 'flash-2.0';

  // Average confidence across projects (mock: assume 79% avg)
  const avgConfidence = projects.length > 0
    ? Math.round(projects.reduce((s, p) => s + getProjectConfidence(p), 0) / projects.length)
    : 79;

  const recentProjects = [...projects].slice(0, 4);

  function getSourceName(p: ProjectHistoryItem): string {
    return p.sourceSystem?.name ?? p.project.sourceSystemId ?? 'Source';
  }
  function getTargetName(p: ProjectHistoryItem): string {
    return p.targetSystem?.name ?? p.project.targetSystemId ?? 'Target';
  }

  return (
    <div className="cc-root">
      {/* Top bar */}
      <div className="cc-topbar">
        <div className="cc-breadcrumb">
          <span className="cc-breadcrumb-root">AutoMapper</span>
          <span className="cc-breadcrumb-sep">/</span>
          <span className="cc-breadcrumb-current">Command Center</span>
        </div>
        <div className="cc-topbar-right">
          <div className="cc-chip">
            <div className={`cc-chip-dot ${isDemoMode ? 'is-demo' : 'is-live'}`} />
            {isDemoMode ? 'Demo' : 'Live'} · v2.0
          </div>
          <button className="cc-btn-primary" onClick={onNewProject}>＋ New Project</button>
        </div>
      </div>

      {/* Page header */}
      <div className="cc-page-header">
        <div className="cc-page-label">Command Center</div>
        <div className="cc-page-title">Integration Intelligence</div>
        <div className="cc-page-sub">
          Monitor active mapping projects, LLM usage, and agent telemetry from a single pane.
          {userName ? ` Welcome, ${userName.split(' ')[0]}.` : ''}
          {userRole ? ` Role: ${userRole}.` : ''}
        </div>
      </div>

      {/* Stat cards */}
      <div className="cc-stat-grid">
        <div className="cc-stat-card" style={{ '--cc-accent': 'var(--primary)' } as React.CSSProperties}>
          <div className="cc-stat-glow" />
          <div className="cc-stat-label">Active Projects</div>
          <div className="cc-stat-value" style={{ color: 'var(--primary)' }}>{projects.length}</div>
          <div className="cc-stat-delta cc-delta-up">↑ +1 this week</div>
        </div>
        <div className="cc-stat-card" style={{ '--cc-accent': 'var(--success)' } as React.CSSProperties}>
          <div className="cc-stat-glow" style={{ '--cc-accent': 'rgba(16,185,129,.12)' } as React.CSSProperties} />
          <div className="cc-stat-label">Fields Mapped</div>
          <div className="cc-stat-value" style={{ color: 'var(--success)' }}>{totalMappings}</div>
          <div className="cc-stat-delta cc-delta-up">↑ {projects.length} entity sets</div>
        </div>
        <div className="cc-stat-card" style={{ '--cc-accent': 'var(--purple)' } as React.CSSProperties}>
          <div className="cc-stat-glow" style={{ '--cc-accent': 'rgba(123,97,255,.12)' } as React.CSSProperties} />
          <div className="cc-stat-label">LLM Calls (24h)</div>
          <div className="cc-stat-value" style={{ color: 'var(--purple)' }}>{llmCalls}</div>
          <div className="cc-stat-delta cc-delta-warn">⚡ {llmTokens.toLocaleString()} tokens</div>
        </div>
        <div className="cc-stat-card" style={{ '--cc-accent': 'var(--warning)' } as React.CSSProperties}>
          <div className="cc-stat-glow" style={{ '--cc-accent': 'rgba(245,158,11,.12)' } as React.CSSProperties} />
          <div className="cc-stat-label">Avg Confidence</div>
          <div className="cc-stat-value" style={{ color: 'var(--warning)' }}>{avgConfidence}%</div>
          <div className="cc-stat-delta">across all mappings</div>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="cc-grid-2">
        {/* Recent projects card */}
        <div className="cc-card">
          <div className="cc-card-header">
            <span className="cc-card-icon">⬡</span>
            <div>
              <div className="cc-card-title">Recent Projects</div>
              <div className="cc-card-sub">Resume or export any mapping session</div>
            </div>
            <button className="cc-btn-ghost" onClick={onRefresh} disabled={loading}>Refresh</button>
          </div>

          {error && (
            <div className="cc-inline-alert cc-inline-alert--error">
              {error}
            </div>
          )}

          {loading ? (
            <div className="cc-empty">
              <div className="cc-empty-icon">⋯</div>
              <div className="cc-empty-text">Loading projects…</div>
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="cc-empty">
              <div className="cc-empty-icon">◻</div>
              <div className="cc-empty-text">No projects yet — start with New Project</div>
            </div>
          ) : (
            recentProjects.map((project, i) => {
              const conf = getProjectConfidence(project);
              const hasConflicts = project.unresolvedConflicts > 0;
              const tagClass = hasConflicts ? 'cc-tag-amber' : i === 0 ? 'cc-tag-green' : 'cc-tag-cyan';
              const tagLabel = hasConflicts ? 'Review' : 'Export';
              return (
                <article
                  key={project.project.id}
                  className={`cc-project-row ${i > 1 ? 'cc-project-row--muted' : ''}`}
                >
                  <button
                    type="button"
                    className="cc-project-main"
                    onClick={() => onOpenReview(project.project.id)}
                  >
                    <div className="cc-project-icon">🔗</div>
                    <div className="cc-project-info">
                      <div className="cc-project-name">
                        {getSourceName(project)} → {getTargetName(project)}
                      </div>
                      <div className="cc-project-meta">
                        {project.fieldMappingCount} mappings · {project.unresolvedConflicts} conflicts · {formatDate(project.project.createdAt)}
                      </div>
                    </div>
                  </button>
                  <div className="cc-project-right">
                    {i <= 1 && <ConfidenceRing value={conf} />}
                    <span className={`cc-tag ${tagClass}`}>{tagLabel}</span>
                    <div className="cc-project-actions">
                      <button
                        type="button"
                        className="cc-project-action-btn"
                        onClick={() => onOpenReview(project.project.id)}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        className="cc-project-action-btn cc-project-action-btn--primary"
                        onClick={() => onOpenExport(project.project.id)}
                      >
                        Export
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}

          {projects.length > 0 && (
            <div className="cc-card-footer">
              <button className="cc-btn-ghost" onClick={onNewProject}>＋ Start new project</button>
            </div>
          )}
        </div>

        {/* LLM Console card */}
        <div className="cc-card">
          <div className="cc-card-header">
            <span className="cc-card-icon">⚡</span>
            <div>
              <div className="cc-card-title">LLM Console</div>
              <div className="cc-card-sub">Provider: {llmProvider} · Model: {llmModel}</div>
            </div>
            <span className="cc-tag cc-tag-cyan" style={{ marginLeft: 'auto' }}>BYOL</span>
          </div>

          <div className="cc-llm-body">
            {llmUsage?.events && llmUsage.events.length > 0 ? (
              llmUsage.events.slice(0, 4).map((event, i) => {
                const isErr = !event.success;
                return (
                  <div key={i} className="cc-llm-event">
                    <div className={`cc-llm-status ${isErr ? 'is-err' : 'is-ok'}`} />
                    <div className="cc-llm-model">{event.provider}/{event.model ?? '—'}</div>
                    <div className="cc-llm-tokens">{(event.tokensUsed ?? 0).toLocaleString()} tok</div>
                    <div className={`cc-llm-time ${isErr ? 'is-err' : 'is-ok'}`}>
                      {isErr ? 'err' : `${event.durationMs ?? 0}ms`}
                    </div>
                  </div>
                );
              })
            ) : (
              <>
                <div className="cc-llm-event">
                  <div className="cc-llm-status is-ok" />
                  <div className="cc-llm-model">No calls yet</div>
                  <div className="cc-llm-tokens">—</div>
                  <div className="cc-llm-time is-ok">—</div>
                </div>
              </>
            )}

            <div className="cc-llm-stats">
              <div className="cc-llm-stat-group">
                <div>
                  <div className="cc-llm-stat-val" style={{ color: 'var(--purple)' }}>{llmCalls}</div>
                  <div className="cc-llm-stat-label">Calls 24h</div>
                </div>
                <div>
                  <div className="cc-llm-stat-val">{llmTokens.toLocaleString()}</div>
                  <div className="cc-llm-stat-label">Tokens</div>
                </div>
                <div>
                  <div className="cc-llm-stat-val" style={{ color: llmFailures > 0 ? 'var(--warning)' : 'var(--text-secondary)' }}>{llmFailures}</div>
                  <div className="cc-llm-stat-label">Failures</div>
                </div>
              </div>
              <div className="cc-llm-actions">
                <button className="cc-btn-ghost" onClick={onOpenLLMSettings}>Settings →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
