import React, { useState, useMemo } from 'react';
import { Entity, Field, EntityMapping, FieldMapping, ValidationReport } from '../types';
import { api } from '../api/client';

interface MappingTableProps {
  projectId: string;
  sourceEntities: Entity[];
  targetEntities: Entity[];
  fields: Field[];
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
  onMappingUpdate: (updated: FieldMapping) => void;
  onProceedToExport?: () => void;
}

type StatusFilter = 'all' | 'suggested' | 'accepted' | 'rejected' | 'modified';
const TRANSFORM_OPTIONS = ['direct', 'concat', 'formatDate', 'lookup', 'static', 'regex', 'split', 'trim'];

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
  return <span className={`badge ${cls}`} style={{ fontSize: '10px', padding: '2px 6px' }}>{tag}</span>;
}

function StatusBadge({ status }: { status: FieldMapping['status'] }) {
  const map: Record<string, string> = {
    suggested: 'status-suggested',
    accepted: 'status-accepted',
    rejected: 'status-rejected',
    modified: 'status-modified',
  };
  return <span className={`status-badge ${map[status] ?? ''}`}>{status}</span>;
}

export function MappingTable({
  projectId,
  sourceEntities,
  targetEntities,
  fields,
  entityMappings,
  fieldMappings,
  validation,
  onMappingUpdate,
  onProceedToExport,
}: MappingTableProps) {
  const [activeEntityMappingId, setActiveEntityMappingId] = useState<string>(
    entityMappings[0]?.id ?? '',
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingTransform, setEditingTransform] = useState<string | null>(null);
  const [pendingTransform, setPendingTransform] = useState<string>('direct');
  const [saving, setSaving] = useState<string | null>(null);

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

  // Counts for active entity
  const entityFMs = fieldMappings.filter((fm) => fm.entityMappingId === activeEntityMappingId);
  const acceptedCount = entityFMs.filter((fm) => fm.status === 'accepted').length;
  const rejectedCount = entityFMs.filter((fm) => fm.status === 'rejected').length;
  const totalCount = entityFMs.length;

  async function patchStatus(fm: FieldMapping, newStatus: FieldMapping['status']) {
    setSaving(fm.id);
    try {
      const updated = await api<FieldMapping>(`/api/field-mappings/${fm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      onMappingUpdate(updated);
    } catch {
      // Optimistic fallback — update locally
      onMappingUpdate({ ...fm, status: newStatus });
    } finally {
      setSaving(null);
    }
  }

  async function patchTransform(fm: FieldMapping, newType: string) {
    setSaving(fm.id);
    try {
      const updated = await api<FieldMapping>(`/api/field-mappings/${fm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ transform: { type: newType, config: {} }, status: 'modified' }),
      });
      onMappingUpdate(updated);
    } catch {
      onMappingUpdate({ ...fm, transform: { type: newType as FieldMapping['transform']['type'], config: {} }, status: 'modified' });
    } finally {
      setSaving(null);
      setEditingTransform(null);
    }
  }

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
      <div className="page-header">
        <div>
          <h1 className="page-title">Review Mappings</h1>
          <p className="page-subtitle">
            Inspect every field mapping, adjust transforms, and accept or reject suggestions.
          </p>
        </div>
        {/* Global summary */}
        <div className="mapping-global-stats">
          <div className="mapping-global-stat">
            <span className="mapping-global-value">{fieldMappings.length}</span>
            <span className="mapping-global-label">Total</span>
          </div>
          <div className="mapping-global-stat">
            <span className="mapping-global-value" style={{ color: 'var(--success)' }}>
              {fieldMappings.filter((fm) => fm.status === 'accepted').length}
            </span>
            <span className="mapping-global-label">Accepted</span>
          </div>
          <div className="mapping-global-stat">
            <span className="mapping-global-value" style={{ color: 'var(--danger)' }}>
              {fieldMappings.filter((fm) => fm.status === 'rejected').length}
            </span>
            <span className="mapping-global-label">Rejected</span>
          </div>
          {validation.summary.totalWarnings > 0 && (
            <div className="mapping-global-stat">
              <span className="mapping-global-value" style={{ color: 'var(--warning)' }}>
                {validation.summary.totalWarnings}
              </span>
              <span className="mapping-global-label">Warnings</span>
            </div>
          )}
        </div>
      </div>

      {/* Validation warnings */}
      {validation.summary.totalWarnings > 0 && (
        <div className="validation-box validation-box--warn" style={{ marginBottom: '24px' }}>
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
          {(['all', 'suggested', 'accepted', 'rejected', 'modified'] as StatusFilter[]).map((f) => (
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
                <th>Source field</th>
                <th>Target field</th>
                <th>Transform</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleMappings.map((fm) => {
                const srcF = fieldMap.get(fm.sourceFieldId);
                const tgtF = fieldMap.get(fm.targetFieldId);
                const isExpanded = expandedRow === fm.id;
                const isSaving = saving === fm.id;
                const allTags = [...(srcF?.complianceTags ?? []), ...(tgtF?.complianceTags ?? [])];
                const uniqueTags = [...new Set(allTags)];

                return (
                  <React.Fragment key={fm.id}>
                    <tr
                      className={`mapping-row ${isExpanded ? 'mapping-row--expanded' : ''} ${isSaving ? 'mapping-row--saving' : ''}`}
                      onClick={() => setExpandedRow(isExpanded ? null : fm.id)}
                    >
                      {/* Source field */}
                      <td>
                        <div className="field-cell">
                          <span className="field-name">{srcF?.name ?? fm.sourceFieldId}</span>
                          <span className="field-type-badge">{srcF?.dataType ?? '?'}</span>
                        </div>
                        {srcF?.required && <span className="field-required-dot" title="Required">●</span>}
                      </td>

                      {/* Target field */}
                      <td>
                        <div className="field-cell">
                          <span className="field-name">{tgtF?.name ?? fm.targetFieldId}</span>
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
                          <span className="transform-badge">{fm.transform.type}</span>
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
                                <span className="badge badge--gray" style={{ fontSize: '10px' }}>
                                  +{uniqueTags.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="action-btns">
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
                        <td colSpan={6}>
                          <div className="mapping-detail">
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
          </div>
          <button className="btn btn--primary" onClick={onProceedToExport}>
            Proceed to Export
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 6 }}>
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
