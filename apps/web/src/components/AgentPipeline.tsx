import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentStepState, EntityMapping, FieldMapping, OrchestrationEvent, ValidationReport } from '@contracts';
import { api, apiBase, getEventSource, isDemoUiMode, MockEventSource } from '@core/api-client';

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
const STALL_NO_EVENT_TIMEOUT_MS = 20000;
const LONG_RUNNING_NOTICE_MS = 90000;
const PROJECT_RELOAD_TIMEOUT_MS = 8000;
type LogFilter = 'all' | 'agent' | 'warning' | 'error';

const EMPTY_VALIDATION_REPORT: ValidationReport = {
  warnings: [],
  summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
};

const MAJOR_STAGE_DEFS: Array<{
  id: string;
  label: string;
  description: string;
  agents: string[];
}> = [
  {
    id: 'schema-discovery',
    label: 'Schema Discovery',
    description: 'Validate source and target metadata before orchestration.',
    agents: ['SchemaDiscoveryAgent'],
  },
  {
    id: 'compliance-scan',
    label: 'Compliance Scan',
    description: 'Detect regulatory and risk markers on candidate fields.',
    agents: ['ComplianceAgent'],
  },
  {
    id: 'domain-analysis',
    label: 'Domain Analysis',
    description: 'Apply banking and CRM context before mapping selection.',
    agents: ['BankingDomainAgent', 'CRMDomainAgent'],
  },
  {
    id: 'mapping-and-validation',
    label: 'Mapping + Validation',
    description: 'Propose mappings, generate rationale, and validate quality.',
    agents: ['MappingProposalAgent', 'MappingRationaleAgent', 'ValidationAgent'],
  },
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
  onReviewReady?: () => void;
  onError?: (msg: string) => void;
  sourceConnectorName?: string;
  targetConnectorName?: string;
  sourceSchemaMode?: 'live' | 'mock' | 'uploaded';
  targetSchemaMode?: 'live' | 'mock' | 'uploaded';
}

function normalizeAgentToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const AGENT_ALIAS_MAP: Map<string, string> = (() => {
  const entries: Array<[string, string]> = [];
  for (const agent of AGENT_DEFS) {
    const idKey = normalizeAgentToken(agent.id);
    entries.push([idKey, agent.id]);
    entries.push([normalizeAgentToken(agent.id.replace(/agent$/i, '')), agent.id]);
    entries.push([normalizeAgentToken(agent.label), agent.id]);
  }
  entries.push(['orchestrator', 'OrchestratorAgent']);
  entries.push(['orchestratoragent', 'OrchestratorAgent']);
  return new Map(entries);
})();

function inferAgentFromAction(action?: string): string | null {
  if (!action) return null;
  const normalized = action.trim().toLowerCase();
  if (normalized.startsWith('schema_')) return 'SchemaDiscoveryAgent';
  if (normalized.startsWith('compliance_')) return 'ComplianceAgent';
  if (normalized.startsWith('banking_')) return 'BankingDomainAgent';
  if (normalized.startsWith('crm_')) return 'CRMDomainAgent';
  if (normalized.startsWith('mapping_proposal_') || normalized.startsWith('llm_')) return 'MappingProposalAgent';
  if (normalized.startsWith('rationale_')) return 'MappingRationaleAgent';
  if (normalized.startsWith('validation_')) return 'ValidationAgent';
  if (normalized.startsWith('orchestrate_') || normalized.startsWith('pipeline_')) return 'OrchestratorAgent';
  return null;
}

function resolveAgentId(agent?: string, action?: string): string | null {
  if (agent) {
    const normalized = normalizeAgentToken(agent);
    const mapped = AGENT_ALIAS_MAP.get(normalized);
    if (mapped) return mapped;
  }
  return inferAgentFromAction(action);
}

function createInitialSteps(): AgentStepState[] {
  return AGENT_DEFS.map((d) => ({ id: d.id, label: d.label, status: 'pending' }));
}

function isTerminalStepAction(action?: string): boolean {
  if (!action) return false;
  const normalized = action.trim().toLowerCase();
  return (
    normalized.endsWith('_complete')
    || normalized.endsWith('_completed')
    || normalized.endsWith('_done')
    || normalized.endsWith('_finished')
    || normalized === 'complete'
    || normalized === 'completed'
    || normalized === 'done'
    || normalized === 'finished'
    || normalized === 'skip'
    || normalized === 'llm_error'
    || normalized === 'error'
  );
}

function getAgentInitials(label: string): string {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return initials.slice(0, 3);
}

function extractFieldCount(text?: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d+)\s+fields?/i);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function classifyLogLine(text: string): Exclude<LogFilter, 'all' | 'agent'> | 'agent' {
  const normalized = text.toLowerCase();
  if (
    normalized.includes('error')
    || normalized.includes('failed')
    || normalized.includes('lost connection')
    || normalized.includes('stalled')
  ) {
    return 'error';
  }
  if (
    normalized.includes('warning')
    || normalized.includes('unmapped')
    || normalized.includes('duplicate')
    || normalized.includes('conflict')
  ) {
    return 'warning';
  }
  return 'agent';
}

function stageStatusForAgents(steps: AgentStepState[], agentIds: string[]): AgentStepState['status'] {
  const relevant = steps.filter((step) => agentIds.includes(step.id));
  if (relevant.some((step) => step.status === 'error')) return 'error';
  if (relevant.length > 0 && relevant.every((step) => step.status === 'done')) return 'done';
  if (relevant.some((step) => step.status === 'running')) return 'running';
  return 'pending';
}

export function AgentPipeline({
  projectId,
  onComplete,
  onReviewReady,
  onError,
  sourceConnectorName,
  targetConnectorName,
  sourceSchemaMode,
  targetSchemaMode,
}: AgentPipelineProps) {
  const demoUiMode = isDemoUiMode();
  const [steps, setSteps] = useState<AgentStepState[]>(() => createInitialSteps());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowReviewBypass, setAllowReviewBypass] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [fieldCounts, setFieldCounts] = useState<Record<string, number>>({});
  const [logLines, setLogLines] = useState<Array<{ time: string; text: string }>>([]);
  const [animatedStats, setAnimatedStats] = useState({
    fields: 0,
    entities: 0,
    flags: 0,
    warnings: 0,
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showMobileLog, setShowMobileLog] = useState(false);
  const [autoScrollLog, setAutoScrollLog] = useState(true);
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hasLLM, setHasLLM] = useState(false);
  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  const esCurrent = useRef<EventSource | MockEventSource | null>(null);
  const logBodyRef = useRef<HTMLDivElement | null>(null);
  const finishedRef = useRef(false);
  const completeEventSeenRef = useRef(false);
  const mountedRef = useRef(true);
  const runStartedAtRef = useRef<number | null>(null);
  const lastEventAtRef = useRef<number>(Date.now());
  const lastProgressAtRef = useRef<number>(Date.now());
  const longRunningNoticeSentRef = useRef(false);
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

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }, []);

  const appendLogLine = useCallback((text: string) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLogLines((prev) => [...prev.slice(-199), { time, text }]);
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

  const finalizePriorAgentsForSequentialRun = useCallback((currentAgentId: string) => {
    const currentIndex = AGENT_DEFS.findIndex((agent) => agent.id === currentAgentId);
    if (currentIndex <= 0) return;

    const now = Date.now();
    const next = stepsRef.current.map((step, index) => {
      if (index >= currentIndex) return step;
      if (step.status === 'done' || step.status === 'error') return step;
      return {
        ...step,
        status: 'done' as const,
        finishedAt: step.finishedAt ?? now,
        output: step.output ?? 'Completed',
      };
    });
    replaceSteps(next);
  }, [replaceSteps]);

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
    const fieldCount = extractFieldCount(output ?? latestStep?.output);
    if (fieldCount !== undefined) {
      setFieldCounts((prev) => ({ ...prev, [agentId]: fieldCount }));
    }
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

  const buildResultFromProject = useCallback(async (
    overrides?: Partial<Pick<PipelineResult, 'validation' | 'complianceFlags' | 'processingMs' | 'entityMappings' | 'fieldMappings'>>,
  ): Promise<PipelineResult> => {
    let payload: { entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] } | null = null;
    try {
      payload = await withTimeout(
        api<{ entityMappings: EntityMapping[]; fieldMappings: FieldMapping[] }>(`/api/projects/${projectId}`),
        PROJECT_RELOAD_TIMEOUT_MS,
      );
    } catch {
      payload = null;
    }

    const fieldMappings = payload?.fieldMappings ?? overrides?.fieldMappings ?? [];
    const entityMappings = payload?.entityMappings ?? overrides?.entityMappings ?? [];
    return {
      entityMappings,
      fieldMappings,
      validation: overrides?.validation ?? EMPTY_VALIDATION_REPORT,
      totalMappings: fieldMappings.length,
      complianceFlags: overrides?.complianceFlags ?? 0,
      processingMs:
        overrides?.processingMs
        ?? (runStartedAtRef.current ? Date.now() - runStartedAtRef.current : 0),
    };
  }, [projectId, withTimeout]);

  const completePipeline = useCallback(async (
    options?: Partial<Pick<PipelineResult, 'validation' | 'complianceFlags' | 'processingMs' | 'entityMappings' | 'fieldMappings'>> & { logMessage?: string },
  ) => {
    await finalizePipelineState();
    const nextResult = await buildResultFromProject(options);
    if (!mountedRef.current) return;
    if (options?.logMessage) {
      appendLogLine(options.logMessage);
    }
    setResult(nextResult);
    setDone(true);
    setRunning(false);
    setError(null);
    setAllowReviewBypass(false);
    onComplete(nextResult);
  }, [appendLogLine, buildResultFromProject, finalizePipelineState, onComplete]);

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
    if (running) return;
    setRunning(true);
    setDone(false);
    setError(null);
    setAllowReviewBypass(false);
    setResult(null);
    setFieldCounts({});
    setLogLines([]);
    setAnimatedStats({ fields: 0, entities: 0, flags: 0, warnings: 0 });
    setElapsedMs(0);
    setHasLLM(false);
    setLlmProvider(null);
    setSelectedAgentId(null);
    setShowMobileLog(false);
    runStartedAtRef.current = Date.now();
    lastEventAtRef.current = Date.now();
    lastProgressAtRef.current = Date.now();
    longRunningNoticeSentRef.current = false;
    finishedRef.current = false;
    completeEventSeenRef.current = false;
    eventQueueRef.current = Promise.resolve();
    for (const timer of waitTimersRef.current) clearTimeout(timer);
    waitTimersRef.current = [];
    resetSteps();

    const url = `${apiBase()}/api/projects/${projectId}/orchestrate`;
    const es = getEventSource(url);
    esCurrent.current = es;
    appendLogLine('Pipeline started');

    es.onmessage = (e) => {
      lastEventAtRef.current = Date.now();
      let data: (OrchestrationEvent & {
        type?: 'start' | 'step' | 'complete' | 'error';
        message?: string;
        agent?: string;
        agentName?: string;
        action?: string;
        detail?: string;
        hasLLM?: boolean;
        llmProvider?: string;
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
      const eventDetail = data.detail ?? data.output ?? data.message;
      const rawEventAgent = data.agentName ?? data.agent;
      const eventAgent = resolveAgentId(rawEventAgent, data.action);
      const normalizedAction = data.action?.trim().toLowerCase();

      if (eventType === 'step' && (normalizedAction === 'orchestrate_complete' || normalizedAction === 'pipeline_complete')) {
        completeEventSeenRef.current = true;
        setAllowReviewBypass(true);
      }

      // Mark completion immediately so a normal SSE socket close does not surface
      // as a false "Lost connection" error while completion is still being processed.
      if (eventType === 'pipeline_complete' || eventType === 'complete') {
        finishedRef.current = true;
        completeEventSeenRef.current = true;
        setAllowReviewBypass(true);
        esCurrent.current?.close();
        esCurrent.current = null;
      }

      enqueueEvent(async () => {
        if (!eventType) return;

        if (eventType === 'start') {
          setHasLLM(Boolean(data.hasLLM));
          setLlmProvider(data.llmProvider ?? null);
          return;
        }

        if (eventType === 'heartbeat') {
          // Keepalive event from backend to prevent false stall detection.
          return;
        }

        // Only functional events should count as progress. Heartbeats are excluded.
        lastProgressAtRef.current = Date.now();

        appendLogLine(
          [
            eventType,
            rawEventAgent ?? eventAgent,
            data.action,
            eventDetail,
          ]
            .filter(Boolean)
            .join(' • '),
        );

        if (eventType === 'agent_start' && eventAgent && eventAgent !== 'OrchestratorAgent') {
          markStepRunning(eventAgent, data.detail ?? data.output);
          return;
        }

        if (eventType === 'agent_complete' && eventAgent && eventAgent !== 'OrchestratorAgent') {
          finalizePriorAgentsForSequentialRun(eventAgent);
          await completeStepWithPacing(eventAgent, data.detail ?? data.output);
          return;
        }

        if (eventType === 'step') {
          const action = normalizedAction;
          if (action === 'orchestrate_complete' || action === 'pipeline_complete') {
            completeEventSeenRef.current = true;
            setAllowReviewBypass(true);
            await finalizePipelineState();
            return;
          }

          if (!eventAgent) {
            return;
          }

          const detail = data.detail ?? data.output;
          if (data.action === 'start') {
            finalizePriorAgentsForSequentialRun(eventAgent);
            markStepRunning(eventAgent, detail);
            return;
          }
          if (isTerminalStepAction(data.action)) {
            if (eventAgent === 'OrchestratorAgent') {
              completeEventSeenRef.current = true;
              setAllowReviewBypass(true);
              await finalizePipelineState();
              return;
            }
            finalizePriorAgentsForSequentialRun(eventAgent);
            await completeStepWithPacing(eventAgent, detail);
            return;
          }
          markStepRunning(eventAgent, detail);
          return;
        }

        if (eventType === 'pipeline_complete' || eventType === 'complete') {
          const elapsed = runStartedAtRef.current ? Date.now() - runStartedAtRef.current : 0;
          const remaining = Math.max(0, MIN_PIPELINE_VISIBLE_MS - elapsed);
          if (remaining > 0) {
            await wait(remaining);
          }
          if (!mountedRef.current) return;

          const complianceFlags = (data.complianceSummary?.errors ?? 0) + (data.complianceSummary?.warnings ?? 0);
          await completePipeline({
            validation: data.validation ?? EMPTY_VALIDATION_REPORT,
            complianceFlags: data.complianceFlags ?? complianceFlags,
            processingMs: data.processingMs ?? data.durationMs,
            entityMappings: data.entityMappings,
            fieldMappings: data.fieldMappings,
          });
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
      if (completeEventSeenRef.current || stepsRef.current.every((step) => step.status === 'done')) {
        finishedRef.current = true;
        enqueueEvent(async () => {
          await completePipeline({
            logMessage: 'Pipeline connection closed after completion checkpoint; finalized from current state.',
          });
        });
        return;
      }
      const msg = 'Lost connection to orchestration pipeline.';
      setError(msg);
      setRunning(false);
      onError?.(msg);
    };
  }, [
    appendLogLine,
    completePipeline,
    completeStepWithPacing,
    enqueueEvent,
    finalizePriorAgentsForSequentialRun,
    finalizePipelineState,
    markStepRunning,
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
      if (finishedRef.current) return;
      const now = Date.now();
      const canBypass = completeEventSeenRef.current || stepsRef.current.every((step) => step.status === 'done');
      const elapsedWithoutEvents = now - lastEventAtRef.current;
      if (elapsedWithoutEvents > STALL_NO_EVENT_TIMEOUT_MS) {
        if (canBypass) {
          finishedRef.current = true;
          esCurrent.current?.close();
          esCurrent.current = null;
          enqueueEvent(async () => {
            await completePipeline({
              logMessage: 'Pipeline finalized from completion checkpoint; final result sync event was delayed.',
            });
          });
          return;
        }
        esCurrent.current?.close();
        esCurrent.current = null;
        setRunning(false);
        const msg = 'Pipeline stalled: no events or heartbeats received for 20s. Please retry.';
        setError(msg);
        appendLogLine(msg);
        onError?.(msg);
        return;
      }

      const elapsedWithoutProgress = now - lastProgressAtRef.current;
      if (elapsedWithoutProgress > LONG_RUNNING_NOTICE_MS && !longRunningNoticeSentRef.current) {
        longRunningNoticeSentRef.current = true;
        appendLogLine('Pipeline is still running. Awaiting next agent progress update...');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [appendLogLine, completePipeline, enqueueEvent, running, onError]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const startedAt = runStartedAtRef.current;
      if (!startedAt) return;
      setElapsedMs(Date.now() - startedAt);
    }, 200);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!done || !result) {
      setAnimatedStats({ fields: 0, entities: 0, flags: 0, warnings: 0 });
      return;
    }

    const target = {
      fields: result.fieldMappings.length,
      entities: result.entityMappings.length,
      flags: result.complianceFlags,
      warnings: result.validation.summary.totalWarnings,
    };

    const startedAt = Date.now();
    const durationMs = 900;
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      setAnimatedStats({
        fields: Math.round(target.fields * progress),
        entities: Math.round(target.entities * progress),
        flags: Math.round(target.flags * progress),
        warnings: Math.round(target.warnings * progress),
      });
      if (progress >= 1) clearInterval(timer);
    }, 30);

    return () => clearInterval(timer);
  }, [done, result]);

  useEffect(() => {
    if (!autoScrollLog) return;
    const node = logBodyRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [logLines, autoScrollLog]);

  useEffect(() => {
    if (!done || !result) return;
    setElapsedMs(result.processingMs);
  }, [done, result]);

  const completedAgents = useMemo(
    () => steps.filter((step) => step.status === 'done').length,
    [steps],
  );

  const activeAgent = useMemo(
    () => steps.find((step) => step.status === 'running') ?? null,
    [steps],
  );

  const selectedAgent = useMemo(
    () => steps.find((step) => step.id === selectedAgentId) ?? activeAgent ?? steps[0] ?? null,
    [activeAgent, selectedAgentId, steps],
  );

  const majorStages = useMemo(
    () => MAJOR_STAGE_DEFS.map((stage) => {
      const stageSteps = steps.filter((step) => stage.agents.includes(step.id));
      const completed = stageSteps.filter((step) => step.status === 'done').length;
      return {
        ...stage,
        status: stageStatusForAgents(steps, stage.agents),
        completed,
        total: stageSteps.length,
      };
    }),
    [steps],
  );

  const progressPct = Math.round((completedAgents / AGENT_DEFS.length) * 100);

  const pipelineStatus = done
    ? 'completed'
    : error
      ? 'error'
      : running
        ? 'running'
        : 'ready';

  const statusLabel = done
    ? 'Completed'
    : running
      ? `Agent ${Math.min(AGENT_DEFS.length, completedAgents + 1)}/${AGENT_DEFS.length}`
      : error
        ? 'Error'
        : 'Ready';

  const filteredLogLines = useMemo(
    () => logLines.filter((line) => (logFilter === 'all' ? true : classifyLogLine(line.text) === logFilter)),
    [logFilter, logLines],
  );

  const sourceMode = sourceSchemaMode ?? 'mock';
  const targetMode = targetSchemaMode ?? 'mock';
  const hasMockData = sourceMode !== 'live' || targetMode !== 'live';
  const modeBadge = demoUiMode || hasMockData ? 'Demo Mode / Mock Mode' : 'Live Mode';
  const intelligenceModeLabel = hasLLM
    ? (llmProvider && llmProvider !== 'heuristic'
      ? `${llmProvider.toUpperCase()} + Context`
      : 'LLM + Context')
    : 'Context Only';
  const subtitle = `${sourceConnectorName ?? 'Source'} → ${targetConnectorName ?? 'Target'} · 7-agent automated mapping workflow`;

  const selectedAgentDef = selectedAgent ? AGENT_DEFS.find((agent) => agent.id === selectedAgent.id) : null;

  return (
    <div className="pipeline-page">
      <div className="page-header pipeline-header">
        <div>
          <h1 className="page-title">Orchestrate Pipeline</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <div className="pipeline-header-actions">
          <div className={`pipeline-status-chip is-${pipelineStatus}`}>
            <span className="pipeline-status-dot" />
            <span>{statusLabel}</span>
            <span className="pipeline-status-progress">{progressPct}%</span>
          </div>
          <span className={`badge ${modeBadge === 'Live Mode' ? 'badge--green' : 'badge--amber'} pipeline-mode-badge`}>
            {modeBadge}
          </span>
          <span className={`badge ${hasLLM ? 'badge--green' : 'badge--gray'} pipeline-mode-badge`}>
            {intelligenceModeLabel}
          </span>
          <button
            className="btn btn--secondary pipeline-log-toggle"
            onClick={() => setShowMobileLog(true)}
          >
            Event log
          </button>
        </div>
      </div>

      <div className="pipeline-summary-grid">
        <div className="pipeline-summary-card">
          <div className="pipeline-summary-label">Completed agents</div>
          <div className="pipeline-summary-value">{completedAgents}/{AGENT_DEFS.length}</div>
        </div>
        <div className="pipeline-summary-card">
          <div className="pipeline-summary-label">Runtime</div>
          <div className="pipeline-summary-value">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>
        <div className="pipeline-summary-card">
          <div className="pipeline-summary-label">Events captured</div>
          <div className="pipeline-summary-value">{logLines.length}</div>
        </div>
        <div className="pipeline-summary-card">
          <div className="pipeline-summary-label">Review gate</div>
          <div className="pipeline-summary-value">{done || allowReviewBypass ? 'Ready' : 'Locked'}</div>
        </div>
      </div>

      <div className="pipeline-controls">
        <div className="pipeline-controls-main">
          {!running && (
            <button className="btn btn--primary btn--lg" onClick={startPipeline}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
              </svg>
              {done ? 'Run again' : 'Run pipeline'}
            </button>
          )}
          {running && (
            <button className="btn btn--secondary btn--lg" disabled>
              <span className="btn-spinner" />
              Running pipeline
            </button>
          )}
          {(done || allowReviewBypass) && onReviewReady && (
            <button className="btn btn--primary" onClick={onReviewReady}>
              Open review stage
            </button>
          )}
        </div>
        <div className="pipeline-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
          <div className="pipeline-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="pipeline-stage-grid">
        {majorStages.map((stage) => (
          <div key={stage.id} className={`pipeline-stage-card is-${stage.status}`}>
            <div className="pipeline-stage-title-row">
              <div className="pipeline-stage-title">{stage.label}</div>
              <span className={`badge ${stage.status === 'done' ? 'badge--green' : stage.status === 'running' ? 'badge--blue' : stage.status === 'error' ? 'badge--red' : 'badge--gray'}`}>
                {stage.status}
              </span>
            </div>
            <p className="pipeline-stage-description">{stage.description}</p>
            <div className="pipeline-stage-meta">{stage.completed}/{stage.total} agents complete</div>
          </div>
        ))}
      </div>

      <div className="pipeline-layout">
        <div className="pipeline-main-stack">
          <div className="pipeline-main">
            <div className="pipeline-graph" role="list" aria-label="Agent pipeline graph">
              {steps.map((step, i) => {
                const nodeDone = done || step.status === 'done';
                const nodeStatus = nodeDone ? 'done' : step.status;
                const nodeCount = fieldCounts[step.id];
                const isSelected = selectedAgent?.id === step.id;
                return (
                  <div key={step.id} className="pipeline-node-cluster" role="listitem" aria-label={step.label}>
                    <button
                      type="button"
                      className={`pipeline-node-wrap ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedAgentId(step.id)}
                    >
                      <div className={`pipeline-node pipeline-node--${nodeStatus}`}>
                        <svg className="pipeline-node-hex" viewBox="0 0 72 72" fill="none" aria-hidden>
                          <path
                            d="M36 4L66 20.5v31L36 68 6 51.5v-31L36 4z"
                            className="pipeline-node-hex-path"
                          />
                        </svg>
                        <span className="pipeline-node-label">{getAgentInitials(step.label)}</span>
                        {step.status === 'running' && !done && <div className="pipeline-node-spinner" />}
                      </div>
                      <div className="pipeline-node-name">{step.label}</div>
                      {nodeDone && nodeCount !== undefined && (
                        <div className="pipeline-node-count">{nodeCount} fields</div>
                      )}
                    </button>
                    {i < steps.length - 1 && (
                      <div className={`pipeline-beam ${nodeDone ? 'pipeline-beam--active' : ''}`} aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pipeline-agent-detail">
            <div className="pipeline-agent-detail-head">
              <div>
                <div className="pipeline-agent-detail-title">{selectedAgent?.label ?? 'Select an agent'}</div>
                <div className="pipeline-agent-detail-subtitle">{selectedAgentDef?.description ?? 'Click any agent node to inspect detailed output and status.'}</div>
              </div>
              {selectedAgent && (
                <span className={`badge ${
                  selectedAgent.status === 'done'
                    ? 'badge--green'
                    : selectedAgent.status === 'running'
                      ? 'badge--blue'
                      : selectedAgent.status === 'error'
                        ? 'badge--red'
                        : 'badge--gray'
                }`}>
                  {selectedAgent.status}
                </span>
              )}
            </div>
            <div className="pipeline-agent-detail-output">
              {selectedAgent?.output ?? (running ? 'Awaiting detailed output from this agent...' : 'No agent output yet.')}
            </div>
          </div>
        </div>

        <aside className="pipeline-log pipeline-log--desktop" aria-live="polite">
          <div className="pipeline-log-header">
            <span>Event Log</span>
            <div className="pipeline-log-controls">
              <select
                className="form-select pipeline-log-filter"
                value={logFilter}
                onChange={(event) => setLogFilter(event.target.value as LogFilter)}
                aria-label="Filter event log"
              >
                <option value="all">All</option>
                <option value="agent">Agent</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
              <button
                className="btn btn--xs btn--secondary"
                onClick={() => setAutoScrollLog((prev) => !prev)}
                aria-pressed={autoScrollLog}
              >
                Auto-scroll: {autoScrollLog ? 'On' : 'Off'}
              </button>
            </div>
          </div>
          <div className="pipeline-log-body" ref={logBodyRef}>
            {filteredLogLines.length === 0 && (
              <div className="pipeline-log-line pipeline-log-line--empty">
                <span className="pipeline-log-time">--:--:--</span>
                <span className="pipeline-log-text">Waiting for orchestration events...</span>
              </div>
            )}
            {filteredLogLines.map((line, index) => (
              <div key={`${line.time}-${index}`} className={`pipeline-log-line level-${classifyLogLine(line.text)}`}>
                <span className="pipeline-log-time">{line.time}</span>
                <span className="pipeline-log-text">{line.text}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Error state */}
      {error && (
        <div className="validation-box validation-box--error" style={{ marginTop: '24px' }}>
          <div className="validation-box-title">Pipeline error</div>
          <p style={{ margin: 0, fontSize: '14px' }}>{error}</p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            {allowReviewBypass && onReviewReady && (
              <button
                className="btn btn--primary"
                onClick={onReviewReady}
              >
                Open review stage
              </button>
            )}
            <button
              className="btn btn--secondary"
              onClick={() => { setError(null); startPipeline(); }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Completion fallback while final result sync is pending */}
      {running && allowReviewBypass && onReviewReady && !done && (
        <div className="validation-box validation-box--warn" style={{ marginTop: '24px' }}>
          <div className="validation-box-title">Pipeline completion received</div>
          <p style={{ margin: 0, fontSize: '14px' }}>
            Final result sync is taking longer than expected. You can open review now.
          </p>
          <button
            className="btn btn--primary"
            style={{ marginTop: '12px' }}
            onClick={onReviewReady}
          >
            Open review stage
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
              <span className="pipeline-stat-value">{animatedStats.fields}</span>
              <span className="pipeline-stat-label">Fields mapped</span>
            </div>
            <div className="pipeline-stat">
              <span className="pipeline-stat-value">{animatedStats.entities}</span>
              <span className="pipeline-stat-label">Entities matched</span>
            </div>
            <div className="pipeline-stat">
              <span
                className="pipeline-stat-value"
                style={{ color: result.complianceFlags > 0 ? 'var(--warning)' : 'var(--success)' }}
              >
                {animatedStats.flags}
              </span>
              <span className="pipeline-stat-label">Compliance flags</span>
            </div>
            <div className="pipeline-stat">
              <span
                className="pipeline-stat-value"
                style={{ color: result.validation.summary.totalWarnings > 0 ? 'var(--danger)' : 'var(--success)' }}
              >
                {animatedStats.warnings}
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

      {showMobileLog && (
        <div className="pipeline-log-drawer-overlay" onClick={() => setShowMobileLog(false)}>
          <div className="pipeline-log-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="pipeline-log-header">
              <span>Event Log</span>
              <button className="btn btn--secondary btn--sm" onClick={() => setShowMobileLog(false)}>
                Close
              </button>
            </div>
            <div className="pipeline-log-controls pipeline-log-controls--drawer">
              <select
                className="form-select pipeline-log-filter"
                value={logFilter}
                onChange={(event) => setLogFilter(event.target.value as LogFilter)}
                aria-label="Filter event log"
              >
                <option value="all">All</option>
                <option value="agent">Agent</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
              <button
                className="btn btn--xs btn--secondary"
                onClick={() => setAutoScrollLog((prev) => !prev)}
                aria-pressed={autoScrollLog}
              >
                Auto-scroll: {autoScrollLog ? 'On' : 'Off'}
              </button>
            </div>
            <div className="pipeline-log-body">
              {filteredLogLines.length === 0 && (
                <div className="pipeline-log-line pipeline-log-line--empty">
                  <span className="pipeline-log-time">--:--:--</span>
                  <span className="pipeline-log-text">Waiting for orchestration events...</span>
                </div>
              )}
              {filteredLogLines.map((line, index) => (
                <div key={`mobile-${line.time}-${index}`} className={`pipeline-log-line level-${classifyLogLine(line.text)}`}>
                  <span className="pipeline-log-time">{line.time}</span>
                  <span className="pipeline-log-text">{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
