import React, { useEffect, useMemo, useState } from 'react';
import {
  Entity,
  ExportFormat,
  ExportFormatDef,
  Field,
  FieldMapping,
  ValidationReport,
} from '@contracts';
import { api, API_BASE, isDemoUiMode } from '@core/api-client';

const FORMATS: ExportFormatDef[] = [
  {
    id: 'json',
    label: 'Canonical JSON',
    description: 'Machine-readable mapping spec. Ideal for REST payloads and point-to-point integrations.',
    ext: '.json',
    category: 'standard',
  },
  {
    id: 'yaml',
    label: 'YAML',
    description: 'Human-readable diffs. Import into Git pull requests for schema-change review.',
    ext: '.yaml',
    category: 'standard',
  },
  {
    id: 'csv',
    label: 'CSV',
    description: 'Business analyst review in Excel. Source field → target field with confidence and rationale.',
    ext: '.csv',
    category: 'standard',
  },
  {
    id: 'dataweave',
    label: 'MuleSoft DataWeave',
    description: 'Drop directly into a Transform Message component in Anypoint Studio. Type-safe expressions included.',
    ext: '.dwl',
    category: 'ipaas',
  },
  {
    id: 'boomi',
    label: 'Dell Boomi XML',
    description: 'Import as a Map component in a Boomi Process. Field profiles and transformations pre-configured.',
    ext: '.xml',
    category: 'ipaas',
  },
  {
    id: 'workato',
    label: 'Workato Recipe',
    description: 'Ready-to-import Workato recipe with datapill expressions for each mapped field.',
    ext: '.json',
    category: 'ipaas',
  },
];

const FORMAT_ICONS: Record<ExportFormat, string> = {
  json: '{ }',
  yaml: '≡',
  csv: '⊞',
  dataweave: 'DW',
  boomi: 'BM',
  workato: 'WR',
};

const FORMAT_ICON_COLORS: Record<ExportFormat, string> = {
  json: '#16A34A',
  yaml: '#0284C7',
  csv: '#7C3AED',
  dataweave: '#2563EB',
  boomi: '#0891B2',
  workato: '#7C3AED',
};

interface ExportPanelProps {
  projectId: string;
  fieldMappingCount: number;
  entityMappingCount: number;
  acceptedCount: number;
  validation: ValidationReport;
  fields: Field[];
  fieldMappings: FieldMapping[];
  targetEntities: Entity[];
}

export function ExportPanel({
  projectId,
  fieldMappingCount,
  entityMappingCount,
  acceptedCount,
  validation,
  fields,
  fieldMappings,
  targetEntities,
}: ExportPanelProps) {
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const [lastDownloaded, setLastDownloaded] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [overrideRequiredBlockers, setOverrideRequiredBlockers] = useState(false);

  const preflight = useMemo(() => {
    const complianceTags = ['GLBA_NPI', 'BSA_AML', 'SOX_FINANCIAL', 'FFIEC_AUDIT', 'PCI_CARD'] as const;
    const targetEntityIds = new Set(targetEntities.map((entity) => entity.id));
    const targetFields = fields.filter((field) => targetEntityIds.has(field.entityId));
    const requiredTargetFields = targetFields.filter((field) => field.required);
    const targetFieldIds = new Set(targetFields.map((field) => field.id));
    const targetFieldById = new Map(targetFields.map((field) => [field.id, field]));
    const scopedMappings = fieldMappings.filter((mapping) => targetFieldIds.has(mapping.targetFieldId));
    const activeMappings = scopedMappings.filter(
      (mapping) => mapping.status !== 'rejected' && mapping.status !== 'unmatched',
    );
    const mappingsByTargetField = new Map<string, FieldMapping[]>();
    for (const mapping of activeMappings) {
      const existing = mappingsByTargetField.get(mapping.targetFieldId) ?? [];
      existing.push(mapping);
      mappingsByTargetField.set(mapping.targetFieldId, existing);
    }

    const mappingRank: Record<FieldMapping['status'], number> = {
      accepted: 0,
      modified: 1,
      suggested: 2,
      rejected: 3,
      unmatched: 4,
    };

    const pickPrimaryMapping = (mappings: FieldMapping[]): FieldMapping | null => {
      if (mappings.length === 0) return null;
      const sorted = [...mappings].sort(
        (a, b) => mappingRank[a.status] - mappingRank[b.status] || b.confidence - a.confidence,
      );
      return sorted[0] ?? null;
    };

    const unmappedRequiredFields = requiredTargetFields.filter((field) => {
      const mappings = mappingsByTargetField.get(field.id) ?? [];
      return mappings.length === 0;
    });

    const lowConfidenceRequiredMappings = requiredTargetFields
      .map((field) => {
        const mapping = pickPrimaryMapping(mappingsByTargetField.get(field.id) ?? []);
        if (!mapping) return null;
        if (mapping.confidence >= 0.6 || mapping.status === 'accepted') return null;
        return { field, mapping };
      })
      .filter((item): item is { field: Field; mapping: FieldMapping } => item !== null);

    const mappedTargetFieldIds = new Set(activeMappings.map((mapping) => mapping.targetFieldId));
    const mappedTargetCount = targetFields.filter((field) => mappedTargetFieldIds.has(field.id)).length;
    const acceptedMappingsCount = scopedMappings.filter((mapping) => mapping.status === 'accepted').length;
    const suggestedMappingsCount = scopedMappings.filter(
      (mapping) => mapping.status === 'suggested' || mapping.status === 'modified',
    ).length;
    const rejectedMappingsCount = scopedMappings.filter((mapping) => mapping.status === 'rejected').length;

    const complianceSummary = complianceTags.reduce<Record<(typeof complianceTags)[number], number>>(
      (acc, tag) => ({ ...acc, [tag]: 0 }),
      { GLBA_NPI: 0, BSA_AML: 0, SOX_FINANCIAL: 0, FFIEC_AUDIT: 0, PCI_CARD: 0 },
    );

    for (const mapping of scopedMappings) {
      if (mapping.status !== 'accepted') continue;
      const targetField = targetFieldById.get(mapping.targetFieldId);
      if (!targetField?.complianceTags?.length) continue;
      for (const rawTag of targetField.complianceTags) {
        if (rawTag in complianceSummary) {
          const tag = rawTag as keyof typeof complianceSummary;
          complianceSummary[tag] += 1;
        }
      }
    }

    return {
      requiredTargetFields,
      unmappedRequiredFields,
      lowConfidenceRequiredMappings,
      mappedTargetCount,
      targetFieldCount: targetFields.length,
      acceptedMappingsCount,
      suggestedMappingsCount,
      rejectedMappingsCount,
      complianceSummary,
    };
  }, [fields, fieldMappings, targetEntities]);

  const requiredBlockersSignature = preflight.unmappedRequiredFields.map((field) => field.id).join(',');
  useEffect(() => {
    setOverrideRequiredBlockers(false);
  }, [requiredBlockersSignature]);

  const hasRequiredBlockers = preflight.unmappedRequiredFields.length > 0;
  const exportBlocked = hasRequiredBlockers && !overrideRequiredBlockers;

  async function handleDownload(format: ExportFormat) {
    if (exportBlocked) return;
    setDownloading(format);
    try {
      setExportError(null);
      const fmt = FORMATS.find((candidate) => candidate.id === format)!;
      const filename = `automapper-export-${format}${fmt.ext}`;

      let blob: Blob;
      if (isDemoUiMode()) {
        const content = await api<string>(`/api/projects/${projectId}/export?format=${format}`);
        blob = new Blob([content], { type: 'application/octet-stream' });
      } else {
        const url = `${API_BASE}/api/projects/${projectId}/export?format=${format}`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          throw new Error(`Export failed: ${resp.status}`);
        }
        blob = await resp.blob();
      }

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setLastDownloaded(format);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  const standardFmts = FORMATS.filter((f) => f.category === 'standard');
  const ipaaSFmts = FORMATS.filter((f) => f.category === 'ipaas');

  const pendingReview = fieldMappingCount - acceptedCount;
  const hasWarnings = validation.summary.totalWarnings > 0;

  return (
    <div className="export-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Export Integration Spec</h1>
          <p className="page-subtitle">
            Choose a format that matches your integration platform. All formats include compliance tags and
            transform logic.
          </p>
        </div>
      </div>

      {/* Summary card */}
      <div className="export-summary-card">
        <div className="export-summary-stat">
          <span className="export-summary-value">{entityMappingCount}</span>
          <span className="export-summary-label">Entities</span>
        </div>
        <div className="export-summary-divider" />
        <div className="export-summary-stat">
          <span className="export-summary-value">{fieldMappingCount}</span>
          <span className="export-summary-label">Field mappings</span>
        </div>
        <div className="export-summary-divider" />
        <div className="export-summary-stat">
          <span className="export-summary-value" style={{ color: 'var(--success)' }}>{acceptedCount}</span>
          <span className="export-summary-label">Accepted</span>
        </div>
        <div className="export-summary-divider" />
        <div className="export-summary-stat">
          <span
            className="export-summary-value"
            style={{ color: hasWarnings ? 'var(--warning)' : 'var(--text-secondary)' }}
          >
            {validation.summary.totalWarnings}
          </span>
          <span className="export-summary-label">Warnings</span>
        </div>
      </div>

      {/* Pre-flight export gate */}
      <div
        className={`validation-box ${exportBlocked ? 'validation-box--error' : hasRequiredBlockers || preflight.lowConfidenceRequiredMappings.length ? 'validation-box--warn' : 'validation-box--clean'}`}
        style={{ marginBottom: '20px' }}
      >
        <div className="validation-box-title">Pre-flight checks</div>
        <div className="export-preflight-grid">
          <div className="export-preflight-item">
            <div className="export-preflight-label">Coverage</div>
            <div className="export-preflight-value">
              {preflight.mappedTargetCount} of {preflight.targetFieldCount} target fields mapped
            </div>
            <div className="export-preflight-meta">
              {preflight.acceptedMappingsCount} accepted, {preflight.suggestedMappingsCount} suggested, {preflight.rejectedMappingsCount} rejected
            </div>
          </div>
          <div className="export-preflight-item">
            <div className="export-preflight-label">Compliance readiness (accepted mappings)</div>
            <div className="export-preflight-tags">
              {Object.entries(preflight.complianceSummary).map(([tag, count]) => (
                <span key={tag} className="export-preflight-tag">
                  <span className="export-preflight-tag-name">{tag}</span>
                  <span className="export-preflight-tag-count">{count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {hasRequiredBlockers && (
          <div className="export-preflight-blockers">
            <div className="export-preflight-blocker-title">
              Required target fields missing mappings ({preflight.unmappedRequiredFields.length})
            </div>
            <ul className="validation-warn-list">
              {preflight.unmappedRequiredFields.map((field) => (
                <li key={field.id}>{field.label || field.name}</li>
              ))}
            </ul>
            <label className="export-preflight-override">
              <input
                type="checkbox"
                checked={overrideRequiredBlockers}
                onChange={(event) => setOverrideRequiredBlockers(event.target.checked)}
              />
              I understand these required fields are unmapped — export anyway
            </label>
          </div>
        )}

        {preflight.lowConfidenceRequiredMappings.length > 0 && (
          <div className="export-preflight-warnings">
            <div className="export-preflight-warn-title">
              Low-confidence required mappings ({preflight.lowConfidenceRequiredMappings.length})
            </div>
            <ul className="validation-warn-list">
              {preflight.lowConfidenceRequiredMappings.map(({ field, mapping }) => (
                <li key={`${field.id}-${mapping.id}`}>
                  {(field.label || field.name)} is {Math.round(mapping.confidence * 100)}% confidence ({mapping.status})
                </li>
              ))}
            </ul>
          </div>
        )}

        {exportBlocked ? (
          <p className="export-preflight-footnote">
            Export is blocked until all required target fields are mapped, or you explicitly confirm the override.
          </p>
        ) : (
          <p className="export-preflight-footnote">
            Export gate passed.
          </p>
        )}
      </div>

      {/* Pre-export checklist */}
      {(pendingReview > 0 || hasWarnings) && (
        <div className={`validation-box ${hasWarnings ? 'validation-box--warn' : 'validation-box--info'}`}
             style={{ marginBottom: '32px' }}>
          <div className="validation-box-title">Before you export</div>
          <ul className="validation-warn-list">
            {pendingReview > 0 && (
              <li>{pendingReview} field mapping{pendingReview !== 1 ? 's' : ''} still in "suggested" state — consider reviewing them in the Review tab.</li>
            )}
            {validation.summary.typeMismatch > 0 && (
              <li>{validation.summary.typeMismatch} type mismatch{validation.summary.typeMismatch !== 1 ? 'es' : ''} — target fields may need a transform.</li>
            )}
            {validation.summary.missingRequired > 0 && (
              <li>{validation.summary.missingRequired} required target field{validation.summary.missingRequired !== 1 ? 's' : ''} have no source mapping.</li>
            )}
            {validation.summary.picklistCoverage > 0 && (
              <li>{validation.summary.picklistCoverage} picklist gap{validation.summary.picklistCoverage !== 1 ? 's' : ''} — some target picklist values have no source equivalent.</li>
            )}
          </ul>
        </div>
      )}

      {/* Standard formats */}
      <div className="export-section">
        <div className="export-section-header">
          <h2 className="export-section-title">Standard formats</h2>
          <p className="export-section-desc">For review, version control, and custom integration pipelines.</p>
        </div>
        <div className="export-cards">
          {standardFmts.map((fmt) => (
            <ExportCard
              key={fmt.id}
              fmt={fmt}
              icon={FORMAT_ICONS[fmt.id]}
              iconColor={FORMAT_ICON_COLORS[fmt.id]}
              downloading={downloading === fmt.id}
              downloaded={lastDownloaded === fmt.id}
              blocked={exportBlocked}
              onDownload={() => handleDownload(fmt.id)}
            />
          ))}
        </div>
      </div>

      {/* iPaaS formats */}
      <div className="export-section">
        <div className="export-section-header">
          <h2 className="export-section-title">iPaaS integration platforms</h2>
          <p className="export-section-desc">
            Drop-in artifacts for your integration platform — no manual field mapping required.
          </p>
        </div>
        <div className="export-cards">
          {ipaaSFmts.map((fmt) => (
            <ExportCard
              key={fmt.id}
              fmt={fmt}
              icon={FORMAT_ICONS[fmt.id]}
              iconColor={FORMAT_ICON_COLORS[fmt.id]}
              downloading={downloading === fmt.id}
              downloaded={lastDownloaded === fmt.id}
              blocked={exportBlocked}
              onDownload={() => handleDownload(fmt.id)}
              ipaas
            />
          ))}
        </div>
      </div>

      {exportError && <p className="export-error">{exportError}</p>}

      {/* Footer note */}
      <div className="export-footer-note">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7v4M8 5.5V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>
          All exports include compliance tags (GLBA, BSA/AML, PCI-DSS, SOX, FFIEC) so downstream integration
          teams know which fields require masking, encryption, or audit logging.
        </span>
      </div>
    </div>
  );
}

// ─── Export card subcomponent ────────────────────────────────────────────────

interface ExportCardProps {
  fmt: ExportFormatDef;
  icon: string;
  iconColor: string;
  downloading: boolean;
  downloaded: boolean;
  blocked: boolean;
  onDownload: () => void;
  ipaas?: boolean;
}

function ExportCard({
  fmt,
  icon,
  iconColor,
  downloading,
  downloaded,
  blocked,
  onDownload,
  ipaas,
}: ExportCardProps) {
  return (
    <div className={`export-card ${ipaas ? 'ipaas' : ''}`}>
      <div className="export-card-icon" style={{ background: `${iconColor}15`, color: iconColor }}>
        {icon}
      </div>
      <div className="export-card-body">
        <div className="export-card-title">{fmt.label}</div>
        <p className="export-card-desc">{fmt.description}</p>
      </div>
      <button
        className={`btn ${downloaded ? 'btn--secondary' : 'btn--primary'} export-card-btn`}
        onClick={onDownload}
        disabled={downloading || blocked}
      >
        {blocked ? (
          <>Blocked by pre-flight</>
        ) : downloading ? (
          <>
            <span className="btn-spinner" />
            Exporting…
          </>
        ) : downloaded ? (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7l4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Downloaded
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v7M4 6l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Download {fmt.ext}
          </>
        )}
      </button>
    </div>
  );
}
