import { useEffect, useMemo, useState } from 'react';
import type { LLMConfigResponse, LLMUsageResponse } from '@contracts';

export type BYOLProvider = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface LLMConfigUpdatePayload {
  mode: 'default' | 'byol';
  paused?: boolean;
  provider?: BYOLProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface LLMSettingsPanelProps {
  config: LLMConfigResponse | null;
  usage: LLMUsageResponse | null;
  loading: boolean;
  saving: boolean;
  error?: string | null;
  onRefresh: () => void;
  onSave: (payload: LLMConfigUpdatePayload) => Promise<void>;
}

const PROVIDER_OPTIONS: Array<{ id: BYOLProvider; label: string; hint: string }> = [
  { id: 'openai', label: 'OpenAI', hint: 'Best when you want structured reasoning + tool output' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Useful for longer synthesis and policy-heavy prompts' },
  { id: 'gemini', label: 'Gemini', hint: 'Lower-latency option for budget-sensitive orchestration' },
  { id: 'custom', label: 'Custom URL', hint: 'OpenAI-compatible endpoint behind your own gateway' },
];

export function LLMSettingsPanel({
  config,
  usage,
  loading,
  saving,
  error,
  onRefresh,
  onSave,
}: LLMSettingsPanelProps) {
  const [mode, setMode] = useState<'default' | 'byol'>('default');
  const [provider, setProvider] = useState<BYOLProvider>('openai');
  const [paused, setPaused] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');

  useEffect(() => {
    if (!config) return;
    setMode(config.config.mode);
    setProvider((config.config.provider ?? 'openai') as BYOLProvider);
    setPaused(config.config.paused);
    setApiKey('');
    setBaseUrl(config.config.baseUrl ?? '');
    setModel(config.config.model ?? '');
  }, [config]);

  const usageSummary = usage?.summary;
  const recentEvents = (usage?.events ?? []).slice(0, 5);
  const avgDuration = useMemo(() => {
    const events = usage?.events ?? [];
    if (!events.length) return 0;
    const total = events.reduce((sum, event) => sum + event.durationMs, 0);
    return Math.round(total / events.length);
  }, [usage]);

  async function handleSave() {
    const payload: LLMConfigUpdatePayload = {
      mode,
      paused,
    };

    if (mode === 'byol') {
      payload.provider = provider;
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (model.trim()) payload.model = model.trim();
      if (provider === 'custom' && baseUrl.trim()) {
        payload.baseUrl = baseUrl.trim();
      }
      if (provider !== 'custom') {
        payload.baseUrl = undefined;
      }
    }

    await onSave(payload);
    setApiKey('');
  }

  async function handleSwitchToDefault() {
    await onSave({ mode: 'default', paused: false });
  }

  return (
    <section className="llm-console">
      <header className="llm-console-header">
        <div>
          <div className="llm-console-label">Workspace brain routing</div>
          <h2 className="llm-console-title">Provider controls</h2>
          <p className="llm-console-subtitle">
            Attach your own provider, pause BYOL instantly, or fall back to AutoMapper default without leaving the studio.
          </p>
        </div>
        <div className="llm-console-header-actions">
          <button type="button" className="cc-btn-ghost" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="cc-btn-primary" onClick={() => { void handleSave(); }} disabled={saving || loading || !config}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </header>

      {loading && <p className="llm-panel-state">Loading LLM settings...</p>}
      {!loading && error && <p className="llm-panel-state llm-panel-state--error">{error}</p>}

      {!loading && config && (
        <>
          <div className="llm-config-grid">
            <section className="llm-config-card">
              <div className="llm-card-title">Routing mode</div>
              <div className="llm-mode-switch" role="group" aria-label="LLM mode">
                <button
                  type="button"
                  className={`llm-mode-option ${mode === 'default' ? 'active' : ''}`}
                  aria-pressed={mode === 'default'}
                  onClick={() => setMode('default')}
                >
                  AutoMapper default
                </button>
                <button
                  type="button"
                  className={`llm-mode-option ${mode === 'byol' ? 'active' : ''}`}
                  aria-pressed={mode === 'byol'}
                  onClick={() => setMode('byol')}
                >
                  Bring your own LLM
                </button>
              </div>
              <div className="llm-inline-summary">
                <div>
                  <span className="llm-summary-label">Effective provider</span>
                  <strong className="llm-summary-emphasis">{config.effectiveProvider}</strong>
                </div>
                <div>
                  <span className="llm-summary-label">Key preview</span>
                  <strong className="llm-summary-emphasis">{config.config.apiKeyPreview ?? 'Not set'}</strong>
                </div>
              </div>
              <label className="llm-toggle-card">
                <input
                  type="checkbox"
                  checked={paused}
                  onChange={(event) => setPaused(event.target.checked)}
                  disabled={mode !== 'byol'}
                />
                <span>
                  <span className="llm-toggle-title">Pause BYOL</span>
                  <span className="llm-toggle-copy">Keep the saved provider config, but route live traffic back to the AutoMapper default brain.</span>
                </span>
              </label>
            </section>

            <section className="llm-config-card">
              <div className="llm-card-title">Usage pulse</div>
              <div className="llm-usage-pulse-grid">
                <div className="llm-pulse-card">
                  <span className="llm-summary-label">Calls</span>
                  <strong className="llm-summary-emphasis">{usageSummary?.totalCalls ?? 0}</strong>
                </div>
                <div className="llm-pulse-card">
                  <span className="llm-summary-label">Tokens</span>
                  <strong className="llm-summary-emphasis">{usageSummary?.totalTokens ?? 0}</strong>
                </div>
                <div className="llm-pulse-card">
                  <span className="llm-summary-label">Failures</span>
                  <strong className="llm-summary-emphasis">{usageSummary?.failedCalls ?? 0}</strong>
                </div>
                <div className="llm-pulse-card">
                  <span className="llm-summary-label">Avg response</span>
                  <strong className="llm-summary-emphasis">{avgDuration} ms</strong>
                </div>
              </div>
            </section>
          </div>

          {mode === 'byol' && (
            <section className="llm-config-card">
              <div className="llm-card-title">Provider selection</div>
              <div className="llm-provider-grid">
                {PROVIDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`llm-provider-tile ${provider === option.id ? 'active' : ''}`}
                    onClick={() => setProvider(option.id)}
                  >
                    <span className="llm-provider-name">{option.label}</span>
                    <span className="llm-provider-hint">{option.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="llm-config-card">
            <div className="llm-card-title">Connection details</div>
            <div className="llm-form-grid">
              {mode === 'byol' && (
                <>
                  <label className="llm-field">
                    <span>Model</span>
                    <input
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder="gpt-4.1-mini / claude-3-5-sonnet / gemini-2.0-flash"
                    />
                  </label>

                  <label className="llm-field">
                    <span>API key {config.config.hasApiKey ? '(leave blank to keep current)' : ''}</span>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="Enter provider key"
                    />
                  </label>

                  {provider === 'custom' && (
                    <label className="llm-field llm-field--span2">
                      <span>Custom base URL</span>
                      <input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="https://your-llm.example.com/v1"
                      />
                    </label>
                  )}
                </>
              )}

              <div className="llm-field llm-field--span2">
                <span>Current posture</span>
                <div className="llm-posture-strip">
                  <span className={`cc-tag ${config.config.mode === 'byol' ? 'cc-tag-cyan' : 'cc-tag-green'}`}>
                    {config.config.mode === 'byol' ? 'BYOL configured' : 'Default mode'}
                  </span>
                  <span className={`cc-tag ${config.config.paused ? 'cc-tag-amber' : 'cc-tag-green'}`}>
                    {config.config.paused ? 'Paused' : 'Routing live'}
                  </span>
                  {config.config.model && <span className="cc-tag cc-tag-cyan">{config.config.model}</span>}
                </div>
              </div>
            </div>

            <div className="llm-actions llm-actions--compact">
              <button type="button" className="cc-btn-primary" onClick={() => { void handleSave(); }} disabled={saving}>
                {saving ? 'Saving...' : 'Save LLM Settings'}
              </button>
              <button type="button" className="cc-btn-ghost" onClick={() => { void handleSwitchToDefault(); }} disabled={saving}>
                Use AutoMapper Default
              </button>
            </div>
          </section>

          <section className="llm-config-card">
            <div className="llm-card-title">Recent LLM events</div>
            {recentEvents.length === 0 ? (
              <p className="llm-panel-state">No LLM calls captured yet.</p>
            ) : (
              <div className="llm-events-table">
                {recentEvents.map((event) => (
                  <div key={event.id} className={`llm-events-row ${event.success ? 'is-success' : 'is-error'}`}>
                    <div>
                      <div className="llm-events-provider">{event.provider}{event.model ? ` / ${event.model}` : ''}</div>
                      <div className="llm-events-meta">mapping</div>
                    </div>
                    <div>{event.tokensUsed ?? 0} tokens</div>
                    <div>{event.durationMs} ms</div>
                    <div>{event.success ? 'ok' : (event.error ?? 'error')}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
