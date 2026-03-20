import { useEffect, useState } from 'react';
import type { AuditAction, AuditEntry } from '@contracts';
import { api } from '@core/api-client';

interface AuditLogResponse {
  entries: AuditEntry[];
  nextBefore: string | null;
}

interface AuditLogTabProps {
  projectId: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  mapping_suggested: 'generated mappings',
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function formatActor(entry: AuditEntry): string {
  if (entry.actor.userId === 'demo-admin' || entry.actor.email === 'demo.admin@automapper.local') {
    return 'Demo Admin';
  }
  if (entry.actor.email === 'unknown' || entry.actor.userId === 'unknown') {
    return 'Anonymous';
  }
  return entry.actor.email || entry.actor.userId || 'Anonymous';
}

function formatAuditSummary(entry: AuditEntry): string | null {
  const before = asRecord(entry.diff?.before);
  const after = asRecord(entry.diff?.after);

  switch (entry.action) {
    case 'project_created':
      return typeof after?.name === 'string' ? `Project: ${after.name}` : 'Project workspace initialized.';
    case 'mapping_suggested': {
      const entityCount = typeof after?.entityMappings === 'number' ? after.entityMappings : null;
      const fieldCount = typeof after?.fieldMappings === 'number' ? after.fieldMappings : null;
      if (fieldCount !== null && entityCount !== null) {
        return `${fieldCount} initial field mappings across ${entityCount} entity pairs.`;
      }
      return 'Initial mapping suggestions generated.';
    }
    case 'mapping_accepted':
    case 'mapping_rejected':
    case 'mapping_modified': {
      const nextStatus = typeof after?.status === 'string' ? after.status : null;
      const prevStatus = typeof before?.status === 'string' ? before.status : null;
      const nextTransform = asRecord(after?.transform);
      const transformType = typeof nextTransform?.type === 'string' ? nextTransform.type : null;
      if (prevStatus && nextStatus && prevStatus !== nextStatus) {
        return `Status changed from ${prevStatus} to ${nextStatus}.`;
      }
      if (transformType) {
        return `Transform set to ${transformType}.`;
      }
      return 'Mapping state updated.';
    }
    case 'conflict_resolved': {
      const unresolved = typeof after?.unresolvedConflicts === 'number' ? after.unresolvedConflicts : null;
      const statuses = Array.isArray(after?.statuses) ? after.statuses.length : null;
      if (unresolved !== null && statuses !== null) {
        return `${statuses} competing mappings reviewed; ${unresolved} unresolved conflicts remain.`;
      }
      return 'Conflict resolution saved.';
    }
    case 'project_exported': {
      const format = typeof after?.format === 'string' ? after.format.toUpperCase() : null;
      return format ? `${format} export downloaded.` : 'Project export downloaded.';
    }
    default:
      return null;
  }
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const icon = ACTION_ICONS[entry.action] ?? '•';
  const summary = formatAuditSummary(entry);

  return (
    <div className="audit-entry">
      <div className="audit-entry-icon">{icon}</div>
      <div className="audit-entry-body">
        <div className="audit-entry-title-row">
          <span className="audit-actor">{formatActor(entry)}</span>
          <span className="audit-action">{label}</span>
        </div>
        {summary && <div className="audit-diff">{summary}</div>}
      </div>
      <div className="audit-entry-time" title={new Date(entry.timestamp).toLocaleString()}>
        {formatRelativeTime(entry.timestamp)}
      </div>
    </div>
  );
}

export function AuditLogTab({ projectId }: AuditLogTabProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <div className="audit-log-shell">
      <div className="audit-log-toolbar">
        <div>
          <div className="audit-log-title">Project Activity</div>
          <div className="audit-log-subtitle">{entries.length} recent entr{entries.length === 1 ? 'y' : 'ies'}</div>
        </div>
      </div>
      <div className="audit-log">
        {entries.map((entry) => (
          <AuditEntryRow key={entry.id} entry={entry} />
        ))}
        {nextBefore && (
          <button
            className="btn btn--ghost audit-log-more"
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
    </div>
  );
}
