import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AgentStepState, EntityMapping, FieldMapping, ValidationReport, OrchestrationEvent } from '../types';
import { apiBase, getEventSource, MockEventSource } from '../api/client';

// The 7 agents in orchestration order
const AGENT_DEFS: { id: string; label: string; description: string }[] = [
  { id: 'SchemaDiscoveryAgent', label: 'Schema Discovery', description: 'Validates ingested schemas and computes entity-level statistics.' },
  { id: 'ComplianceAgent', label: 'Compliance Scan', description: 'Tags fields with GLBA, BSA/AML, PCI-DSS, SOX, FFIEC markers.' },
  { id: 'BankingDomainAgent', label: 'Banking Domain', description: 'Detects numeric code fields and short-code enumerations.' },
  { id: 'CRMDomainAgent', label: 'CRM Domain', description: 'Analyses CRM object relationships and picklist coverage.' },
  { id: 'MappingProposalAgent', label: 'Mapping Proposal', description: 'Scores field pairs semantically; flags type conflicts.' },
  { id: 'MappingRationaleAgent', label: 'Mapping Rationale', description: 'Generates natural-language intent summaries for each mapping.' },
  { id: 'ValidationAgent', label: 'Validation', description: 'Checks type compatibility, required coverage, picklist gaps.' },
];

interface PipelineResult {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
  totalMappings: number;
  complianceFlags: number;
  processingMs: number;
}

interface AgentPipelineProps {
  projectId: string;
  onComplete: (result: PipelineResult) => void;
  onError?: (msg: string) => void;
}

export function AgentPipeline({ projectId, onComplete, onError }: AgentPipelineProps) {
  const [steps, setSteps] = useState<AgentStepState[]>(
    AGENT_DEFS.map((d) => ({ id: d.id, label: d.label, status: 'pending' })),
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const esCurrent = useRef<EventSource | MockEventSource | null>(null);

  const updateStep = useCallback((agentId: string, patch: Partial<AgentStepState>) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === agentId ? { ...s, ...patch } : s)),
    );
  }, []);

  function startPipeline() {
    if (running || done) return;
    setRunning(true);
    setError(null);
    setStartedAt(Date.now());

    // Reset all steps
    setSteps(AGENT_DEFS.map((d) => ({ id: d.id, label: d.label, status: 'pending' })));

    const url = `${apiBase()}/api/projects/${projectId}/orchestrate`;
    const es = getEventSource(url);
    esCurrent.current = es;

    es.onmessage = (e) => {
      try {
        const data: OrchestrationEvent = JSON.parse(e.data);

        if (data.event === 'agent_start' && data.agent) {
          updateStep(data.agent, { status: 'running', startedAt: Date.now() });
        }

        if (data.event === 'agent_complete' && data.agent) {
          updateStep(data.agent, {
            status: 'done',
            output: data.output,
            finishedAt: Date.now(),
          });
        }

        if (data.event === 'pipeline_complete') {
          es.close();
          esCurrent.current = null;
          const r: PipelineResult = {
            entityMappings: data.entityMappings ?? [],
            fieldMappings: data.fieldMappings ?? [],
            validation: data.validation ?? {
              warnings: [],
              summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
            },
            totalMappings: data.totalMappings ?? 0,
            complianceFlags: data.complianceFlags ?? 0,
            processingMs: data.processingMs ?? (startedAt ? Date.now() - startedAt : 0),
          };
          setResult(r);
          setDone(true);
          setRunning(false);
          onComplete(r);
        }

        if (data.event === 'error') {
          es.close();
          const msg = data.output ?? 'Orchestration failed';
          setError(msg);
          setRunning(false);
          onError?.(msg);
        }
      } catch {
        // Malformed SSE data — ignore
      }
    };

    es.onerror = () => {
      es.close();
      esCurrent.current = null;
      const msg = 'Lost connection to orchestration pipeline.';
      setError(msg);
      setRunning(false);
      onError?.(msg);
    };
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esCurrent.current?.close();
    };
  }, []);

  const doneCount = steps.filter((s) => s.status === 'done').length;
  const progressPct = (doneCount / AGENT_DEFS.length) * 100;

  return (
    <div className="pipeline-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Orchestration Pipeline</h1>
          <p className="page-subtitle">
            Seven specialized agents analyse both schemas, detect compliance requirements, propose field mappings,
            and validate the result — all in under 60 seconds.
          </p>
        </div>
        {!done && !running && (
          <button className="btn btn--primary btn--lg" onClick={startPipeline}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
            </svg>
            Run pipeline
          </button>
        )}
      </div>

      {/* Progress bar */}
      {(running || done) && (
        <div className="pipeline-progress-track">
          <div
            className={`pipeline-progress-bar ${done ? 'pipeline-progress-bar--done' : ''}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Agent steps */}
      <div className="pipeline-steps">
        {steps.map((step, i) => {
          const def = AGENT_DEFS[i];
          return (
            <div key={step.id} className={`agent-step step-${step.status}`}>
              <div className="agent-step-icon">
                {step.status === 'done' && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {step.status === 'running' && <span className="step-spinner" />}
                {step.status === 'pending' && <span className="step-index">{i + 1}</span>}
                {step.status === 'error' && '✕'}
              </div>
              <div className="agent-step-body">
                <div className="agent-step-header">
                  <span className="agent-step-name">{step.label}</span>
                  {step.status === 'running' && (
                    <span className="badge badge--amber" style={{ fontSize: '11px' }}>Running</span>
                  )}
                  {step.status === 'done' && (
                    <span className="badge badge--green" style={{ fontSize: '11px' }}>Done</span>
                  )}
                </div>
                <p className="agent-step-description">{def.description}</p>
                {step.output && step.status === 'done' && (
                  <div className="agent-step-output">{step.output}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error state */}
      {error && (
        <div className="validation-box validation-box--error" style={{ marginTop: '24px' }}>
          <div className="validation-box-title">Pipeline error</div>
          <p style={{ margin: 0, fontSize: '14px' }}>{error}</p>
          <button
            className="btn btn--secondary"
            style={{ marginTop: '12px' }}
            onClick={() => { setError(null); startPipeline(); }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Completion card */}
      {done && result && (
        <div className="pipeline-result">
          <div className="pipeline-result-header">
            <div className="pipeline-result-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className="pipeline-result-title">Pipeline complete</div>
              <div className="pipeline-result-subtitle">
                Processed in {(result.processingMs / 1000).toFixed(1)}s
              </div>
            </div>
          </div>
          <div className="pipeline-stats">
            <div className="pipeline-stat">
              <span className="pipeline-stat-value">{result.fieldMappings.length}</span>
              <span className="pipeline-stat-label">Fields mapped</span>
            </div>
            <div className="pipeline-stat">
              <span className="pipeline-stat-value">{result.entityMappings.length}</span>
              <span className="pipeline-stat-label">Entities matched</span>
            </div>
            <div className="pipeline-stat">
              <span
                className="pipeline-stat-value"
                style={{ color: result.complianceFlags > 0 ? 'var(--warning)' : 'var(--success)' }}
              >
                {result.complianceFlags}
              </span>
              <span className="pipeline-stat-label">Compliance flags</span>
            </div>
            <div className="pipeline-stat">
              <span
                className="pipeline-stat-value"
                style={{ color: result.validation.summary.totalWarnings > 0 ? 'var(--danger)' : 'var(--success)' }}
              >
                {result.validation.summary.totalWarnings}
              </span>
              <span className="pipeline-stat-label">Warnings</span>
            </div>
          </div>
        </div>
      )}

      {/* Idle state */}
      {!running && !done && !error && (
        <div className="empty-state" style={{ marginTop: '32px' }}>
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">Ready to orchestrate</div>
          <p className="empty-state-body">
            Click <strong>Run pipeline</strong> to start the 7-agent analysis. The entire process takes under 60 seconds.
          </p>
        </div>
      )}
    </div>
  );
}
