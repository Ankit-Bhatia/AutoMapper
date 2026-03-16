import { useState } from 'react';
import type { LLMUsageResponse, ProjectHistoryItem } from '@contracts';

interface AdminControlPanelProps {
  userName?: string;
  projects: ProjectHistoryItem[];
  llmUsage: LLMUsageResponse | null;
}

export function AdminControlPanel({ userName, projects, llmUsage }: AdminControlPanelProps) {
  const [tier, setTier] = useState<'free' | 'premium'>('free');
  const [llmControlsEnabled, setLlmControlsEnabled] = useState(true);
  const [usageMonitorEnabled, setUsageMonitorEnabled] = useState(true);

  const totalMappings = projects.reduce((sum, project) => sum + project.fieldMappingCount, 0);

  return (
    <section className="admin-panel">
      <header className="admin-panel-header">
        <div>
          <h3 className="admin-panel-title">Admin Console</h3>
          <p className="admin-panel-subtitle">
            {userName ? `${userName} controls product policy, LLM usage, and plan gating.` : 'Admin controls product policy, LLM usage, and plan gating.'}
          </p>
        </div>
        <span className="admin-badge">Admin persona</span>
      </header>

      <div className="admin-metric-grid">
        <div>
          <div className="admin-metric-label">Projects</div>
          <div className="admin-metric-value">{projects.length}</div>
        </div>
        <div>
          <div className="admin-metric-label">Mapped fields</div>
          <div className="admin-metric-value">{totalMappings}</div>
        </div>
        <div>
          <div className="admin-metric-label">LLM calls (24h)</div>
          <div className="admin-metric-value">{llmUsage?.summary.totalCalls ?? 0}</div>
        </div>
        <div>
          <div className="admin-metric-label">Token usage (24h)</div>
          <div className="admin-metric-value">{llmUsage?.summary.totalTokens ?? 0}</div>
        </div>
      </div>

      <div className="admin-tier-card">
        <div className="admin-tier-title">Plan controls</div>
        <div className="admin-tier-buttons">
          <button
            type="button"
            className={`btn ${tier === 'free' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setTier('free')}
          >
            Free tier
          </button>
          <button
            type="button"
            className={`btn ${tier === 'premium' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setTier('premium')}
          >
            Premium tier
          </button>
        </div>
        <p className="admin-tier-note">
          Billing and entitlement enforcement are still UI-only. This panel restores the admin persona surface and product-control narrative.
        </p>
      </div>

      <div className="admin-toggle-list">
        <label>
          <input
            type="checkbox"
            checked={llmControlsEnabled}
            onChange={(event) => setLlmControlsEnabled(event.target.checked)}
          />
          LLM policy controls enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={usageMonitorEnabled}
            onChange={(event) => setUsageMonitorEnabled(event.target.checked)}
          />
          Product usage monitoring enabled
        </label>
      </div>
    </section>
  );
}
