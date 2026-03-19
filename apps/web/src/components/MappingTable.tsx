import React, { useEffect, useMemo, useState } from 'react';
import {
  Entity,
  Field,
  EntityMapping,
  FieldMapping,
  ValidationReport,
  AuditEntry,
  MappingConflict,
} from '@contracts';
import { api } from '@core/api-client';
import { useAuth } from '../auth/AuthContext';
import { AuditLogTab } from './AuditLogTab';
import { SchemaIntelligenceBadge } from './SchemaIntelligenceBadge';
import {
  getActiveFormulaTargetIds,
  parseSchemaIntelligenceRationale,
} from './schemaIntelligence';

interface MappingTableProps {
  projectId: string;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
  conflicts?: MappingConflict[];
  unresolvedConflicts?: number;
  unresolvedRoutingDecisions?: number;
  onOpenConflicts?: () => void;
  onOpenRouting?: () => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (mappingId: string, selected: boolean) => void;
  selectionCap?: number;
  onMappingUpdate: (updated: FieldMapping) => void;
  acknowledgedFormulaMappingIds?: Set<string>;
  onAcknowledgeFormulaWarning?: (mappingId: string) => void;
  onProceedToExport?: () => void;
}

type StatusFilter = 'all' | 'suggested' | 'accepted' | 'rejected' | 'modified' | 'unmatched';
const TRANSFORM_OPTIONS = ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'];

function extractPatchedMapping(payload: unknown): FieldMapping | null {
  if (!payload || typeof payload !== 'object') return null;
  const maybeDirect = payload as Partial<FieldMapping>;
  if (typeof maybeDirect.id === 'string' && typeof maybeDirect.status === 'string') {
    return payload as FieldMapping;
  }
  const wrapped = (payload as { fieldMapping?: FieldMapping }).fieldMapping;
  if (wrapped && typeof wrapped.id === 'string') return wrapped;
  return null;
}

function confClass(c: number): string {
  if (c >= 0.75) return 'hi';
  if (c >= 0.45) return 'md';
  return 'lo';
}

function CompliancePill({ tag }: { tag: string }) {
  const colorMap: Record<string, string> = {
    GLBA_NPI: 'badge--amber',
    BSA_AML: 'badge--red',
    PCI_CARD: 'badge--red',
    SOX_FINANCIAL: 'badge--purple',
    FFIEC_AUDIT: 'badge--sky',
  };
  const cls = colorMap[tag] ?? 'badge--gray';
  return <span className={`badge ${cls}`}>{tag}</span>;
}

function StatusBadge({ status }: { status: FieldMapping['status'] }) {
  const map: Record<string, string> = {
    suggested: 'status-suggested',
    accepted: 'status-accepted',
    rejected: 'status-rejected',
    modified: 'status-modified',
    unmatched: 'status-rejected',
  };
  return <span className={`status-badge ${map[status] ?? ''}`}>{status}</span>;
}

function SeedBadge({ source }: { source?: FieldMapping['seedSource'] }) {
  if (!source) return null;
  const map = {
    derived: { label: 'HISTORY', className: 'badge-derived' },
    canonical: { label: 'CANONICAL', className: 'badge-canonical' },
    agent: { label: 'AI', className: 'badge-agent' },
  } as const;
  const badge = map[source];
  if (!badge) return null;
  return <span className={`seed-badge ${badge.className}`}>{badge.label}</span>;
}

export function MappingTable({
  projectId,
  sourceEntities,
  targetEntities,
  fields,
  entityMappings,
  fieldMappings,
  validation,
  conflicts = [],
  unresolvedConflicts = 0,
  unresolvedRoutingDecisions = 0,
  onOpenConflicts,
  onOpenRouting,
  selectedIds,
  onSelectionChange,
  selectionCap = 200,
  onMappingUpdate,
  acknowledgedFormulaMappingIds,
  onAcknowledgeFormulaWarning,
  onProceedToExport,
}: MappingTableProps) {
  const { user } = useAuth();
  const orgSlug = user?.orgSlug || 'default';
  const [activeEntityMappingId, setActiveEntityMappingId] = useState<string>(
    entityMappings[0]?.id ?? '',
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingTransform, setEditingTransform] = useState<string | null>(null);
  const [pendingTransform, setPendingTransform] = useState<string>('direct');
  const [saving, setSaving] = useState<string | null>(null);
  const [focusedMappingId, setFocusedMappingId] = useState<string | null>(null);
  const [reviewTab, setReviewTab] = useState<'mappings' | 'audit'>('mappings');
  const [hasRecentAudit, setHasRecentAudit] = useState(false);
  const selectedMappingIds = selectedIds ?? new Set<string>();
  const acknowledgedFormulaIds = acknowledgedFormulaMappingIds ?? new Set<string>();

  // Build lookup maps
  const fieldMap = useMemo(() => {
    const m = new Map<string, Field>();
    fields.forEach((f) => m.set(f.id, f));
    return m;
  }, [fields]);

  const sourceEntityMap = useMemo(() => {
    const m = new Map<string, Entity>();
    sourceEntities.forEach((e) => m.set(e.id, e));
    return m;
  }, [sourceEntities]);

  const targetEntityMap = useMemo(() => {
    const m = new Map<string, Entity>();
    targetEntities.forEach((e) => m.set(e.id, e));
    return m;
  }, [targetEntities]);

  // Current entity mapping
  const activeEntityMapping = entityMappings.find((em) => em.id === activeEntityMappingId);

  // Field mappings for this entity, filtered
  const visibleMappings = useMemo(() => {
    return fieldMappings.filter((fm) => {
      if (fm.entityMappingId !== activeEntityMappingId) return false;
      if (statusFilter !== 'all' && fm.status !== statusFilter) return false;
      return true;
    });
  }, [fieldMappings, activeEntityMappingId, statusFilter]);
  const visibleAverageConfidence = useMemo(
    () =>
      visibleMappings.length
        ? visibleMappings.reduce((sum, fm) => sum + fm.confidence, 0) / visibleMappings.length
        : 0,
    [visibleMappings],
  );
  const conflictingTargetFieldIds = useMemo(
    () => new Set(conflicts.map((conflict) => conflict.targetFieldId)),
    [conflicts],
  );
  const schemaInsightsById = useMemo(
    () => new Map(fieldMappings.map((mapping) => [mapping.id, parseSchemaIntelligenceRationale(mapping.rationale)])),
    [fieldMappings],
  );
  const activeFormulaTargetIds = useMemo(
    () => getActiveFormulaTargetIds(fieldMappings),
    [fieldMappings],
  );
  const pendingFormulaAcknowledgements = useMemo(
    () => activeFormulaTargetIds.filter((mappingId) => !acknowledgedFormulaIds.has(mappingId)),
    [acknowledgedFormulaIds, activeFormulaTargetIds],
  );
  const globalAcceptedCount = useMemo(
    () => fieldMappings.filter((fm) => fm.status === 'accepted').length,
    [fieldMappings],
  );
  const globalRejectedCount = useMemo(
    () => fieldMappings.filter((fm) => fm.status === 'rejected').length,
    [fieldMappings],
  );
  const globalSuggestedCount = useMemo(
    () => fieldMappings.filter((fm) => fm.status === 'suggested' || fm.status === 'modified').length,
    [fieldMappings],
  );
  const globalAverageConfidence = useMemo(
    () =>
      fieldMappings.length
        ? fieldMappings.reduce((sum, fm) => sum + fm.confidence, 0) / fieldMappings.length
        : 0,
    [fieldMappings],
  );

  // Counts for active entity
  const entityFMs = fieldMappings.filter((fm) => fm.entityMappingId === activeEntityMappingId);
  const acceptedCount = entityFMs.filter((fm) => fm.status === 'accepted').length;
  const rejectedCount = entityFMs.filter((fm) => fm.status === 'rejected').length;
  const totalCount = entityFMs.length;

  async function refreshRecentAuditIndicator() {
    try {
      const data = await api<{ entries: AuditEntry[] }>(`/api/projects/${projectId}/audit?limit=1`);
      const latest = data.entries[0];
      if (!latest) {
        setHasRecentAudit(false);
        return;
      }
      const isRecent = (Date.now() - new Date(latest.timestamp).getTime()) <= 24 * 60 * 60 * 1000;
      setHasRecentAudit(isRecent);
    } catch {
      setHasRecentAudit(false);
    }
  }

  function buildMappingEventPayload(mapping: FieldMapping, action: 'accepted' | 'rejected' | 'modified') {
    const sourceField = fieldMap.get(mapping.sourceFieldId);
    const targetField = fieldMap.get(mapping.targetFieldId);
    if (!sourceField || !targetField) return null;
    const sourceEntity = sourceEntityMap.get(sourceField.entityId);
    const targetEntity = targetEntityMap.get(targetField.entityId);
    if (!sourceEntity || !targetEntity) return null;

    return {
      projectId,
      fieldMappingId: mapping.id,
      action,
      sourceSystemId: sourceEntity.systemId,
      sourceEntityName: sourceEntity.name,
      sourceFieldName: sourceField.name,
      targetSystemId: targetEntity.systemId,
      targetEntityName: targetEntity.name,
      targetFieldName: targetField.name,
      transformType: mapping.transform.type,
    };
  }

  function recordMappingEvent(mapping: FieldMapping, action: 'accepted' | 'rejected' | 'modified') {
    const payload = buildMappingEventPayload(mapping, action);
    if (!payload) return;

    void api(`/api/org/${orgSlug}/mapping-events`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch(() => {
      // Non-blocking telemetry path by design.
    });
  }

  async function patchStatus(fm: FieldMapping, newStatus: FieldMapping['status']) {
    setSaving(fm.id);
    try {
      const response = await api<FieldMapping | { fieldMapping: FieldMapping }>(`/api/field-mappings/${fm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      const updated = extractPatchedMapping(response) ?? { ...fm, status: newStatus };
      onMappingUpdate(updated);
      if (newStatus === 'accepted' || newStatus === 'rejected') {
        recordMappingEvent(updated, newStatus);
      }
      void refreshRecentAuditIndicator();
    } catch {
      // Optimistic fallback — update locally
      const optimistic: FieldMapping = { ...fm, status: newStatus };
      onMappingUpdate(optimistic);
      if (newStatus === 'accepted' || newStatus === 'rejected') {
        recordMappingEvent(optimistic, newStatus);
      }
      void refreshRecentAuditIndicator();
    } finally {
      setSaving(null);
    }
  }

  async function patchTransform(fm: FieldMapping, newType: string) {
    setSaving(fm.id);
    try {
      const response = await api<FieldMapping | { fieldMapping: FieldMapping }>(`/api/field-mappings/${fm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ transform: { type: newType, config: {} }, status: 'modified' }),
      });
      const updated = extractPatchedMapping(response) ?? {
        ...fm,
        transform: { type: newType as FieldMapping['transform']['type'], config: {} },
        status: 'modified',
      };
      onMappingUpdate(updated);
      recordMappingEvent(updated, 'modified');
      void refreshRecentAuditIndicator();
    } catch {
      const optimistic: FieldMapping = {
        ...fm,
        transform: { type: newType as FieldMapping['transform']['type'], config: {} },
        status: 'modified',
      };
      onMappingUpdate(optimistic);
      recordMappingEvent(optimistic, 'modified');
      void refreshRecentAuditIndicator();
    } finally {
      setSaving(null);
      setEditingTransform(null);
    }
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement
        || e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!focusedMappingId) return;
      const focused = fieldMappings.find((fm) => fm.id === focusedMappingId);
      if (!focused) return;

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void patchStatus(focused, 'accepted');
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void patchStatus(focused, 'rejected');
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setExpandedRow(focused.id);
        setEditingTransform(focused.id);
        setPendingTransform(focused.transform.type);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [fieldMappings, focusedMappingId]);

  useEffect(() => {
    void refreshRecentAuditIndicator();
  }, [projectId]);

  if (entityMappings.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: '48px' }}>
        <div className="empty-state-icon">◻</div>
        <div className="empty-state-title">No mappings yet</div>
        <p className="empty-state-body">Run the orchestration pipeline to generate field mappings.</p>
      </div>
    );
  }

  return (
    <div className="mapping-table-page">
      {/* Page header */}
      <div className="page-header mapping-page-header">
        <div>
          <h1 className="page-title">Review Mappings</h1>
          <p className="page-subtitle">
            Inspect every field mapping, adjust transforms, and accept or reject suggestions.
          </p>
        </div>
        <div className="mapping-header-actions">
          {unresolvedRoutingDecisions > 0 && onOpenRouting && (
            <button
              className="conflict-warning-badge"
              onClick={onOpenRouting}
            >
              ↳ {unresolvedRoutingDecisions} routing decision{unresolvedRoutingDecisions > 1 ? 's' : ''}
            </button>
          )}
          {unresolvedConflicts > 0 && onOpenConflicts && (
            <button
              className="conflict-warning-badge"
              onClick={onOpenConflicts}
            >
              ⚠ {unresolvedConflicts} conflict{unresolvedConflicts > 1 ? 's' : ''}
            </button>
          )}
          {onProceedToExport && (
            <button className="btn btn--primary" onClick={onProceedToExport}>
              Proceed to Export
            </button>
          )}
        </div>
      </div>

      <div className="mapping-summary-grid">
        <div className="mapping-summary-card">
          <div className="mapping-summary-label">Total mappings</div>
          <div className="mapping-summary-value">{fieldMappings.length}</div>
          <div className="mapping-summary-meta">{entityMappings.length} entity pairs</div>
        </div>
        <div className="mapping-summary-card">
          <div className="mapping-summary-label">Accepted</div>
          <div className="mapping-summary-value success">{globalAcceptedCount}</div>
          <div className="mapping-summary-meta">Ready for export</div>
        </div>
        <div className="mapping-summary-card">
          <div className="mapping-summary-label">Suggested / Modified</div>
          <div className="mapping-summary-value">{globalSuggestedCount}</div>
          <div className="mapping-summary-meta">Needs review action</div>
        </div>
        <div className="mapping-summary-card">
          <div className="mapping-summary-label">Avg confidence</div>
          <div className="mapping-summary-value">{Math.round(globalAverageConfidence * 100)}%</div>
          <div className="mapping-summary-meta">
            Rejected {globalRejectedCount} · warnings {validation.summary.totalWarnings}
          </div>
        </div>
      </div>

      <div className="review-tabs mapping-review-tabs">
        <button
          className={`review-tab ${reviewTab === 'mappings' ? 'review-tab--active' : ''}`}
          onClick={() => setReviewTab('mappings')}
        >
          Mapping Review
        </button>
        <button
          className={`review-tab ${reviewTab === 'audit' ? 'review-tab--active' : ''}`}
          onClick={() => setReviewTab('audit')}
        >
          Audit Log
          {hasRecentAudit && <span className="review-tab-dot" aria-hidden="true" />}
        </button>
      </div>

      {reviewTab === 'audit' ? (
        <AuditLogTab projectId={projectId} onRecentEntriesChange={setHasRecentAudit} />
      ) : (
        <>

      {/* Validation warnings */}
      {validation.summary.totalWarnings > 0 && (
        <div className="validation-box validation-box--warn mapping-warning-box">
          <div className="validation-box-title">
            {validation.summary.totalWarnings} validation warning{validation.summary.totalWarnings !== 1 ? 's' : ''}
          </div>
          <ul className="validation-warn-list">
            {validation.warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
            {validation.warnings.length > 5 && (
              <li style={{ opacity: 0.6 }}>…and {validation.warnings.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {unresolvedRoutingDecisions > 0 && (
        <div className="validation-box validation-box--warn mapping-warning-box">
          <div className="validation-box-title">Routing decisions required</div>
          <p className="schema-intelligence-alert-text">
            {unresolvedRoutingDecisions} one-to-many mapping{unresolvedRoutingDecisions === 1 ? '' : 's'} still require a confirmed target route.
          </p>
          {onOpenRouting && (
            <button className="btn btn--secondary" onClick={onOpenRouting}>Open routing resolver</button>
          )}
        </div>
      )}

      {pendingFormulaAcknowledgements.length > 0 && (
        <div className="validation-box validation-box--error mapping-warning-box">
          <div className="validation-box-title">Formula field acknowledgement required</div>
          <p className="schema-intelligence-alert-text">
            {pendingFormulaAcknowledgements.length}
            {' '}
            mapping{pendingFormulaAcknowledgements.length === 1 ? '' : 's'} target Salesforce formula fields.
            Acknowledge each warning in the expanded mapping row before export.
          </p>
        </div>
      )}

      {/* Entity tabs */}
      <div className="entity-tabs">
        {entityMappings.map((em) => {
          const srcE = sourceEntityMap.get(em.sourceEntityId);
          const tgtE = targetEntityMap.get(em.targetEntityId);
          const emFMs = fieldMappings.filter((fm) => fm.entityMappingId === em.id);
          const accepted = emFMs.filter((fm) => fm.status === 'accepted').length;
          return (
            <button
              key={em.id}
              className={`entity-tab ${em.id === activeEntityMappingId ? 'active' : ''}`}
              onClick={() => {
                setActiveEntityMappingId(em.id);
                setExpandedRow(null);
                setFocusedMappingId(null);
              }}
            >
              <span className="entity-tab-name">
                {srcE?.name ?? '?'} → {tgtE?.name ?? '?'}
              </span>
              <span className="entity-tab-count">
                {accepted}/{emFMs.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="mapping-filter-bar">
        <div className="mapping-filter-pills">
          {(['all', 'suggested', 'accepted', 'rejected', 'modified', 'unmatched'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              className={`filter-pill ${statusFilter === f ? 'filter-pill--active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'all' && ` (${entityFMs.length})`}
              {f !== 'all' && ` (${entityFMs.filter((fm) => fm.status === f).length})`}
            </button>
          ))}
        </div>
        <div className="mapping-entity-conf">
          Confidence: <span style={{ fontWeight: 600 }}>
            {activeEntityMapping ? `${Math.round(activeEntityMapping.confidence * 100)}%` : '—'}
          </span>
        </div>
      </div>

      {/* Mapping rows */}
      <div className="mapping-table-wrap">
        {visibleMappings.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px 24px' }}>
            <div className="empty-state-icon">◻</div>
            <div className="empty-state-title">No mappings match this filter</div>
          </div>
        ) : (
          <table className="mapping-table">
            <thead>
              <tr>
                {onSelectionChange && <th className="mapping-col-checkbox" />}
                <th>Source field</th>
                <th>Target field</th>
                <th>Transform</th>
                <th>Confidence</th>
                <th>Status</th>
                <th className="mapping-col-actions">
                  <span>Actions</span>
                  <div className="mapping-action-hints">Accept [A] Reject [R] Modify [M]</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {activeEntityMapping && (
                <tr className="entity-group-header-row">
                  <td colSpan={onSelectionChange ? 7 : 6}>
                    <div className="entity-group-header">
                      <span className="entity-group-name">
                        {sourceEntityMap.get(activeEntityMapping.sourceEntityId)?.name ?? '?'} →
                        {' '}
                        {targetEntityMap.get(activeEntityMapping.targetEntityId)?.name ?? '?'}
                      </span>
                      <span className="entity-group-count">{visibleMappings.length} fields</span>
                      <span
                        className={`entity-group-conf ${confClass(visibleAverageConfidence)}`}
                      >
                        {Math.round(visibleAverageConfidence * 100)}
                        % avg confidence
                      </span>
                    </div>
                  </td>
                </tr>
              )}
              {visibleMappings.map((fm) => {
                const srcF = fieldMap.get(fm.sourceFieldId);
                const tgtF = fieldMap.get(fm.targetFieldId);
                const isExpanded = expandedRow === fm.id;
                const isSaving = saving === fm.id;
                const allTags = [...(srcF?.complianceTags ?? []), ...(tgtF?.complianceTags ?? [])];
                const uniqueTags = [...new Set(allTags)];
                const schemaInsights = schemaInsightsById.get(fm.id) ?? parseSchemaIntelligenceRationale(fm.rationale);
                const isFormulaAcknowledged = acknowledgedFormulaIds.has(fm.id);
                const visibleSchemaBadges = schemaInsights.findings.filter((finding) => finding.kind !== 'baseRationale');

                return (
                  <React.Fragment key={fm.id}>
                    <tr
                      className={`mapping-row mapping-row--${confClass(fm.confidence)} ${isExpanded ? 'mapping-row--expanded' : ''} ${isSaving ? 'mapping-row--saving' : ''} ${focusedMappingId === fm.id ? 'mapping-row--focused' : ''} ${conflictingTargetFieldIds.has(fm.targetFieldId) ? 'row-conflict' : ''}`}
                      onClick={() => {
                        setExpandedRow(isExpanded ? null : fm.id);
                        setFocusedMappingId(fm.id);
                      }}
                    >
                      {onSelectionChange && (
                        <td
                          className="mapping-row-checkbox-cell"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedMappingIds.has(fm.id)}
                            disabled={!selectedMappingIds.has(fm.id) && selectedMappingIds.size >= selectionCap}
                            title={
                              selectedMappingIds.size >= selectionCap && !selectedMappingIds.has(fm.id)
                                ? `Maximum ${selectionCap} fields selected`
                                : undefined
                            }
                            onChange={(event) => onSelectionChange(fm.id, event.target.checked)}
                          />
                        </td>
                      )}
                      {/* Source field */}
                      <td>
                        <div
                          className={`mapping-confidence-bar mapping-confidence-bar--${confClass(fm.confidence)}`}
                          style={{ width: `${Math.round(fm.confidence * 100)}%` }}
                        />
                        <div className="field-cell">
                          <div>
                            <div className="mapping-field-name">{srcF?.name ?? fm.sourceFieldId}</div>
                            {fm.rationale && (
                              <div className="mapping-rationale" title={fm.rationale}>
                                {fm.rationale}
                              </div>
                            )}
                            {visibleSchemaBadges.length > 0 && (
                              <div className="schema-intelligence-badge-row">
                                {visibleSchemaBadges.map((finding, index) => (
                                  <SchemaIntelligenceBadge
                                    key={`${finding.kind}-${index}`}
                                    label={finding.label}
                                    tone={finding.tone}
                                    title={finding.text}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="field-type-badge">{srcF?.dataType ?? '?'}</span>
                        </div>
                        {srcF?.required && <span className="field-required-dot" title="Required">●</span>}
                      </td>

                      {/* Target field */}
                      <td>
                        <div className="field-cell">
                          <span className="field-name">{tgtF?.name ?? fm.targetFieldId}</span>
                          {schemaInsights.flags.personAccountOnly && (
                            <span
                              className="field-info-chip"
                              title={schemaInsights.findings.find((finding) => finding.kind === 'personAccountOnly')?.text}
                            >
                              __pc
                            </span>
                          )}
                          <span className="field-type-badge">{tgtF?.dataType ?? '?'}</span>
                        </div>
                        {tgtF?.required && <span className="field-required-dot" title="Required">●</span>}
                      </td>

                      {/* Transform */}
                      <td>
                        {editingTransform === fm.id ? (
                          <div
                            className="transform-edit"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              className="form-select"
                              style={{ padding: '4px 8px', fontSize: '13px' }}
                              value={pendingTransform}
                              onChange={(e) => setPendingTransform(e.target.value)}
                            >
                              {TRANSFORM_OPTIONS.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                            <button
                              className="btn btn--primary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => patchTransform(fm, pendingTransform)}
                              disabled={isSaving}
                            >Save</button>
                            <button
                              className="btn btn--ghost"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => setEditingTransform(null)}
                            >✕</button>
                          </div>
                        ) : (
                          <div className="transform-cell">
                            <span className="transform-badge">{fm.transform.type}</span>
                            <SeedBadge source={fm.seedSource} />
                          </div>
                        )}
                      </td>

                      {/* Confidence bar */}
                      <td>
                        <div className="conf-cell">
                          <div className="conf-bar">
                            <div
                              className={`conf-bar-fill ${confClass(fm.confidence)}`}
                              style={{ width: `${Math.round(fm.confidence * 100)}%` }}
                            />
                          </div>
                          <span className="conf-pct">{Math.round(fm.confidence * 100)}%</span>
                        </div>
                        {schemaInsights.confirmedConfidenceTier && (
                          <div className="schema-intelligence-confidence-tier">
                            Corpus tier: {schemaInsights.confirmedConfidenceTier}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td>
                        <div className="status-cell">
                          <StatusBadge status={fm.status} />
                          {uniqueTags.length > 0 && (
                            <div className="compliance-tags">
                              {uniqueTags.slice(0, 2).map((t) => (
                                <CompliancePill key={t} tag={t} />
                              ))}
                              {uniqueTags.length > 2 && (
                                <span className="badge badge--gray">
                                  +{uniqueTags.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="mapping-col-actions-cell" onClick={(e) => e.stopPropagation()}>
                        <div className="action-btns">
                          {schemaInsights.flags.oneToMany && (
                            <button
                              className="btn btn--secondary btn--xs"
                              onClick={() => {
                                setExpandedRow(fm.id);
                                setFocusedMappingId(fm.id);
                              }}
                              title="Routing decision required"
                            >
                              Route
                            </button>
                          )}
                          {fm.status !== 'accepted' && (
                            <button
                              className="btn btn--success btn--xs"
                              onClick={() => patchStatus(fm, 'accepted')}
                              disabled={isSaving}
                              title="Accept"
                            >✓</button>
                          )}
                          {fm.status !== 'rejected' && (
                            <button
                              className="btn btn--danger btn--xs"
                              onClick={() => patchStatus(fm, 'rejected')}
                              disabled={isSaving}
                              title="Reject"
                            >✕</button>
                          )}
                          <button
                            className="btn btn--ghost btn--xs"
                            onClick={() => {
                              setEditingTransform(fm.id);
                              setPendingTransform(fm.transform.type);
                            }}
                            disabled={isSaving}
                            title="Edit transform"
                          >⚙</button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr className="mapping-detail-row">
                        <td colSpan={onSelectionChange ? 7 : 6}>
                          <div className="mapping-detail">
                            {schemaInsights.findings.length > 0 && (
                              <div className="mapping-detail-section mapping-detail-section--full">
                                <div className="mapping-detail-label">Schema Intelligence</div>
                                <div className="schema-intelligence-detail-list">
                                  {schemaInsights.findings.map((finding, index) => (
                                    <div
                                      key={`${finding.kind}-${index}`}
                                      className={`schema-intelligence-detail-item is-${finding.tone}`}
                                    >
                                      <div className="schema-intelligence-detail-head">
                                        <SchemaIntelligenceBadge
                                          label={finding.label}
                                          tone={finding.tone}
                                          title={finding.text}
                                        />
                                      </div>
                                      <div className="mapping-detail-value">{finding.text}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {schemaInsights.flags.formulaTarget && (
                              <div className="mapping-detail-section mapping-detail-section--full">
                                <div className="schema-intelligence-callout is-danger">
                                  <div>
                                    <div className="schema-intelligence-callout-title">Formula target warning</div>
                                    <div className="schema-intelligence-callout-body">
                                      This target field is calculated in Salesforce. Inbound writes will not persist unless
                                      you map the fields that feed the formula instead.
                                    </div>
                                  </div>
                                  {isFormulaAcknowledged ? (
                                    <SchemaIntelligenceBadge
                                      label="Acknowledged"
                                      tone="success"
                                      title="This formula-target warning has been acknowledged for export gating."
                                    />
                                  ) : (
                                    onAcknowledgeFormulaWarning && (
                                      <button
                                        className="btn btn--danger btn--sm"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onAcknowledgeFormulaWarning(fm.id);
                                        }}
                                      >
                                        Acknowledge warning
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>
                            )}
                            {schemaInsights.flags.oneToMany && (
                              <div className="mapping-detail-section mapping-detail-section--full">
                                <div className="schema-intelligence-callout is-warning">
                                  <div>
                                    <div className="schema-intelligence-callout-title">Routing decision required</div>
                                    <div className="schema-intelligence-callout-body">
                                      This source field appears in the BOSL corpus against multiple Salesforce targets.
                                      Confirm this target matches the intended lifecycle stage before accepting or exporting.
                                    </div>
                                  </div>
                                  <button
                                    className="btn btn--secondary btn--sm"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setFocusedMappingId(fm.id);
                                    }}
                                  >
                                    Review routing
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="mapping-detail-section">
                              <div className="mapping-detail-label">Rationale</div>
                              <div className="mapping-detail-value">{fm.rationale || '—'}</div>
                            </div>
                            {(srcF?.jxchangeXPath || srcF?.iso20022Name) && (
                              <div className="mapping-detail-section">
                                <div className="mapping-detail-label">Source metadata</div>
                                {srcF.jxchangeXPath && (
                                  <div className="mapping-detail-mono">XPath: {srcF.jxchangeXPath}</div>
                                )}
                                {srcF.iso20022Name && (
                                  <div className="mapping-detail-mono">ISO 20022: {srcF.iso20022Name}</div>
                                )}
                              </div>
                            )}
                            {uniqueTags.length > 0 && (
                              <div className="mapping-detail-section">
                                <div className="mapping-detail-label">Compliance tags</div>
                                <div className="compliance-tags">
                                  {uniqueTags.map((t) => <CompliancePill key={t} tag={t} />)}
                                </div>
                                {(srcF?.complianceNote || tgtF?.complianceNote) && (
                                  <div className="mapping-detail-note">
                                    {srcF?.complianceNote ?? tgtF?.complianceNote}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Export footer bar */}
      {onProceedToExport && (
        <div className="mapping-export-bar">
          <div className="mapping-export-bar-summary">
            <span className="mapping-export-bar-count">
              {fieldMappings.filter(fm => fm.status === 'accepted').length} accepted
            </span>
            <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
            <span className="mapping-export-bar-count" style={{ color: validation.summary.totalWarnings > 0 ? 'var(--amber)' : 'var(--text-secondary)' }}>
              {validation.summary.totalWarnings} warning{validation.summary.totalWarnings !== 1 ? 's' : ''}
            </span>
            {pendingFormulaAcknowledgements.length > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
                <span className="mapping-export-bar-count" style={{ color: 'var(--danger)' }}>
                  {pendingFormulaAcknowledgements.length} formula acknowledgement{pendingFormulaAcknowledgements.length === 1 ? '' : 's'} pending
                </span>
              </>
            )}
          </div>
          <button className="btn btn--primary" onClick={onProceedToExport}>
            Proceed to Export
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 6 }}>
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}
