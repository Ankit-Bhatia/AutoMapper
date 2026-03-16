import type { LLMConfigResponse, LLMUsageResponse, ProjectHistoryItem } from '@contracts';
import { AdminControlPanel } from './AdminControlPanel';
import { LLMSettingsPanel, type LLMConfigUpdatePayload } from './LLMSettingsPanel';
import { UserPersonaPanel } from './UserPersonaPanel';

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
  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">LLM / API Settings</h1>
          <p className="page-subtitle">
            Review provider mode, BYOL routing, usage, and persona-specific access controls.
          </p>
        </div>
        {onBack && (
          <div className="page-header-actions">
            <button type="button" className="btn btn--secondary" onClick={onBack}>
              Back to Studio
            </button>
          </div>
        )}
      </div>

      <div className="settings-grid">
        {isAdmin ? (
          <>
            <LLMSettingsPanel
              config={llmConfig}
              usage={llmUsage}
              loading={llmLoading}
              saving={llmSaving}
              error={llmError}
              onRefresh={onRefresh}
              onSave={onSave}
            />
            <AdminControlPanel
              userName={userName}
              projects={projects}
              llmUsage={llmUsage}
            />
          </>
        ) : (
          <section className="settings-restricted">
            <UserPersonaPanel userName={userName} />
            <div className="settings-restricted-card">
              <div className="settings-restricted-title">Settings access is restricted</div>
              <p className="settings-restricted-copy">
                Only admin users can change global LLM policy, provider keys, and organization-wide defaults.
              </p>
              <ul className="settings-restricted-list">
                <li>Continue running mappings with the current organization defaults.</li>
                <li>Ask an admin to update provider mode, pause BYOL, or rotate keys.</li>
                <li>Usage analytics remain visible only to the admin persona.</li>
              </ul>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
