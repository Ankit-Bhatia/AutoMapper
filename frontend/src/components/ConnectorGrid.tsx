import React, { useState } from 'react';
import { ConnectorDefinition } from '../types';

// Static connector catalogue (matches demo-server.mjs + production connectors)
const CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'jackhenry-silverlake',
    name: 'SilverLake',
    vendor: 'Jack Henry',
    category: 'core-banking',
    description: 'Commercial banking core — CIF, DDA, Loans with full jXchange XPath and ISO 20022 support.',
    logoClass: 'logo-jh-sl',
    entities: ['CIF', 'DDA', 'LoanAccount', 'GLAccount'],
  },
  {
    id: 'jackhenry-coredirector',
    name: 'Core Director',
    vendor: 'Jack Henry',
    category: 'core-banking',
    description: 'Community banking core — numeric AcctType codes, Indv/Bus CustomerType short codes.',
    logoClass: 'logo-jh-cd',
    entities: ['CIF', 'DDA', 'LoanAccount', 'GLAccount'],
  },
  {
    id: 'jackhenry-symitar',
    name: 'Symitar / Episys',
    vendor: 'Jack Henry',
    category: 'credit-union',
    description: 'Credit union core — Member, Share, Loan, Card with PCI-DSS compliance tags.',
    logoClass: 'logo-jh-sym',
    entities: ['Member', 'Share', 'Loan', 'Card'],
  },
  {
    id: 'salesforce',
    name: 'Salesforce CRM',
    vendor: 'Salesforce',
    category: 'crm',
    description: 'Account, Contact, Opportunity objects via Salesforce Metadata API.',
    logoClass: 'logo-sf',
    entities: ['Account', 'Contact', 'Opportunity'],
  },
  {
    id: 'sap',
    name: 'SAP S/4HANA',
    vendor: 'SAP',
    category: 'erp',
    description: 'BusinessPartner and GLAccount entities via OData Metadata and IDOC parsing.',
    logoClass: 'logo-sap',
    entities: ['BusinessPartner', 'GLAccount'],
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  'core-banking': 'Core Banking',
  'credit-union': 'Credit Union',
  crm: 'CRM',
  erp: 'ERP',
};

interface ConnectorGridProps {
  onProceed: (
    sourceId: string,
    targetId: string,
    options?: { projectName?: string; sourceFile?: File | null; targetFile?: File | null },
  ) => void;
  loading?: boolean;
}

export function ConnectorGrid({ onProceed, loading = false }: ConnectorGridProps) {
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);

  function handleCardClick(id: string) {
    if (source === id) {
      // Deselect source
      setSource(null);
      return;
    }
    if (target === id) {
      // Deselect target
      setTarget(null);
      return;
    }
    if (!source) {
      setSource(id);
      return;
    }
    if (!target) {
      setTarget(id);
      return;
    }
    // Both selected — replace source, clear target
    setSource(id);
    setTarget(null);
  }

  function getCardRole(id: string): 'source' | 'target' | null {
    if (source === id) return 'source';
    if (target === id) return 'target';
    return null;
  }

  const canProceed = !!(source && target) && !loading;

  function handleProceed() {
    if (canProceed) {
      onProceed(source!, target!, {
        projectName: projectName.trim() || undefined,
        sourceFile,
        targetFile,
      });
    }
  }

  return (
    <div className="connector-grid-page">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Connect Systems</h1>
          <p className="page-subtitle">
            Select a <strong>source</strong> system, then a <strong>target</strong> system. AutoMapper will discover
            their schemas and build a mapping spec.
          </p>
        </div>
      </div>

      {/* Selection legend */}
      <div className="connector-legend">
        <div className={`legend-pill legend-pill--source ${source ? 'legend-pill--set' : ''}`}>
          <span className="legend-dot legend-dot--source" />
          {source
            ? CONNECTORS.find((c) => c.id === source)?.name ?? source
            : 'Select source (click first)'}
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className={`legend-pill legend-pill--target ${target ? 'legend-pill--set' : ''}`}>
          <span className="legend-dot legend-dot--target" />
          {target
            ? CONNECTORS.find((c) => c.id === target)?.name ?? target
            : 'Select target (click second)'}
        </div>
      </div>

      {/* Connector cards grid */}
      <div className="connector-grid">
        {CONNECTORS.map((c) => {
          const role = getCardRole(c.id);
          return (
            <button
              key={c.id}
              className={`connector-card ${role === 'source' ? 'sel-source' : ''} ${role === 'target' ? 'sel-target' : ''}`}
              onClick={() => handleCardClick(c.id)}
              type="button"
            >
              {/* Selection badge */}
              {role && (
                <span className={`connector-role-badge ${role === 'source' ? 'badge-source' : 'badge-target'}`}>
                  {role === 'source' ? 'Source' : 'Target'}
                </span>
              )}

              {/* Logo */}
              <div className={`connector-logo ${c.logoClass}`}>
                {c.vendor === 'Jack Henry' && 'JH'}
                {c.vendor === 'Salesforce' && 'SF'}
                {c.vendor === 'SAP' && 'SAP'}
              </div>

              {/* Info */}
              <div className="connector-card-body">
                <div className="connector-card-header">
                  <span className="connector-name">{c.name}</span>
                  <span className="badge badge--gray connector-category">
                    {CATEGORY_LABELS[c.category] ?? c.category}
                  </span>
                </div>
                <p className="connector-vendor">{c.vendor}</p>
                <p className="connector-description">{c.description}</p>
                <div className="connector-entities">
                  {c.entities.map((e) => (
                    <span key={e} className="connector-entity-tag">{e}</span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Project name + proceed */}
      {source && target && (
        <div className="connector-proceed-bar">
          <div className="connector-proceed-inner">
            <div className="connector-proceed-left">
              <label className="form-label" htmlFor="project-name">
                Project name <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="project-name"
                className="form-input connector-name-input"
                type="text"
                placeholder={`${CONNECTORS.find((c) => c.id === source)?.name} → ${CONNECTORS.find((c) => c.id === target)?.name}`}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <div className="connector-upload-row">
                <label className="connector-upload-field">
                  <span className="form-label">Source schema file (optional)</span>
                  <input
                    className="form-input"
                    type="file"
                    accept=".csv,.json,.xml,text/csv,application/json,application/xml,text/xml"
                    onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="connector-upload-hint">{sourceFile ? sourceFile.name : 'Upload .csv, .json, or .xml'}</span>
                </label>
                <label className="connector-upload-field">
                  <span className="form-label">Target schema file (optional)</span>
                  <input
                    className="form-input"
                    type="file"
                    accept=".csv,.json,.xml,text/csv,application/json,application/xml,text/xml"
                    onChange={(e) => setTargetFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="connector-upload-hint">{targetFile ? targetFile.name : 'Upload .csv, .json, or .xml'}</span>
                </label>
              </div>
            </div>
            <button
              className="btn btn--primary btn--lg"
              onClick={handleProceed}
              disabled={!canProceed}
            >
              {loading ? (
                <>
                  <span className="btn-spinner" />
                  Creating project…
                </>
              ) : (
                <>
                  Discover schemas
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
          <p className="connector-proceed-note">
            AutoMapper will ingest both schemas and prepare them for the 7-agent orchestration pipeline. Uploaded files
            take priority for their selected side.
          </p>
        </div>
      )}
    </div>
  );
}
