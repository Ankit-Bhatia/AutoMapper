import React from 'react';
import { WorkflowStep } from '@contracts';

interface SidebarProps {
  currentStep: WorkflowStep;
  workflowStep?: Exclude<WorkflowStep, 'llm-settings'>;
  onStepClick: (step: WorkflowStep) => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  onReset?: () => void;
  userName?: string;
  userRole?: string;
  projectName?: string;
  sourceConnector?: string;
  targetConnector?: string;
  sourceSchemaMode?: 'live' | 'mock' | 'uploaded';
  targetSchemaMode?: 'live' | 'mock' | 'uploaded';
  mappingCount?: number;
  unresolvedRoutingDecisions?: number;
  isOrchestrated?: boolean;
  isDemoMode?: boolean;
}

const STEPS: { id: Exclude<WorkflowStep, 'llm-settings'>; label: string; icon: string; description: string }[] = [
  { id: 'command-center', label: 'Command Center', icon: '◉', description: 'Projects, telemetry, and launchpad' },
  { id: 'connect', label: 'Connect', icon: '⬡', description: 'Choose source & target systems' },
  { id: 'orchestrate', label: 'Orchestrate', icon: '◈', description: 'Run AI mapping pipeline' },
  { id: 'review', label: 'Review', icon: '◻', description: 'Inspect & refine mappings' },
  { id: 'routing', label: 'Routing', icon: '↳', description: 'Resolve one-to-many field routes' },
  { id: 'export', label: 'Export', icon: '◤', description: 'Download integration spec' },
];

function isAdminRole(role?: string): boolean {
  const normalized = (role ?? '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'OWNER';
}

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
  step: Exclude<WorkflowStep, 'llm-settings'>,
  current: Exclude<WorkflowStep, 'llm-settings'>,
): 'done' | 'active' | 'disabled' {
  const order: Array<Exclude<WorkflowStep, 'llm-settings'>> = ['command-center', 'connect', 'orchestrate', 'review', 'routing', 'export'];
  const ci = order.indexOf(current);
  const si = order.indexOf(step);
  if (si < ci) return 'done';
  if (si === ci) return 'active';
  return 'disabled';
}

export function Sidebar({
  currentStep,
  workflowStep = 'command-center',
  onStepClick,
  theme,
  onThemeChange,
  onReset,
  userName,
  userRole,
  projectName,
  sourceConnector,
  targetConnector,
  sourceSchemaMode,
  targetSchemaMode,
  mappingCount = 0,
  unresolvedRoutingDecisions = 0,
  isOrchestrated = false,
  isDemoMode = true,
}: SidebarProps) {
  const order: Array<Exclude<WorkflowStep, 'llm-settings'>> = ['command-center', 'connect', 'orchestrate', 'review', 'routing', 'export'];
  const workflowCurrentStep = currentStep === 'llm-settings' ? workflowStep : currentStep;
  const adminPersona = isAdminRole(userRole);
  const personaLabel = adminPersona ? 'Admin persona' : 'Normal user';
  const personaDetail = adminPersona
    ? 'Controls global LLM policy and product settings.'
    : 'Runs mappings with organization defaults.';

  function isClickable(step: Exclude<WorkflowStep, 'llm-settings'>): boolean {
    if (step === 'command-center' || step === 'connect') return true;
    const ci = order.indexOf(workflowCurrentStep);
    const si = order.indexOf(step);
    if (si <= ci) return true;
    if (step === 'orchestrate') return !!(projectName && sourceConnector && targetConnector);
    if (step === 'review') return isOrchestrated;
    if (step === 'routing') return isOrchestrated;
    if (step === 'export') return isOrchestrated && unresolvedRoutingDecisions === 0;
    return false;
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <AutoMapperLogomark />
        <span className="sidebar-logo-text">AutoMapper</span>
      </div>

      <div className="sidebar-user-card">
        <div className="sidebar-user-heading">
          <div className="sidebar-user-meta">
            <div className="sidebar-user-label">Signed in</div>
            <div className="sidebar-user-name">{userName || 'Workspace user'}</div>
          </div>
          <span className={`sidebar-persona-badge ${adminPersona ? 'is-admin' : 'is-user'}`}>
            {personaLabel}
          </span>
        </div>
        <div className="sidebar-user-detail">
          <span>{userRole || 'Unknown role'}</span>
          <span>{personaDetail}</span>
        </div>
        <button
          type="button"
          className={`sidebar-utility-btn ${currentStep === 'llm-settings' ? 'active' : ''}`}
          onClick={() => onStepClick('llm-settings')}
        >
          <span className="sidebar-utility-icon">⌘</span>
          <span className="sidebar-utility-copy">
            <span className="sidebar-utility-title">LLM / API Settings</span>
            <span className="sidebar-utility-subtitle">
              {adminPersona ? 'Admin controls and usage telemetry' : 'View current access and policy'}
            </span>
          </span>
        </button>
        <div className="sidebar-theme-block">
          <div className="sidebar-theme-header">
            <span className="sidebar-theme-title">Theme</span>
            <span className="sidebar-theme-meta">{theme === 'dark' ? 'Studio dark' : 'Workspace light'}</span>
          </div>
          <div className="sidebar-theme-switch" role="group" aria-label="Theme switch">
            <button
              type="button"
              className={`sidebar-theme-option ${theme === 'dark' ? 'active' : ''}`}
              aria-pressed={theme === 'dark'}
              onClick={() => onThemeChange('dark')}
            >
              Dark
            </button>
            <button
              type="button"
              className={`sidebar-theme-option ${theme === 'light' ? 'active' : ''}`}
              aria-pressed={theme === 'light'}
              onClick={() => onThemeChange('light')}
            >
              Light
            </button>
          </div>
        </div>
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
          const st = stepStatus(step.id, workflowCurrentStep);
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
