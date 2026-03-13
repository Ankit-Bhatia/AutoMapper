import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isDemoUiMode, resetMockState } from '@core/api-client';
import { Sidebar } from './components/Sidebar';
import { ConnectorGrid } from './components/ConnectorGrid';
import { AgentPipeline } from './components/AgentPipeline';
import { MappingTable } from './components/MappingTable';
import { ConflictDrawer } from './components/ConflictDrawer';
import { ExportPanel } from './components/ExportPanel';
import { BulkActionBar, type BulkOperationResult } from './components/BulkActionBar';
import { LandingPage } from './components/LandingPage';
import { SeedSummaryCard } from './components/SeedSummaryCard';
import { ProjectHistoryPanel } from './components/ProjectHistoryPanel';
import {
  LLMSettingsPanel,
  type LLMConfigUpdatePayload,
} from './components/LLMSettingsPanel';
import { reportFrontendError, setErrorReportingContext } from './telemetry/errorReporting';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  LLMConfigResponse,
  LLMUsageResponse,
  MappingConflict,
  ProjectPreflight,
  Project,
  ProjectHistoryItem,
  ProjectListResponse,
  ProjectPayload,
  SeedSummary,
  ValidationReport,
  WorkflowStep,
} from '@contracts';

// Connector id → display name for sidebar
const CONNECTOR_NAMES: Record<string, string> = {
  'jackhenry-silverlake': 'SilverLake',
  'jackhenry-coredirector': 'Core Director',
  'jackhenry-symitar': 'Symitar',
  salesforce: 'Salesforce',
  sap: 'SAP S/4HANA',
};

function connectorIdFromSystemName(name?: string): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (normalized.includes('silverlake')) return 'jackhenry-silverlake';
  if (normalized.includes('core director') || normalized.includes('coredirector')) return 'jackhenry-coredirector';
  if (normalized.includes('symitar')) return 'jackhenry-symitar';
  if (normalized.includes('salesforce')) return 'salesforce';
  if (normalized.includes('sap')) return 'sap';
  return null;
}

function isLLMConfigResponse(value: unknown): value is LLMConfigResponse {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<LLMConfigResponse>;
  return Boolean(maybe.config && typeof maybe.config.mode === 'string' && typeof maybe.effectiveProvider === 'string');
}

function isLLMUsageResponse(value: unknown): value is LLMUsageResponse {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<LLMUsageResponse>;
  return Boolean(maybe.summary && Array.isArray(maybe.events));
}

interface PipelineResult {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
  totalMappings: number;
  complianceFlags: number;
  processingMs: number;
}

export function MappingStudioApp() {
  const demoUiMode = isDemoUiMode();
  const [showLanding, setShowLanding] = useState<boolean>(true);
  // ── Workflow state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<WorkflowStep>('connect');
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // ── Project state ───────────────────────────────────────────────────────────
  const [project, setProject] = useState<Project | null>(null);
  const [sourceConnectorId, setSourceConnectorId] = useState<string | null>(null);
  const [targetConnectorId, setTargetConnectorId] = useState<string | null>(null);
  const [projectHistory, setProjectHistory] = useState<ProjectHistoryItem[]>([]);
  const [projectHistoryLoading, setProjectHistoryLoading] = useState(false);
  const [projectHistoryError, setProjectHistoryError] = useState<string | null>(null);

  // ── Schema / mapping state ──────────────────────────────────────────────────
  const [sourceEntities, setSourceEntities] = useState<Entity[]>([]);
  const [targetEntities, setTargetEntities] = useState<Entity[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [entityMappings, setEntityMappings] = useState<EntityMapping[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [sourceSchemaMode, setSourceSchemaMode] = useState<'live' | 'mock' | 'uploaded' | null>(null);
  const [targetSchemaMode, setTargetSchemaMode] = useState<'live' | 'mock' | 'uploaded' | null>(null);
  const [seedSummary, setSeedSummary] = useState<SeedSummary | null>(null);
  const [seedSummaryAcknowledged, setSeedSummaryAcknowledged] = useState(true);
  const [conflicts, setConflicts] = useState<MappingConflict[]>([]);
  const [conflictDrawerOpen, setConflictDrawerOpen] = useState(false);
  const [preflight, setPreflight] = useState<ProjectPreflight | null>(null);
  const [reviewGateMessage, setReviewGateMessage] = useState<string | null>(null);
  const [selectedMappingIds, setSelectedMappingIds] = useState<Set<string>>(new Set());
  const [validation, setValidation] = useState<ValidationReport>({
    warnings: [],
    summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
  });
  const [isOrchestrated, setIsOrchestrated] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfigResponse | null>(null);
  const [llmUsage, setLlmUsage] = useState<LLMUsageResponse | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  // ── Salesforce OAuth callback handling ──────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sf_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    setErrorReportingContext({
      workflowStep: step,
      projectId: project?.id,
      sourceConnectorId,
      targetConnectorId,
    });
  }, [project?.id, sourceConnectorId, step, targetConnectorId]);

  // ── Reload project data from API ────────────────────────────────────────────
  const loadProject = useCallback(async (pid: string) => {
    const data = await api<ProjectPayload>(`/api/projects/${pid}`);
    setProject(data.project);
    setSourceEntities(data.sourceEntities);
    setTargetEntities(data.targetEntities);
    setFields(data.fields);
    setEntityMappings(data.entityMappings);
    setFieldMappings(data.fieldMappings);
    return data;
  }, []);

  const refreshConflicts = useCallback(async (pid: string) => {
    try {
      const data = await api<{ conflicts: MappingConflict[] }>(`/api/projects/${pid}/conflicts`);
      setConflicts(data.conflicts);
      if (data.conflicts.length === 0) {
        setConflictDrawerOpen(false);
      }
      return data.conflicts;
    } catch {
      setConflicts([]);
      return [];
    }
  }, []);

  const refreshPreflight = useCallback(async (pid: string) => {
    try {
      const data = await api<ProjectPreflight>(`/api/projects/${pid}/preflight`);
      setPreflight(data);
      return data;
    } catch {
      setPreflight(null);
      return null;
    }
  }, []);

  const loadProjectHistory = useCallback(async () => {
    setProjectHistoryLoading(true);
    setProjectHistoryError(null);
    try {
      const data = await api<ProjectListResponse>('/api/projects');
      setProjectHistory(data.projects ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load project history';
      setProjectHistoryError(message);
      setProjectHistory([]);
    } finally {
      setProjectHistoryLoading(false);
    }
  }, []);

  const refreshLlmTelemetry = useCallback(async () => {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const [configData, usageData] = await Promise.all([
        api<LLMConfigResponse>('/api/llm/config'),
        api<LLMUsageResponse>('/api/llm/usage?limit=100&windowHours=24'),
      ]);
      setLlmConfig(isLLMConfigResponse(configData) ? configData : null);
      setLlmUsage(
        isLLMUsageResponse(usageData)
          ? usageData
          : {
            summary: {
              totalCalls: 0,
              successfulCalls: 0,
              failedCalls: 0,
              totalTokens: 0,
              callsByProvider: {},
              windowHours: 24,
            },
            events: [],
          },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load LLM settings';
      setLlmError(message);
      setLlmConfig(null);
      setLlmUsage(null);
    } finally {
      setLlmLoading(false);
    }
  }, []);

  const saveLlmConfig = useCallback(async (payload: LLMConfigUpdatePayload) => {
    setLlmSaving(true);
    setLlmError(null);
    try {
      const updated = await api<LLMConfigResponse>('/api/llm/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (isLLMConfigResponse(updated)) {
        setLlmConfig(updated);
      }
      const usageData = await api<LLMUsageResponse>('/api/llm/usage?limit=100&windowHours=24');
      if (isLLMUsageResponse(usageData)) {
        setLlmUsage(usageData);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save LLM settings';
      setLlmError(message);
      throw error;
    } finally {
      setLlmSaving(false);
    }
  }, []);

  const openPastProject = useCallback(async (projectId: string, destination: 'review' | 'export') => {
    setLoadingSetup(true);
    setSetupError(null);
    setReviewGateMessage(null);
    setSeedSummary(null);
    setSeedSummaryAcknowledged(true);
    setSourceSchemaMode(null);
    setTargetSchemaMode(null);
    setSelectedMappingIds(new Set());

    try {
      const payload = await loadProject(projectId);
      const history = projectHistory.find((item) => item.project.id === projectId);

      const sourceId =
        connectorIdFromSystemName(history?.sourceSystem?.name)
        ?? history?.sourceSystem?.name
        ?? null;
      const targetId =
        connectorIdFromSystemName(history?.targetSystem?.name)
        ?? history?.targetSystem?.name
        ?? null;

      setSourceConnectorId(sourceId);
      setTargetConnectorId(targetId);

      const [preflightData] = await Promise.all([
        refreshPreflight(projectId),
        refreshConflicts(projectId),
      ]);

      const hasMappings = payload.fieldMappings.length > 0;
      setIsOrchestrated(hasMappings);

      if (!hasMappings) {
        setStep('orchestrate');
        setSetupError('This project has no saved mappings yet. Run orchestration to generate mappings first.');
        return;
      }

      if (destination === 'export') {
        if (preflightData?.canExport) {
          setStep('export');
        } else {
          setStep('review');
          setReviewGateMessage('Resolve blockers before exporting this historical project.');
        }
      } else {
        setStep('review');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open project';
      setSetupError(message);
    } finally {
      setLoadingSetup(false);
    }
  }, [loadProject, projectHistory, refreshConflicts, refreshPreflight]);

  useEffect(() => {
    if (showLanding) return;
    void loadProjectHistory();
    void refreshLlmTelemetry();
  }, [loadProjectHistory, refreshLlmTelemetry, showLanding]);

  // ── Step 1: ConnectorGrid → proceed ────────────────────────────────────────
  async function handleConnectorProceed(
    srcId: string,
    tgtId: string,
    options?: { projectName?: string; sourceFile?: File | null; targetFile?: File | null },
  ) {
    setLoadingSetup(true);
    setSetupError(null);
    setSourceConnectorId(srcId);
    setTargetConnectorId(tgtId);

    try {
      // 1. Create project
      const projectData = await api<{ project: Project }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: options?.projectName || `${CONNECTOR_NAMES[srcId] ?? srcId} → ${CONNECTOR_NAMES[tgtId] ?? tgtId}`,
          sourceSystemName: srcId,
          targetSystemName: tgtId,
        }),
      });
      const newProject = projectData.project;
      setProject(newProject);

      // 2. Ingest source schema
      let sourceSchema: { mode?: 'live' | 'mock' | 'uploaded' };
      if (options?.sourceFile) {
        const form = new FormData();
        form.append('side', 'source');
        form.append('systemType', srcId);
        form.append('file', options.sourceFile);
        sourceSchema = await api<{ mode?: 'live' | 'mock' | 'uploaded' }>(
          `/api/projects/${newProject.id}/schema/upload-file`,
          { method: 'POST', body: form },
        );
      } else {
        sourceSchema = await api<{ mode?: 'live' | 'mock' | 'uploaded' }>(`/api/projects/${newProject.id}/schema/${srcId}`, {
          method: 'POST',
          body: JSON.stringify({ side: 'source' }),
        });
      }
      setSourceSchemaMode(sourceSchema.mode ?? null);

      // 3. Ingest target schema
      let targetSchema: { mode?: 'live' | 'mock' | 'uploaded' };
      if (options?.targetFile) {
        const form = new FormData();
        form.append('side', 'target');
        form.append('systemType', tgtId);
        form.append('file', options.targetFile);
        targetSchema = await api<{ mode?: 'live' | 'mock' | 'uploaded' }>(
          `/api/projects/${newProject.id}/schema/upload-file`,
          { method: 'POST', body: form },
        );
      } else {
        targetSchema = await api<{ mode?: 'live' | 'mock' | 'uploaded' }>(`/api/projects/${newProject.id}/schema/${tgtId}`, {
          method: 'POST',
          body: JSON.stringify({ side: 'target' }),
        });
      }
      setTargetSchemaMode(targetSchema.mode ?? null);

      // 4. Generate heuristic mapping suggestions (populates pre-orchestration state)
      const suggestions = await api<{
        entityMappings: EntityMapping[];
        fieldMappings: FieldMapping[];
        validation: ValidationReport;
      }>(`/api/projects/${newProject.id}/suggest-mappings`, {
        method: 'POST',
        body: '{}',
      });

      setEntityMappings(suggestions.entityMappings);
      setFieldMappings(suggestions.fieldMappings);
      setValidation(suggestions.validation);

      // 5. Load full project data (entities + fields)
      await loadProject(newProject.id);

      // 6. Run three-layer seeding (derived -> canonical -> agent) and refresh state
      let seededSummary: SeedSummary | null = null;
      try {
        const seedResult = await api<{ summary: SeedSummary }>(`/api/projects/${newProject.id}/seed`, {
          method: 'POST',
          body: '{}',
        });
        seededSummary = seedResult.summary;
        await loadProject(newProject.id);
      } catch {
        seededSummary = null;
      }

      if (seededSummary && seededSummary.total > 0) {
        setSeedSummary(seededSummary);
        setSeedSummaryAcknowledged(false);
      } else {
        setSeedSummary(null);
        setSeedSummaryAcknowledged(true);
      }

      // 7. Move to orchestrate step
      void loadProjectHistory();
      setStep('orchestrate');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Setup failed';
      void reportFrontendError({
        source: 'frontend',
        code: 'SETUP_FLOW_ERROR',
        message: msg,
        error: err,
        projectId: project?.id,
        context: {
          sourceConnectorId: srcId,
          targetConnectorId: tgtId,
          during: 'handleConnectorProceed',
        },
      });
      setSetupError(msg);
      // Reset connector selections so user can retry
      setSourceConnectorId(null);
      setTargetConnectorId(null);
      setProject(null);
      setSourceSchemaMode(null);
      setTargetSchemaMode(null);
    } finally {
      setLoadingSetup(false);
    }
  }

  // ── Step 2: AgentPipeline → complete ───────────────────────────────────────
  function handlePipelineComplete(result: PipelineResult) {
    setEntityMappings(result.entityMappings);
    setFieldMappings(result.fieldMappings);
    setValidation(result.validation);
    setIsOrchestrated(true);
  }

  // ── Reset: go back to connector selection ──────────────────────────────────
  function handleReset() {
    resetMockState();
    setStep('connect');
    setProject(null);
    setSourceConnectorId(null);
    setTargetConnectorId(null);
    setSourceSchemaMode(null);
    setTargetSchemaMode(null);
    setSourceEntities([]);
    setTargetEntities([]);
    setFields([]);
    setEntityMappings([]);
    setFieldMappings([]);
    setValidation({ warnings: [], summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 } });
    setIsOrchestrated(false);
    setSetupError(null);
    setSeedSummary(null);
    setSeedSummaryAcknowledged(true);
    setConflicts([]);
    setConflictDrawerOpen(false);
    setPreflight(null);
    setReviewGateMessage(null);
    setSelectedMappingIds(new Set());
    void loadProjectHistory();
  }

  // ── Step 3: MappingTable → update single mapping ───────────────────────────
  function handleMappingUpdate(updated: FieldMapping) {
    setReviewGateMessage(null);
    setFieldMappings((prev) => prev.map((fm) => (fm.id === updated.id ? updated : fm)));
  }

  function handleSelectionChange(mappingId: string, selected: boolean) {
    setSelectedMappingIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(mappingId);
      } else {
        next.delete(mappingId);
      }
      return next;
    });
  }

  async function handleBulkComplete(result: BulkOperationResult) {
    if (!project) return;
    if (result.applied > 0) {
      await loadProject(project.id);
      await refreshPreflight(project.id);
      await refreshConflicts(project.id);
    }
    setSelectedMappingIds(new Set());
  }

  useEffect(() => {
    if (!project) return;
    if (step !== 'review' && step !== 'export') return;
    void refreshPreflight(project.id);
    if (step === 'review') {
      void refreshConflicts(project.id);
    }
  }, [fieldMappings, project, refreshConflicts, refreshPreflight, step]);

  // ── Derived stats ───────────────────────────────────────────────────────────
  const acceptedCount = useMemo(
    () => fieldMappings.filter((fm) => fm.status === 'accepted').length,
    [fieldMappings],
  );

  const sourceConnectorName = sourceConnectorId ? CONNECTOR_NAMES[sourceConnectorId] ?? sourceConnectorId : undefined;
  const targetConnectorName = targetConnectorId ? CONNECTOR_NAMES[targetConnectorId] ?? targetConnectorId : undefined;

  // ── Render main content by step ─────────────────────────────────────────────
  function renderContent() {
    switch (step) {
      case 'connect':
        return (
          <div className="connect-workspace">
            <div className="connect-top-panels">
              <ProjectHistoryPanel
                projects={projectHistory}
                loading={projectHistoryLoading}
                error={projectHistoryError}
                activeProjectId={project?.id ?? null}
                onRefresh={() => { void loadProjectHistory(); }}
                onOpenReview={(projectId) => { void openPastProject(projectId, 'review'); }}
                onOpenExport={(projectId) => { void openPastProject(projectId, 'export'); }}
              />
              <LLMSettingsPanel
                config={llmConfig}
                usage={llmUsage}
                loading={llmLoading}
                saving={llmSaving}
                error={llmError}
                onRefresh={() => { void refreshLlmTelemetry(); }}
                onSave={saveLlmConfig}
              />
            </div>
            <ConnectorGrid
              onProceed={handleConnectorProceed}
              loading={loadingSetup}
            />
            {setupError && (
              <div className="validation-box validation-box--error" style={{ margin: '0 0 0 0' }}>
                <div className="validation-box-title">Setup failed</div>
                <p style={{ margin: 0, fontSize: '14px' }}>{setupError}</p>
              </div>
            )}
          </div>
        );

      case 'orchestrate':
        return project ? (
          seedSummary && !seedSummaryAcknowledged ? (
            <SeedSummaryCard
              summary={seedSummary}
              onContinue={() => setSeedSummaryAcknowledged(true)}
            />
          ) : (
            <AgentPipeline
              projectId={project.id}
              onComplete={handlePipelineComplete}
              sourceConnectorName={sourceConnectorName}
              targetConnectorName={targetConnectorName}
              sourceSchemaMode={sourceSchemaMode ?? undefined}
              targetSchemaMode={targetSchemaMode ?? undefined}
              onReviewReady={() => {
                setIsOrchestrated(true);
                setStep('review');
              }}
              onError={(msg) => {
                void reportFrontendError({
                  source: 'frontend',
                  code: 'PIPELINE_UI_ERROR',
                  message: msg,
                  projectId: project.id,
                  context: { workflowStep: 'orchestrate' },
                });
                console.error('Pipeline error:', msg);
              }}
            />
          )
        ) : null;

      case 'review':
        return project ? (
          <>
            {reviewGateMessage && (
              <div className="validation-box validation-box--error" style={{ marginBottom: '16px' }}>
                <div className="validation-box-title">Pre-flight gate</div>
                <p style={{ margin: 0, fontSize: '14px' }}>{reviewGateMessage}</p>
              </div>
            )}
            <BulkActionBar
              projectId={project.id}
              selectedIds={[...selectedMappingIds]}
              onComplete={(result) => {
                void handleBulkComplete(result);
              }}
              onClear={() => setSelectedMappingIds(new Set())}
            />
            <MappingTable
              projectId={project.id}
              sourceEntities={sourceEntities}
              targetEntities={targetEntities}
              fields={fields}
              entityMappings={entityMappings}
              fieldMappings={fieldMappings}
              validation={validation}
              conflicts={conflicts}
              unresolvedConflicts={preflight?.unresolvedConflicts ?? conflicts.length}
              onOpenConflicts={() => setConflictDrawerOpen(true)}
              selectedIds={selectedMappingIds}
              onSelectionChange={handleSelectionChange}
              selectionCap={200}
              onMappingUpdate={handleMappingUpdate}
              onProceedToExport={() => {
                const unresolved = preflight?.unresolvedConflicts ?? conflicts.length;
                if (unresolved > 0) {
                  setReviewGateMessage(
                    `Resolve ${unresolved} unresolved conflict${unresolved === 1 ? '' : 's'} before export.`,
                  );
                  setConflictDrawerOpen(true);
                  return;
                }
                setReviewGateMessage(null);
                setStep('export');
              }}
            />
            <ConflictDrawer
              projectId={project.id}
              conflicts={conflicts}
              allMappings={fieldMappings}
              fields={fields}
              entities={[...sourceEntities, ...targetEntities]}
              open={conflictDrawerOpen}
              onClose={() => setConflictDrawerOpen(false)}
              onResolved={(updatedConflictCount) => {
                setReviewGateMessage(null);
                if (updatedConflictCount === 0) {
                  setConflictDrawerOpen(false);
                }
                void loadProject(project.id);
                void refreshConflicts(project.id);
                void refreshPreflight(project.id);
              }}
            />
          </>
        ) : null;

      case 'export':
        return project ? (
          <ExportPanel
            projectId={project.id}
            fieldMappingCount={fieldMappings.length}
            entityMappingCount={entityMappings.length}
            acceptedCount={acceptedCount}
            validation={validation}
            fields={fields}
            fieldMappings={fieldMappings}
            targetEntities={targetEntities}
          />
        ) : null;
    }
  }

  return (
    showLanding ? (
      <LandingPage onEnterStudio={() => setShowLanding(false)} />
    ) : (
      <div className="app-shell">
        <Sidebar
          currentStep={step}
          onStepClick={setStep}
          onReset={handleReset}
          projectName={project?.name}
          sourceConnector={sourceConnectorName}
          targetConnector={targetConnectorName}
          sourceSchemaMode={sourceSchemaMode ?? undefined}
          targetSchemaMode={targetSchemaMode ?? undefined}
          mappingCount={fieldMappings.length}
          isOrchestrated={isOrchestrated}
          isDemoMode={demoUiMode}
        />
        <main className="main-content">
          {renderContent()}
        </main>
      </div>
    )
  );
}
