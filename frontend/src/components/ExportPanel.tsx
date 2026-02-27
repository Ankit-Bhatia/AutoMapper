import React, { useState } from 'react';
import { ExportFormat, ExportFormatDef, ValidationReport } from '../types';
import { apiBase } from '../api/client';

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
}

export function ExportPanel({
  projectId,
  fieldMappingCount,
  entityMappingCount,
  acceptedCount,
  validation,
}: ExportPanelProps) {
  const [downloading, setDownloading] = useState<ExportFormat | null>(null);
  const [lastDownloaded, setLastDownloaded] = useState<ExportFormat | null>(null);

  async function handleDownload(format: ExportFormat) {
    setDownloading(format);
    try {
      const url = `${apiBase()}/api/projects/${projectId}/export?format=${format}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const blob = await resp.blob();
      const fmt = FORMATS.find((f) => f.id === format)!;
      const filename = `automapper-export-${format}${fmt.ext}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setLastDownloaded(format);
    } catch (e) {
      console.error('Export error:', e);
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
              onDownload={() => handleDownload(fmt.id)}
              ipaas
            />
          ))}
        </div>
      </div>

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
  onDownload: () => void;
  ipaas?: boolean;
}

function ExportCard({ fmt, icon, iconColor, downloading, downloaded, onDownload, ipaas }: ExportCardProps) {
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
        disabled={downloading}
      >
        {downloading ? (
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
