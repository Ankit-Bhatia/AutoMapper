interface UserPersonaPanelProps {
  userName?: string;
}

export function UserPersonaPanel({ userName }: UserPersonaPanelProps) {
  return (
    <section className="user-panel">
      <header className="user-panel-header">
        <div>
          <h3 className="user-panel-title">Normal User Workspace</h3>
          <p className="user-panel-subtitle">
            {userName ? `${userName}, you can run mappings, reopen projects, and manage your connector workflow.` : 'Run mappings, reopen projects, and manage your connector workflow.'}
          </p>
        </div>
        <span className="user-badge">Normal user</span>
      </header>

      <ul className="user-panel-list">
        <li>Access connector setup, orchestration, review, and export.</li>
        <li>Reopen historical projects without rerunning the pipeline.</li>
        <li>Use the organization LLM policy selected by an admin.</li>
        <li>Global plan and provider controls stay restricted to admin roles.</li>
      </ul>
    </section>
  );
}
