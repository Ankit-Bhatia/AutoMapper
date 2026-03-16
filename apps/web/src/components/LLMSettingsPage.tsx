import { AdminControlPanel } from './AdminControlPanel';
import { LLMSettingsPanel, type LLMConfigUpdatePayload } from './LLMSettingsPanel';
import { UserPersonaPanel } from './UserPersonaPanel';
import type { LLMConfigResponse, LLMUsageResponse, ProjectHistoryItem } from '@contracts';

interface LLMSettingsPageProps {
  isAdmin: boolean;
  userName?: string;
  projects: ProjectHistoryItem[];
  llmConfig: LLMConfigResponse | null;
  llmUsage: LLMUsageResponse | null;
  llmLoading: boolean;
  llmSaving: boolean;
  llmError: string | null;
  onRefresh: () => void;
  onSave: (payload: LLMConfigUpdatePayload) => Promise<void>;
  onBack?: () => void;
}

function formatProviderLabel(config: LLMConfigResponse | null): string {
  if (!config) return 'Unconfigured';
  if (config.config.mode === 'default') return 'AutoMapper default';
  return config.effectiveProvider.toUpperCase();
}

export function LLMSettingsPage({
  isAdmin,
  userName,
  projects,
  llmConfig,
  llmUsage,
  llmLoading,
  llmSaving,
  llmError,
  onRefresh,
  onSave,
  onBack,
}: LLMSettingsPageProps) {
  const summary = llmUsage?.summary;
  const modeLabel = llmConfig?.config.mode === 'byol' ? 'BYOL active' : 'Default brain';
  const providerLabel = formatProviderLabel(llmConfig);
  const callCount = summary?.totalCalls ?? 0;
  const tokenCount = summary?.totalTokens ?? 0;
  const failureCount = summary?.failedCalls ?? 0;
  const projectCount = projects.length;

  return (
    <div className="llm-page">
      <div className="llm-page-topbar">
        <div className="llm-page-breadcrumb">
          <span>AutoMapper</span>
          <span className="llm-page-breadcrumb-sep">/</span>
          <span>Settings</span>
          <span className="llm-page-breadcrumb-sep">/</span>
          <span className="llm-page-breadcrumb-current">LLM / API Settings</span>
        </div>
        {onBack && (
          <button type="button" className="cc-btn-ghost" onClick={onBack}>
            Back to Studio
          </button>
        )}
      </div>

      <section className="llm-hero">
        <div className="llm-hero-copy">
          <div className="llm-hero-label">Global LLM Controls</div>
          <h1 className="llm-hero-title">LLM / API Settings</h1>
          <p className="llm-hero-subtitle">
            Control provider routing, BYOL posture, usage telemetry, and persona-specific access from one page.
            {userName ? ` Signed in as ${userName}.` : ''}
          </p>
        </div>
        <div className="llm-hero-statuses">
          <span className="cc-tag cc-tag-cyan">{modeLabel}</span>
          <span className="cc-tag cc-tag-green">{providerLabel}</span>
          <span className={`cc-tag ${failureCount > 0 ? 'cc-tag-amber' : 'cc-tag-cyan'}`}>
            {failureCount > 0 ? `${failureCount} failures` : 'Healthy'}
          </span>
        </div>
      </section>

      <section className="llm-stat-grid">
        <article className="llm-stat-card">
          <div className="llm-stat-label">Effective provider</div>
          <div className="llm-stat-value">{providerLabel}</div>
          <div className="llm-stat-meta">Mode: {llmConfig?.config.mode === 'byol' ? 'Bring your own LLM' : 'AutoMapper managed'}</div>
        </article>
        <article className="llm-stat-card">
          <div className="llm-stat-label">Calls in last 24 hours</div>
          <div className="llm-stat-value">{callCount}</div>
          <div className="llm-stat-meta">Across {projectCount} project{projectCount === 1 ? '' : 's'}</div>
        </article>
        <article className="llm-stat-card">
          <div className="llm-stat-label">Tokens consumed</div>
          <div className="llm-stat-value">{tokenCount.toLocaleString()}</div>
          <div className="llm-stat-meta">Usage window: {summary?.windowHours ?? 24}h rolling</div>
        </article>
        <article className="llm-stat-card">
          <div className="llm-stat-label">Failure signal</div>
          <div className="llm-stat-value">{failureCount}</div>
          <div className="llm-stat-meta">Surface provider or network issues before demos</div>
        </article>
      </section>

      <div className={`llm-page-grid ${isAdmin ? 'is-admin' : 'is-user'}`}>
        <LLMSettingsPanel
          config={llmConfig}
          usage={llmUsage}
          loading={llmLoading}
          saving={llmSaving}
          error={llmError}
          onRefresh={onRefresh}
          onSave={onSave}
        />

        <div className="llm-side-stack">
          {isAdmin ? (
            <>
              <AdminControlPanel userName={userName} projects={projects} llmUsage={llmUsage} />
              <section className="llm-policy-card">
                <div className="llm-policy-title">Admin notes</div>
                <ul className="llm-policy-list">
                  <li>Default mode keeps the demo path stable when BYOL is paused.</li>
                  <li>Use BYOL only when you want provider-specific output or governance traceability.</li>
                  <li>Watch failure counts and recent events before switching providers during a live session.</li>
                </ul>
              </section>
            </>
          ) : (
            <>
              <UserPersonaPanel userName={userName} />
              <section className="llm-policy-card">
                <div className="llm-policy-title">Current access</div>
                <ul className="llm-policy-list">
                  <li>You can inspect the active provider and recent usage summary.</li>
                  <li>Provider mode, key rotation, and global pause stay restricted to admins.</li>
                  <li>Ask an admin before switching the workspace off the default LLM path.</li>
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
