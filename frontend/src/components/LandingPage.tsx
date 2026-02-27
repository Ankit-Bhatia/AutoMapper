import { useId, useMemo, useState } from 'react';

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

const USE_CASES: UseCaseCard[] = [
  {
    id: 'banking-crm',
    title: 'Core Banking -> Salesforce FSC',
    route: 'SilverLake / Core Director -> Financial Services Cloud',
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
    title: 'SAP -> Salesforce',
    route: 'SAP S/4HANA -> Salesforce CRM',
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
  const totalMs = useMemo(() => stageDurations.reduce((sum, stage) => sum + stage.ms, 0), [stageDurations]);

  return (
    <div className="landing-root">
      <div className="landing-bg-grid" />
      <div className="landing-orb landing-orb--a" />
      <div className="landing-orb landing-orb--b" />

      <header className="landing-header">
        <div className="landing-brand">
          <span className="landing-brand-mark">AM</span>
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
          <p className="landing-eyebrow">Enterprise Data Translation Layer</p>
          <h1 className="landing-title">
            Map complex systems with an <span>interactive agent pipeline</span>
          </h1>
          <p className="landing-copy">
            Ingest schemas from connectors or uploaded files, run domain-aware mapping agents, and export integration
            specs your implementation teams can deploy.
          </p>
          <div className="landing-actions">
            <button className="btn btn--primary btn--lg" onClick={onEnterStudio}>
              Enter Mapping Studio
            </button>
            <span className="landing-inline-note">Live connector + upload fallback supported</span>
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
                  <strong>{metrics.fields}</strong>
                </div>
                <div className="landing-metric">
                  <span>Auto Coverage</span>
                  <strong>{metrics.autoCoverage}%</strong>
                </div>
                <div className="landing-metric">
                  <span>Manual Review</span>
                  <strong>{metrics.reviewItems}</strong>
                </div>
              </div>

              <div className="landing-stage-preview">
                <div className="landing-stage-title">Pipeline timing preview</div>
                <div className="landing-stage-list">
                  {stageDurations.map((stage) => (
                    <div className="landing-stage-row" key={stage.id}>
                      <span>{stage.label}</span>
                      <strong>{stage.ms} ms</strong>
                    </div>
                  ))}
                </div>
                <div className="landing-stage-total">Estimated run: {(totalMs / 1000).toFixed(2)}s</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
