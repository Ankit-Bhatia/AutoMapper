import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface LandingPageProps {
  onEnterStudio: () => void;
}

interface UseCaseCard {
  id: string;
  title: string;
  route: string;
  description: string;
  outcomes: string[];
}

interface AgentStage {
  id: string;
  name: string;
  role: string;
}

const USE_CASES: UseCaseCard[] = [
  {
    id: 'banking-crm',
    title: 'Core Banking → Salesforce FSC',
    route: 'SilverLake / Core Director → Financial Services Cloud',
    description:
      'Map CIF, DDA, Loan, and GL structures into PartyProfile + FinancialAccount with compliance-aware transformations.',
    outcomes: [
      'Domain-specific entity alignment',
      'Field-level relevance scoring',
      'Exportable integration spec',
    ],
  },
  {
    id: 'sap-crm',
    title: 'SAP → Salesforce',
    route: 'SAP S/4HANA → Salesforce CRM',
    description:
      'Convert ERP-centric business entities into CRM-ready data models with type-safe transforms and validation.',
    outcomes: [
      'Schema upload or connector ingest',
      'Heuristic + agentic mapping',
      'Review-ready mapping rationale',
    ],
  },
  {
    id: 'secure-bypass',
    title: 'Secure Environment Bypass',
    route: 'Locked-down source systems -> Uploaded schema files',
    description:
      'Ingest CSV, JSON, or XML schema files directly when live connectors are restricted by network or policy controls.',
    outcomes: [
      'No direct system access required',
      'Source/target schema upload flow',
      'Same mapping pipeline and export outputs',
    ],
  },
];

const AGENT_STAGES: AgentStage[] = [
  { id: 'schema', name: 'SchemaDiscoveryAgent', role: 'Normalises SAP + Salesforce schemas' },
  { id: 'compliance', name: 'ComplianceAgent', role: 'Flags GLBA / SOX / PCI-relevant fields' },
  { id: 'banking', name: 'BankingDomainAgent', role: 'Understands Jack Henry core semantics' },
  { id: 'crm', name: 'CRMDomainAgent', role: 'Optimises for Salesforce FSC objects' },
  { id: 'erp', name: 'ERPDomainAgent', role: 'Adds SAP S/4HANA field context' },
  { id: 'proposal', name: 'MappingProposalAgent', role: 'Scores candidate field mappings' },
  { id: 'validation', name: 'ValidationAgent', role: 'Checks types, coverage, and gaps' },
];

function estimateMetrics(complexity: number): { fields: number; autoCoverage: number; reviewItems: number } {
  const fields = Math.round(140 + complexity * 8.6);
  const autoCoverage = Math.max(62, Math.min(96, Math.round(92 - complexity * 0.22)));
  const reviewItems = Math.max(8, Math.round(fields * (100 - autoCoverage) * 0.008));
  return { fields, autoCoverage, reviewItems };
}

function estimateStageDurations(complexity: number): Array<{ id: string; label: string; ms: number }> {
  return [
    { id: 'extract', label: 'Extract + normalize schemas', ms: Math.round(420 + complexity * 6.2) },
    { id: 'entity', label: 'Entity alignment', ms: Math.round(360 + complexity * 5.1) },
    { id: 'field', label: 'Field reasoning + transforms', ms: Math.round(520 + complexity * 7.4) },
    { id: 'validate', label: 'Validation + compliance checks', ms: Math.round(260 + complexity * 3.8) },
  ];
}

function AutoMapperLogomark({ size = 26, className = 'sidebar-logo-svg' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className} aria-hidden>
      <path
        d="M14 2L25 8.5v11L14 26 3 19.5v-11L14 2z"
        stroke="var(--primary)"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="8" y1="10" x2="20" y2="18" stroke="var(--primary)" strokeWidth="1.2" opacity="0.7" />
      <line x1="8" y1="18" x2="20" y2="10" stroke="var(--primary)" strokeWidth="1.2" opacity="0.4" />
      <circle cx="8" cy="10" r="1.5" fill="var(--primary)" />
      <circle cx="20" cy="10" r="1.5" fill="var(--primary)" opacity="0.7" />
      <circle cx="8" cy="18" r="1.5" fill="var(--primary)" opacity="0.7" />
      <circle cx="20" cy="18" r="1.5" fill="var(--primary)" />
    </svg>
  );
}

export function LandingPage({ onEnterStudio }: LandingPageProps) {
  const [activeUseCase, setActiveUseCase] = useState<string>(USE_CASES[0].id);
  const [complexity, setComplexity] = useState(58);
  const complexitySliderId = useId();

  const selected = useMemo(
    () => USE_CASES.find((c) => c.id === activeUseCase) ?? USE_CASES[0],
    [activeUseCase],
  );
  const metrics = useMemo(() => estimateMetrics(complexity), [complexity]);
  const stageDurations = useMemo(() => estimateStageDurations(complexity), [complexity]);
  const [displayMetrics, setDisplayMetrics] = useState(metrics);
  const [displayStageDurations, setDisplayStageDurations] = useState(stageDurations);
  const metricsRef = useRef(displayMetrics);
  const stagesRef = useRef(displayStageDurations);

  useEffect(() => {
    metricsRef.current = displayMetrics;
  }, [displayMetrics]);

  useEffect(() => {
    stagesRef.current = displayStageDurations;
  }, [displayStageDurations]);

  useEffect(() => {
    const startMetrics = metricsRef.current;
    const startStages = stagesRef.current;
    const durationMs = 420;
    let frame = 0;
    let startedAt = 0;

    const animate = (now: number) => {
      if (!startedAt) startedAt = now;
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);

      setDisplayMetrics({
        fields: Math.round(startMetrics.fields + (metrics.fields - startMetrics.fields) * eased),
        autoCoverage: Math.round(
          startMetrics.autoCoverage + (metrics.autoCoverage - startMetrics.autoCoverage) * eased,
        ),
        reviewItems: Math.round(startMetrics.reviewItems + (metrics.reviewItems - startMetrics.reviewItems) * eased),
      });

      setDisplayStageDurations(
        stageDurations.map((stage, index) => {
          const fromMs = startStages[index]?.ms ?? stage.ms;
          return {
            ...stage,
            ms: Math.round(fromMs + (stage.ms - fromMs) * eased),
          };
        }),
      );

      if (t < 1) {
        frame = requestAnimationFrame(animate);
      }
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [metrics, stageDurations]);

  const totalMs = useMemo(
    () => displayStageDurations.reduce((sum, stage) => sum + stage.ms, 0),
    [displayStageDurations],
  );

  return (
    <div className="landing-root">
      <div className="landing-bg-grid" />
      <div className="landing-orb landing-orb--a" />
      <div className="landing-orb landing-orb--b" />

      <header className="landing-header">
        <div className="landing-brand">
          <span className="landing-brand-mark">
            <AutoMapperLogomark size={26} className="sidebar-logo-svg" />
          </span>
          <div>
            <div className="landing-brand-title">AutoMapper</div>
            <div className="landing-brand-subtitle">Agentic Integration Mapping</div>
          </div>
        </div>
        <button className="btn btn--secondary" onClick={onEnterStudio}>
          Open Studio
        </button>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <p className="landing-eyebrow">Agentic mapping cockpit for Salesforce &amp; SAP</p>
          <h1 className="landing-title">
            Map complex systems with an <span>AI-native multi-agent pipeline</span>
          </h1>
          <p className="landing-copy">
            Ingest SAP and Salesforce schemas, let specialised agents propose mappings, and export artefacts your
            delivery teams can drop into iPaaS and integration runtimes.
          </p>
          <div className="landing-actions">
            <button className="btn btn--primary btn--lg" onClick={onEnterStudio}>
              Enter Mapping Studio
            </button>
            <span className="landing-inline-note">Salesforce &amp; SAP-ready · Live connectors + upload fallback</span>
          </div>
        </section>

        <section className="landing-panel">
          <div className="landing-panel-left">
            <h2 className="landing-panel-title">Scenario Explorer</h2>
            <p className="landing-panel-subtitle">Select a use case to preview mapping behavior.</p>
            <div className="landing-scenario-list" role="group" aria-label="Mapping scenarios">
              {USE_CASES.map((useCase) => (
                <button
                  key={useCase.id}
                  className={`landing-scenario-btn ${activeUseCase === useCase.id ? 'is-active' : ''}`}
                  aria-pressed={activeUseCase === useCase.id}
                  onClick={() => setActiveUseCase(useCase.id)}
                >
                  <span className="landing-scenario-name">{useCase.title}</span>
                  <span className="landing-scenario-route">{useCase.route}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="landing-panel-right">
            <div className="landing-scenario-card">
              <h3>{selected.title}</h3>
              <p>{selected.description}</p>
              <ul className="landing-outcomes">
                {selected.outcomes.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>

            <div className="landing-sim-card">
              <div className="landing-sim-header">
                <h3>Complexity Simulator</h3>
                <span>{complexity}%</span>
              </div>
              <label htmlFor={complexitySliderId} className="landing-range-label">
                Drag to simulate schema volume and mapping complexity
              </label>
              <input
                id={complexitySliderId}
                type="range"
                min={20}
                max={95}
                value={complexity}
                onChange={(e) => setComplexity(Number(e.target.value))}
                className="landing-range"
              />
              <div className="landing-metric-grid">
                <div className="landing-metric">
                  <span>Estimated Fields</span>
                  <strong>{displayMetrics.fields}</strong>
                </div>
                <div className="landing-metric">
                  <span>Auto Coverage</span>
                  <strong>{displayMetrics.autoCoverage}%</strong>
                </div>
                <div className="landing-metric">
                  <span>Manual Review</span>
                  <strong>{displayMetrics.reviewItems}</strong>
                </div>
              </div>

              <div className="landing-stage-preview">
                <div className="landing-stage-title">Pipeline timing preview</div>
                <div className="landing-stage-list">
                  {displayStageDurations.map((stage) => (
                    <div className="landing-stage-row" key={stage.id}>
                      <span>{stage.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            height: 4,
                            borderRadius: 2,
                            background: 'var(--primary)',
                            opacity: 0.7,
                            width: `${Math.round((stage.ms / Math.max(totalMs, 1)) * 100)}%`,
                            minWidth: 8,
                            maxWidth: 160,
                            transition: 'width var(--transition-slow)',
                          }}
                        />
                        <strong>{stage.ms} ms</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="landing-stage-total">Estimated run: {(totalMs / 1000).toFixed(2)}s</div>
              </div>

              <div className="landing-agentic">
                <div className="landing-agentic-header">
                  <span className="badge badge--green">Agentic setup</span>
                  <span className="landing-agentic-caption">Seven specialised agents orchestrated for each run.</span>
                </div>
                <div className="landing-agentic-list" aria-label="Agent pipeline overview">
                  {AGENT_STAGES.map((agent) => (
                    <div key={agent.id} className="landing-agentic-item">
                      <span className="landing-agentic-name">{agent.name}</span>
                      <span className="landing-agentic-role">{agent.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
