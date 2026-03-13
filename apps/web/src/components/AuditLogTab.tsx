import { useEffect, useMemo, useState } from 'react';
import type { AuditAction, AuditEntry } from '@contracts';
import { api } from '@core/api-client';

interface AuditLogResponse {
  entries: AuditEntry[];
  nextBefore: string | null;
}

interface AuditLogTabProps {
  projectId: string;
  onRecentEntriesChange?: (hasRecent: boolean) => void;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  mapping_suggested: 'suggested mappings',
  mapping_accepted: 'accepted a mapping',
  mapping_rejected: 'rejected a mapping',
  mapping_modified: 'modified a mapping',
  conflict_resolved: 'resolved a conflict',
  project_created: 'created the project',
  project_exported: 'exported the project',
};

const ACTION_ICONS: Record<AuditAction, string> = {
  mapping_suggested: '💡',
  mapping_accepted: '✅',
  mapping_rejected: '❌',
  mapping_modified: '✏️',
  conflict_resolved: '⚖️',
  project_created: '🗂️',
  project_exported: '📤',
};

function formatRelativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return new Date(timestamp).toLocaleString();

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleString();
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const icon = ACTION_ICONS[entry.action] ?? '•';
  const diffText = entry.diff?.after ? JSON.stringify(entry.diff.after) : '';

  return (
    <div className="audit-entry">
      <div className="audit-entry-icon">{icon}</div>
      <div className="audit-entry-body">
        <span className="audit-actor">{entry.actor.email}</span>
        {' '}
        <span className="audit-action">{label}</span>
        {diffText && <span className="audit-diff"> → {diffText}</span>}
      </div>
      <div className="audit-entry-time" title={new Date(entry.timestamp).toLocaleString()}>
        {formatRelativeTime(entry.timestamp)}
      </div>
    </div>
  );
}

export function AuditLogTab({ projectId, onRecentEntriesChange }: AuditLogTabProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasRecent = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return entries.some((entry) => new Date(entry.timestamp).getTime() >= dayAgo);
  }, [entries]);

  useEffect(() => {
    onRecentEntriesChange?.(hasRecent);
  }, [hasRecent, onRecentEntriesChange]);

  async function loadEntries(before?: string) {
    setLoading(true);
    try {
      const query = before ? `?limit=50&before=${encodeURIComponent(before)}` : '?limit=50';
      const data = await api<AuditLogResponse>(`/api/projects/${projectId}/audit${query}`);
      setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
      setNextBefore(data.nextBefore);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, [projectId]);

  return (
    <div className="audit-log">
      {entries.map((entry) => (
        <AuditEntryRow key={entry.id} entry={entry} />
      ))}
      {nextBefore && (
        <button
          className="btn btn--ghost"
          onClick={() => void loadEntries(nextBefore)}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load older entries'}
        </button>
      )}
      {entries.length === 0 && !loading && (
        <p className="audit-empty">No activity recorded yet.</p>
      )}
    </div>
  );
}
