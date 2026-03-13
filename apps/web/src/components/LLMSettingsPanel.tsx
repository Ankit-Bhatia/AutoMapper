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

  const avgDuration = useMemo(() => {
    const events = usage?.events ?? [];
    if (!events.length) return 0;
    const total = events.reduce((sum, event) => sum + event.durationMs, 0);
    return Math.round(total / events.length);
  }, [usage]);

  const recentEvents = (usage?.events ?? []).slice(0, 5);

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
    <section className="llm-panel">
      <header className="llm-panel-header">
        <div>
          <h3 className="llm-panel-title">LLM Settings (BYOL)</h3>
          <p className="llm-panel-subtitle">Attach your own model key/URL, monitor usage, or switch back to AutoMapper default.</p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={onRefresh}>
          Refresh
        </button>
      </header>

      {loading && <p className="llm-panel-state">Loading LLM settings…</p>}
      {!loading && error && <p className="llm-panel-state llm-panel-state--error">{error}</p>}

      {!loading && config && (
        <>
          <div className="llm-summary-grid">
            <div>
              <div className="llm-summary-label">Effective provider</div>
              <div className="llm-summary-value">{config.effectiveProvider}</div>
            </div>
            <div>
              <div className="llm-summary-label">Mode</div>
              <div className="llm-summary-value">{config.config.mode === 'byol' ? 'BYOL' : 'AutoMapper default'}</div>
            </div>
            <div>
              <div className="llm-summary-label">API key</div>
              <div className="llm-summary-value">{config.config.apiKeyPreview ?? 'Not set'}</div>
            </div>
            <div>
              <div className="llm-summary-label">Paused</div>
              <div className="llm-summary-value">{config.config.paused ? 'Yes' : 'No'}</div>
            </div>
          </div>

          <div className="llm-form-grid">
            <label className="llm-field">
              <span>Mode</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as 'default' | 'byol')}>
                <option value="default">AutoMapper default LLM</option>
                <option value="byol">Bring your own LLM</option>
              </select>
            </label>

            {mode === 'byol' && (
              <>
                <label className="llm-field">
                  <span>Provider</span>
                  <select value={provider} onChange={(event) => setProvider(event.target.value as BYOLProvider)}>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="custom">Custom (OpenAI-compatible URL)</option>
                  </select>
                </label>

                <label className="llm-field">
                  <span>Model (optional)</span>
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="gpt-4o-mini / claude-haiku / gemini-2.0-flash"
                  />
                </label>

                <label className="llm-field">
                  <span>API key {config.config.hasApiKey ? '(leave blank to keep current)' : ''}</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Enter API key"
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

                <label className="llm-toggle">
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(event) => setPaused(event.target.checked)}
                  />
                  Pause BYOL and use AutoMapper default LLM
                </label>
              </>
            )}
          </div>

          <div className="llm-actions">
            <button type="button" className="btn btn--primary" onClick={() => { void handleSave(); }} disabled={saving}>
              {saving ? 'Saving...' : 'Save LLM Settings'}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => { void handleSwitchToDefault(); }}
              disabled={saving}
            >
              Use AutoMapper Default
            </button>
          </div>

          <div className="llm-usage-grid">
            <div>
              <div className="llm-summary-label">Calls ({usage?.summary.windowHours ?? 24}h)</div>
              <div className="llm-summary-value">{usage?.summary.totalCalls ?? 0}</div>
            </div>
            <div>
              <div className="llm-summary-label">Tokens</div>
              <div className="llm-summary-value">{usage?.summary.totalTokens ?? 0}</div>
            </div>
            <div>
              <div className="llm-summary-label">Failures</div>
              <div className="llm-summary-value">{usage?.summary.failedCalls ?? 0}</div>
            </div>
            <div>
              <div className="llm-summary-label">Avg response</div>
              <div className="llm-summary-value">{avgDuration} ms</div>
            </div>
          </div>

          <div className="llm-events">
            <div className="llm-events-title">Recent LLM events</div>
            {recentEvents.length === 0 ? (
              <p className="llm-panel-state">No LLM calls captured yet.</p>
            ) : (
              <ul>
                {recentEvents.map((event) => (
                  <li key={event.id} className={`llm-event-item ${event.success ? 'is-success' : 'is-error'}`}>
                    <span>{event.provider}{event.model ? `/${event.model}` : ''}</span>
                    <span>{event.tokensUsed ?? 0} tokens</span>
                    <span>{event.durationMs} ms</span>
                    <span>{event.success ? 'ok' : (event.error ?? 'error')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
