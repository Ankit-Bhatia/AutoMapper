import React from 'react';
import { WorkflowStep } from '@contracts';

interface SidebarProps {
  currentStep: WorkflowStep;
  onStepClick: (step: WorkflowStep) => void;
  onReset?: () => void;
  projectName?: string;
  sourceConnector?: string;
  targetConnector?: string;
  sourceSchemaMode?: 'live' | 'mock' | 'uploaded';
  targetSchemaMode?: 'live' | 'mock' | 'uploaded';
  mappingCount?: number;
  isOrchestrated?: boolean;
  isDemoMode?: boolean;
}

const STEPS: { id: WorkflowStep; label: string; icon: string; description: string }[] = [
  { id: 'connect',     label: 'Connect',     icon: '⬡', description: 'Choose source & target systems' },
  { id: 'orchestrate', label: 'Orchestrate', icon: '◈', description: 'Run AI mapping pipeline' },
  { id: 'review',      label: 'Review',      icon: '◻', description: 'Inspect & refine mappings' },
  { id: 'export',      label: 'Export',      icon: '◤', description: 'Download integration spec' },
];

function AutoMapperLogomark({ size = 28, className = 'sidebar-logo-svg' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className} aria-hidden>
      <path
        d="M14 2L25 8.5v11L14 26 3 19.5v-11L14 2z"
        stroke="var(--primary)"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="8" y1="10" x2="20" y2="18" stroke="var(--primary)" strokeWidth="1.2" opacity="0.7" />
      <line x1="8" y1="18" x2="20" y2="10" stroke="var(--primary)" strokeWidth="1.2" opacity="0.4" />
      <circle cx="8" cy="10" r="1.5" fill="var(--primary)" />
      <circle cx="20" cy="10" r="1.5" fill="var(--primary)" opacity="0.7" />
      <circle cx="8" cy="18" r="1.5" fill="var(--primary)" opacity="0.7" />
      <circle cx="20" cy="18" r="1.5" fill="var(--primary)" />
    </svg>
  );
}

function stepStatus(
  step: WorkflowStep,
  current: WorkflowStep,
): 'done' | 'active' | 'disabled' {
  const order: WorkflowStep[] = ['connect', 'orchestrate', 'review', 'export'];
  const ci = order.indexOf(current);
  const si = order.indexOf(step);
  if (si < ci) return 'done';
  if (si === ci) return 'active';
  return 'disabled';
}

export function Sidebar({
  currentStep,
  onStepClick,
  onReset,
  projectName,
  sourceConnector,
  targetConnector,
  sourceSchemaMode,
  targetSchemaMode,
  mappingCount = 0,
  isOrchestrated = false,
  isDemoMode = true,
}: SidebarProps) {
  const order: WorkflowStep[] = ['connect', 'orchestrate', 'review', 'export'];

  function isClickable(step: WorkflowStep): boolean {
    const ci = order.indexOf(currentStep);
    const si = order.indexOf(step);
    if (si <= ci) return true;
    if (step === 'orchestrate') return !!(sourceConnector && targetConnector);
    if (step === 'review' || step === 'export') return isOrchestrated;
    return false;
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <AutoMapperLogomark />
        <span className="sidebar-logo-text">AutoMapper</span>
      </div>

      {/* Project summary (shown once source+target chosen) */}
      {sourceConnector && targetConnector ? (
        <div className="sidebar-project-card">
          <div className="sidebar-project-label">Current project</div>
          <div className="sidebar-project-name">{projectName || 'Integration'}</div>
          <div className="sidebar-project-route">
            <span className="sidebar-connector-pill">{sourceConnector}</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="sidebar-connector-pill">{targetConnector}</span>
          </div>
          {(sourceSchemaMode || targetSchemaMode) && (
            <div className="sidebar-mode-row">
              <div className={`sidebar-mode-badge ${sourceSchemaMode === 'live' ? 'is-live' : sourceSchemaMode === 'uploaded' ? 'is-uploaded' : 'is-mock'}`}>
                Source: {sourceSchemaMode ?? 'unknown'}
              </div>
              <div className={`sidebar-mode-badge ${targetSchemaMode === 'live' ? 'is-live' : targetSchemaMode === 'uploaded' ? 'is-uploaded' : 'is-mock'}`}>
                Target: {targetSchemaMode ?? 'unknown'}
              </div>
            </div>
          )}
          {isOrchestrated && (
            <div className="sidebar-mapping-stat">
              <span className="sidebar-mapping-dot" />
              {mappingCount} field{mappingCount !== 1 ? 's' : ''} mapped
            </div>
          )}
          {/* Change connectors button */}
          {onReset && (
            <button
              className="sidebar-reset-btn"
              onClick={onReset}
              title="Start over with different source/target connectors"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                <path d="M1 6a5 5 0 1 0 1-3M1 1v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Change connectors
            </button>
          )}
        </div>
      ) : (
        <div className="sidebar-project-card" style={{ opacity: 0.55 }}>
          <div className="sidebar-project-label">No project yet</div>
          <div className="sidebar-project-name" style={{ fontSize: '12px', fontWeight: 400, color: 'var(--text-secondary)' }}>
            Select source &amp; target to begin
          </div>
        </div>
      )}

      {/* Workflow steps */}
      <nav className="sidebar-nav">
        {STEPS.map((step, i) => {
          const st = stepStatus(step.id, currentStep);
          const clickable = isClickable(step.id);
          return (
            <button
              key={step.id}
              className={`sidebar-nav-item ${st === 'active' ? 'active' : ''} ${st === 'done' ? 'done' : ''} ${st === 'disabled' ? 'disabled' : ''}`}
              onClick={() => clickable && onStepClick(step.id)}
              disabled={!clickable}
              title={step.description}
            >
              <span className="nav-step-number">{st === 'done' ? '✓' : i + 1}</span>
              <span className="nav-step-text">
                <span className="nav-step-label">{step.label}</span>
                <span className="nav-step-desc">{step.description}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`sidebar-status-strip ${isDemoMode ? 'is-demo' : 'is-live'}`}>
        <span className="sidebar-status-dot" />
        {isDemoMode ? 'Demo' : 'Live'}
        <span className="sidebar-status-version">v2.0</span>
      </div>
    </aside>
  );
}
