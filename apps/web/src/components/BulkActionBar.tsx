import { useState } from 'react';
import { api } from '@core/api-client';

type ComplianceTag = 'GLBA_NPI' | 'BSA_AML' | 'SOX_FINANCIAL' | 'FFIEC_AUDIT' | 'PCI_CARD';
type BulkOperation =
  | 'accept_suggestion'
  | 'reject_suggestion'
  | 'add_compliance_tag'
  | 'remove_compliance_tag'
  | 'set_required'
  | 'clear_mapping';

export interface BulkOperationResult {
  applied: number;
  skipped: number;
  errors: Array<{ mappingId: string; reason: string }>;
}

interface BulkActionBarProps {
  projectId: string;
  selectedIds: string[];
  onComplete: (result: BulkOperationResult) => void;
  onClear: () => void;
}

const COMPLIANCE_TAGS: ComplianceTag[] = ['GLBA_NPI', 'BSA_AML', 'SOX_FINANCIAL', 'FFIEC_AUDIT', 'PCI_CARD'];

export function BulkActionBar({ projectId, selectedIds, onComplete, onClear }: BulkActionBarProps) {
  const [pending, setPending] = useState<BulkOperation | null>(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = selectedIds.length;
  if (count === 0) return null;

  async function runOperation(operation: BulkOperation, payload?: { complianceTag?: ComplianceTag; required?: boolean }) {
    if (pending) return;
    setPending(operation);
    setError(null);

    try {
      const result = await api<BulkOperationResult>(`/api/projects/${projectId}/mappings/bulk`, {
        method: 'POST',
        body: JSON.stringify({ operation, mappingIds: selectedIds, payload }),
      });
      onComplete(result);
      setShowTagPicker(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Bulk operation failed';
      setError(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="bulk-action-bar" role="region" aria-label="Bulk mapping operations">
      <div className="bulk-action-bar-count">
        {count} field{count !== 1 ? 's' : ''} selected
        <button className="btn-clear-selection" onClick={onClear} aria-label="Clear selected mappings">✕</button>
      </div>

      <div className="bulk-action-bar-actions">
        <button
          className="btn btn--sm btn--primary"
          disabled={pending !== null}
          onClick={() => void runOperation('accept_suggestion')}
        >
          {pending === 'accept_suggestion' ? 'Accepting…' : 'Accept all'}
        </button>

        <button
          className="btn btn--sm btn--secondary"
          disabled={pending !== null}
          onClick={() => void runOperation('reject_suggestion')}
        >
          {pending === 'reject_suggestion' ? 'Rejecting…' : 'Reject all'}
        </button>

        <button
          className="btn btn--sm btn--ghost"
          disabled={pending !== null}
          onClick={() => void runOperation('clear_mapping')}
        >
          {pending === 'clear_mapping' ? 'Clearing…' : 'Clear mapping'}
        </button>

        <div className="bulk-action-tag-picker">
          <button
            className="btn btn--sm btn--ghost"
            disabled={pending !== null}
            onClick={() => setShowTagPicker((current) => !current)}
          >
            + Tag
          </button>
          {showTagPicker && (
            <div className="bulk-action-tag-dropdown">
              {COMPLIANCE_TAGS.map((tag) => (
                <button
                  key={tag}
                  className="bulk-action-tag-option"
                  disabled={pending !== null}
                  onClick={() => void runOperation('add_compliance_tag', { complianceTag: tag })}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="bulk-action-bar-error">{error}</div>}
    </div>
  );
}
