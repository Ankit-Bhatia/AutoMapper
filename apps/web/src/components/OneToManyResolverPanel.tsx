import React, { useEffect, useMemo, useState } from 'react';
import type { Field, FieldMapping, Project, SchemaIntelligencePatternCandidate } from '@contracts';
import { api } from '@core/api-client';
import { parseSchemaIntelligenceRationale } from './schemaIntelligence';

interface RoutingOption extends SchemaIntelligencePatternCandidate {
  targetFieldId: string;
}

interface ResolverRow {
  mapping: FieldMapping;
  sourceField: Field;
  currentTarget: Field | undefined;
  resolvedTargetId?: string;
  options: RoutingOption[];
}

interface OneToManyResolverPanelProps {
  project: Project;
  fields: Field[];
  fieldMappings: FieldMapping[];
  unresolvedCount: number;
  onResolved: (next: { project: Project; fieldMappings: FieldMapping[] }) => void;
  onBackToReview: () => void;
  onProceedToExport?: () => void;
}

export function OneToManyResolverPanel({
  project,
  fields,
  fieldMappings,
  unresolvedCount,
  onResolved,
  onBackToReview,
  onProceedToExport,
}: OneToManyResolverPanelProps) {
  const [candidatesByField, setCandidatesByField] = useState<Record<string, RoutingOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});

  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const routedMappings = useMemo(() => fieldMappings.filter((mapping) => {
    if (mapping.status === 'rejected' || mapping.status === 'unmatched') return false;
    return parseSchemaIntelligenceRationale(mapping.rationale).flags.oneToMany;
  }), [fieldMappings]);

  useEffect(() => {
    let cancelled = false;
    async function loadCandidates() {
      setLoading(true);
      setError(null);
      try {
        const uniqueSourceFields = [...new Set(routedMappings.map((mapping) => mapping.sourceFieldId))]
          .map((id) => fieldById.get(id))
          .filter((field): field is Field => Boolean(field));

        const responses = await Promise.all(uniqueSourceFields.map(async (field) => {
          const response = await api<{ field?: string; candidates: SchemaIntelligencePatternCandidate[] }>(
            `/api/schema-intelligence/patterns?field=${encodeURIComponent(field.name)}`
          );
          const options = response.candidates
            .map((candidate) => {
              const target = fields.find((fieldItem) => fieldItem.name === candidate.targetFieldName);
              if (!target) return null;
              return { ...candidate, targetFieldId: target.id };
            })
            .filter((candidate): candidate is RoutingOption => Boolean(candidate));
          return [field.id, options] as const;
        }));

        if (cancelled) return;
        const nextCandidates = Object.fromEntries(responses);
        setCandidatesByField(nextCandidates);
        const initialSelections: Record<string, string> = {};
        for (const mapping of routedMappings) {
          const resolution = project.resolvedOneToManyMappings?.[mapping.sourceFieldId];
          initialSelections[mapping.id] = resolution?.targetFieldId ?? mapping.targetFieldId;
        }
        setSelectedTargets(initialSelections);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load routing candidates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCandidates();
    return () => { cancelled = true; };
  }, [fieldById, fieldMappings, fields, project.resolvedOneToManyMappings, routedMappings]);

  const rows = useMemo<ResolverRow[]>(() => {
    const nextRows: ResolverRow[] = [];
    for (const mapping of routedMappings) {
      const sourceField = fieldById.get(mapping.sourceFieldId);
      if (!sourceField) continue;
      nextRows.push({
        mapping,
        sourceField,
        currentTarget: fieldById.get(mapping.targetFieldId),
        resolvedTargetId: project.resolvedOneToManyMappings?.[mapping.sourceFieldId]?.targetFieldId,
        options: candidatesByField[mapping.sourceFieldId] ?? [],
      });
    }
    return nextRows;
  }, [candidatesByField, fieldById, project.resolvedOneToManyMappings, routedMappings]);

  const dirtyRows = rows.filter((row) => selectedTargets[row.mapping.id] && selectedTargets[row.mapping.id] !== row.resolvedTargetId);

  async function handleSave() {
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        resolutions: dirtyRows.map((row) => ({
          fieldMappingId: row.mapping.id,
          sourceFieldId: row.sourceField.id,
          targetFieldId: selectedTargets[row.mapping.id],
        })),
      };
      const response = await api<{ project: Project; fieldMappings: FieldMapping[] }>(`/api/projects/${project.id}/one-to-many-resolutions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onResolved(response);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save routing decisions');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="routing-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Resolve One-to-Many Routing</h1>
          <p className="page-subtitle">Choose the correct Salesforce target for each one-to-many source field before export.</p>
        </div>
        <div className="mapping-header-actions">
          <button className="btn btn--ghost" onClick={onBackToReview}>Back to Review</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving || dirtyRows.length === 0}>
            {saving ? 'Saving…' : `Save ${dirtyRows.length || ''}`.trim()}
          </button>
          {unresolvedCount === 0 && onProceedToExport && (
            <button className="btn btn--secondary" onClick={onProceedToExport}>Proceed to Export</button>
          )}
        </div>
      </div>

      {unresolvedCount > 0 && (
        <div className="validation-box validation-box--warn" style={{ marginBottom: '16px' }}>
          <div className="validation-box-title">Routing decisions required</div>
          <p style={{ margin: 0, fontSize: '14px' }}>
            {unresolvedCount} one-to-many mapping{unresolvedCount === 1 ? '' : 's'} still need an explicit routing choice.
          </p>
        </div>
      )}

      {error && (
        <div className="validation-box validation-box--error" style={{ marginBottom: '16px' }}>
          <div className="validation-box-title">Routing error</div>
          <p style={{ margin: 0, fontSize: '14px' }}>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="empty-state" style={{ marginTop: '48px' }}>
          <div className="empty-state-title">Loading routing candidates…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '48px' }}>
          <div className="empty-state-title">No one-to-many mappings found</div>
          <p className="empty-state-body">This project does not currently require manual routing decisions.</p>
        </div>
      ) : (
        <div className="routing-grid">
          {rows.map((row) => (
            <div key={row.mapping.id} className="routing-card">
              <div className="routing-card-header">
                <div>
                  <div className="routing-source-name">{row.sourceField.name}</div>
                  <div className="routing-source-meta">Current target: {row.currentTarget?.name ?? row.mapping.targetFieldId}</div>
                </div>
                <span className={`status-badge ${row.resolvedTargetId ? 'status-modified' : 'status-suggested'}`}>
                  {row.resolvedTargetId ? 'resolved' : 'pending'}
                </span>
              </div>
              <div className="routing-options">
                {row.options.map((option) => (
                  <label key={`${row.mapping.id}-${option.targetFieldId}`} className="routing-option">
                    <input
                      type="radio"
                      name={`routing-${row.mapping.id}`}
                      checked={selectedTargets[row.mapping.id] === option.targetFieldId}
                      onChange={() => setSelectedTargets((prev) => ({ ...prev, [row.mapping.id]: option.targetFieldId }))}
                    />
                    <span className="routing-option-copy">
                      <span className="routing-option-title">{option.targetObject}.{option.targetFieldName}</span>
                      <span className="routing-option-note">{option.notes}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
