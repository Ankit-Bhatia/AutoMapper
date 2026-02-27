import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentStepState, EntityMapping, FieldMapping, OrchestrationEvent, ValidationReport } from '../types';
import { api, apiBase, getAuthTokenForSse, getEventSource, MockEventSource } from '../api/client';

// The 7 agents in orchestration order
const AGENT_DEFS: { id: string; label: string; description: string }[] = [
  {
    id: 'SchemaDiscoveryAgent',
    label: 'Schema Discovery',
    description: 'Validates ingested schemas and computes entity-level statistics.',
  },
  {
    id: 'ComplianceAgent',
    label: 'Compliance Scan',
    description: 'Tags fields with GLBA, BSA/AML, PCI-DSS, SOX, FFIEC markers.',
  },
  {
    id: 'BankingDomainAgent',
    label: 'Banking Domain',
    description: 'Detects numeric code fields and short-code enumerations.',
  },
  {
    id: 'CRMDomainAgent',
    label: 'CRM Domain',
    description: 'Analyses CRM object relationships and picklist coverage.',
  },
  {
    id: 'MappingProposalAgent',
    label: 'Mapping Proposal',
    description: 'Scores field pairs semantically; flags type conflicts.',
  },
  {
    id: 'MappingRationaleAgent',
    label: 'Mapping Rationale',
    description: 'Generates natural-language intent summaries for each mapping.',
  },
  {
    id: 'ValidationAgent',
    label: 'Validation',
    description: 'Checks type compatibility, required coverage, picklist gaps.',
  },
];

const MIN_STEP_VISIBLE_MS = 750;
const MIN_PIPELINE_VISIBLE_MS = 6000;
const STALL_TIMEOUT_MS = 20000;

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
  onReviewReady?: () => void;
  onError?: (msg: string) => void;
}

function createInitialSteps(): AgentStepState[] {
  return AGENT_DEFS.map((d) => ({ id: d.id, label: d.label, status: 'pending' }));
}

function isTerminalStepAction(action?: string): boolean {
  if (!action) return false;
  return action.endsWith('_complete') || action === 'skip' || action === 'llm_error' || action === 'error';
}

export function AgentPipeline({ projectId, onComplete, onReviewReady, onError }: AgentPipelineProps) {
  const [steps, setSteps] = useState<AgentStepState[]>(() => createInitialSteps());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const esCurrent = useRef<EventSource | MockEventSource | null>(null);
  const finishedRef = useRef(false);
  const mountedRef = useRef(true);
  const runStartedAtRef = useRef<number | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  const stepStartedAtRef = useRef<Record<string, number>>({});
  const eventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const waitTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stepsRef = useRef<AgentStepState[]>(createInitialSteps());

  const replaceSteps = useCallback((next: AgentStepState[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, []);

  const updateStep = useCallback((agentId: string, patch: Partial<AgentStepState>) => {
    const next = stepsRef.current.map((s) => (s.id === agentId ? { ...s, ...patch } : s));
    replaceSteps(next);
  }, [replaceSteps]);

  const resetSteps = useCallback(() => {
    replaceSteps(createInitialSteps());
    stepStartedAtRef.current = {};
  }, [replaceSteps]);

  const wait = useCallback((ms: number): Promise<void> => {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waitTimersRef.current = waitTimersRef.current.filter((t) => t !== timer);
        resolve();
      }, ms);
      waitTimersRef.current.push(timer);
    });
  }, []);

  const markStepRunning = useCallback((agentId: string, output?: string) => {
    const step = stepsRef.current.find((s) => s.id === agentId);
    if (!step) return;
    // Once a step is done, do not regress it back to running from follow-up
    // informational events (e.g. compliance_issue after compliance_scan_complete).
    if (step.status === 'done') return;
    const startedAt = stepStartedAtRef.current[agentId] ?? Date.now();
    stepStartedAtRef.current[agentId] = startedAt;
    updateStep(agentId, {
      status: 'running',
      startedAt,
      output: output ?? step.output,
    });
  }, [updateStep]);

  const completeStepWithPacing = useCallback(async (agentId: string, output?: string) => {
    const step = stepsRef.current.find((s) => s.id === agentId);
    if (!step) return;

    const startedAt = stepStartedAtRef.current[agentId] ?? Date.now();
    stepStartedAtRef.current[agentId] = startedAt;
    if (step.status === 'pending') {
      updateStep(agentId, { status: 'running', startedAt });
    }

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_STEP_VISIBLE_MS - elapsed);
    if (remaining > 0) {
      await wait(remaining);
    }
    if (!mountedRef.current) return;

    const latestStep = stepsRef.current.find((s) => s.id === agentId);
    updateStep(agentId, {
      status: 'done',
      finishedAt: Date.now(),
      output: output ?? latestStep?.output,
    });
  }, [updateStep, wait]);

  const finalizePipelineState = useCallback(async () => {
    for (const step of AGENT_DEFS) {
      const current = stepsRef.current.find((s) => s.id === step.id);
      if (!current || current.status === 'done') continue;

      const fallbackOutput =
        current.status === 'pending'
          ? 'Not applicable for this connector combination'
          : current.output ?? 'Completed';
      await completeStepWithPacing(step.id, fallbackOutput);
    }
  }, [completeStepWithPacing]);

  const enqueueEvent = useCallback((handler: () => Promise<void> | void) => {
    eventQueueRef.current = eventQueueRef.current
      .then(() => handler())
      .catch((err) => {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Pipeline event processing failed';
        setError(msg);
        setRunning(false);
        onError?.(msg);
      });
  }, [onError]);

  const startPipeline = useCallback(() => {
    if (running || done) return;
    setRunning(true);
    setDone(false);
    setError(null);
    setResult(null);
    runStartedAtRef.current = Date.now();
    lastEventAtRef.current = Date.now();
    finishedRef.current = false;
    eventQueueRef.current = Promise.resolve();
    for (const timer of waitTimersRef.current) clearTimeout(timer);
    waitTimersRef.current = [];
    resetSteps();

    const token = getAuthTokenForSse();
    const url = token
      ? `${apiBase()}/api/projects/${projectId}/orchestrate?access_token=${encodeURIComponent(token)}`
      : `${apiBase()}/api/projects/${projectId}/orchestrate`;
    const es = getEventSource(url);
    esCurrent.current = es;

    es.onmessage = (e) => {
      lastEventAtRef.current = Date.now();
      let data: (OrchestrationEvent & {
        type?: 'start' | 'step' | 'complete' | 'error';
        message?: string;
        agentName?: string;
        action?: string;
        detail?: string;
        complianceSummary?: { errors?: number; warnings?: number };
        durationMs?: number;
      }) | null = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!data) return;

      const eventType: string | undefined = (data.event as string | undefined) ?? data.type;

      // Mark completion immediately so a normal SSE socket close does not surface
      // as a false "Lost connection" error while completion is still being processed.
      if (eventType === 'pipeline_complete' || eventType === 'complete') {
        finishedRef.current = true;
        esCurrent.current?.close();
        esCurrent.current = null;
      }

      enqueueEvent(async () => {
        if (!eventType) return;

        if (eventType === 'agent_start' && data.agent) {
          markStepRunning(data.agent, data.detail ?? data.output);
          return;
        }

        if (eventType === 'agent_complete' && data.agent) {
          await completeStepWithPacing(data.agent, data.detail ?? data.output);
          return;
        }

        if (eventType === 'step' && data.agentName) {
          const detail = data.detail ?? data.output;
          if (data.action === 'start') {
            markStepRunning(data.agentName, detail);
            return;
          }
          if (isTerminalStepAction(data.action)) {
            await completeStepWithPacing(data.agentName, detail);
            return;
          }
          markStepRunning(data.agentName, detail);
          return;
        }

        if (eventType === 'pipeline_complete' || eventType === 'complete') {
          let payload: { entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] } | null = null;
          try {
            payload = await api<{ entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] }>(
              `/api/projects/${projectId}`,
            );
          } catch {
            // Fall back to SSE payload if project reload fails (for example transient auth/network issues).
            payload = null;
          }

          await finalizePipelineState();

          const elapsed = runStartedAtRef.current ? Date.now() - runStartedAtRef.current : 0;
          const remaining = Math.max(0, MIN_PIPELINE_VISIBLE_MS - elapsed);
          if (remaining > 0) {
            await wait(remaining);
          }
          if (!mountedRef.current) return;

          const complianceFlags = (data.complianceSummary?.errors ?? 0) + (data.complianceSummary?.warnings ?? 0);
          const finalFieldMappings = payload?.fieldMappings ?? data.fieldMappings ?? [];
          const r: PipelineResult = {
            entityMappings: payload?.entityMappings ?? data.entityMappings ?? [],
            fieldMappings: finalFieldMappings,
            validation: data.validation ?? {
              warnings: [],
              summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
            },
            totalMappings: finalFieldMappings.length,
            complianceFlags: data.complianceFlags ?? complianceFlags,
            processingMs: data.processingMs ?? data.durationMs ?? (runStartedAtRef.current ? Date.now() - runStartedAtRef.current : 0),
          };
          setResult(r);
          setDone(true);
          setRunning(false);
          onComplete(r);
          return;
        }

        if (eventType === 'error') {
          const msg = data.message ?? data.output ?? 'Orchestration failed';
          es.close();
          esCurrent.current = null;
          setError(msg);
          setRunning(false);
          onError?.(msg);
        }
      });
    };

    es.onerror = () => {
      if (finishedRef.current) return;
      es.close();
      esCurrent.current = null;
      const msg = 'Lost connection to orchestration pipeline.';
      setError(msg);
      setRunning(false);
      onError?.(msg);
    };
  }, [
    completeStepWithPacing,
    done,
    enqueueEvent,
    finalizePipelineState,
    markStepRunning,
    onComplete,
    onError,
    projectId,
    resetSteps,
    running,
    wait,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      esCurrent.current?.close();
      for (const timer of waitTimersRef.current) clearTimeout(timer);
    };
  }, []);

  // Guardrail: do not leave UI indefinitely in running state if SSE stalls.
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastEventAtRef.current;
      if (elapsed <= STALL_TIMEOUT_MS) return;
      esCurrent.current?.close();
      esCurrent.current = null;
      setRunning(false);
      const msg = 'Pipeline stalled: no progress events received for 20s. Please retry.';
      setError(msg);
      onError?.(msg);
    }, 1000);
    return () => clearInterval(interval);
  }, [running, onError]);

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
            and validate the result. Review unlocks only after all agent stages complete.
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
        <div className="pipeline-result" aria-live="polite">
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
          <div className="pipeline-review-ready">
            <span className="badge badge--green">Review ready</span>
            <span className="pipeline-review-text">
              All steps are complete. Open review to inspect and adjust field-level mappings.
            </span>
            {onReviewReady && (
              <button className="btn btn--primary btn--sm" onClick={onReviewReady}>
                Open review stage
              </button>
            )}
          </div>
        </div>
      )}

      {/* Idle state */}
      {!running && !done && !error && (
        <div className="empty-state" style={{ marginTop: '32px' }}>
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">Ready to orchestrate</div>
          <p className="empty-state-body">
            Click <strong>Run pipeline</strong> to start the 7-agent analysis. Review unlocks when all steps complete.
          </p>
        </div>
      )}
    </div>
  );
}
