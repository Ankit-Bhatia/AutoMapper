import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isDemoUiMode, resetMockState } from './api/client';
import { Sidebar } from './components/Sidebar';
import { ConnectorGrid } from './components/ConnectorGrid';
import { AgentPipeline } from './components/AgentPipeline';
import { MappingTable } from './components/MappingTable';
import { ExportPanel } from './components/ExportPanel';
import type {
  Entity,
  EntityMapping,
  Field,
  FieldMapping,
  Project,
  ProjectPayload,
  ValidationReport,
  WorkflowStep,
} from './types';

// Connector id → display name for sidebar
const CONNECTOR_NAMES: Record<string, string> = {
  'jackhenry-silverlake': 'SilverLake',
  'jackhenry-coredirector': 'Core Director',
  'jackhenry-symitar': 'Symitar',
  salesforce: 'Salesforce',
  sap: 'SAP S/4HANA',
};

interface PipelineResult {
  entityMappings: EntityMapping[];
  fieldMappings: FieldMapping[];
  validation: ValidationReport;
  totalMappings: number;
  complianceFlags: number;
  processingMs: number;
}

export default function App() {
  const demoUiMode = isDemoUiMode();
  // ── Workflow state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<WorkflowStep>('connect');
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // ── Project state ───────────────────────────────────────────────────────────
  const [project, setProject] = useState<Project | null>(null);
  const [sourceConnectorId, setSourceConnectorId] = useState<string | null>(null);
  const [targetConnectorId, setTargetConnectorId] = useState<string | null>(null);

  // ── Schema / mapping state ──────────────────────────────────────────────────
  const [sourceEntities, setSourceEntities] = useState<Entity[]>([]);
  const [targetEntities, setTargetEntities] = useState<Entity[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [entityMappings, setEntityMappings] = useState<EntityMapping[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [sourceSchemaMode, setSourceSchemaMode] = useState<'live' | 'mock' | 'uploaded' | null>(null);
  const [targetSchemaMode, setTargetSchemaMode] = useState<'live' | 'mock' | 'uploaded' | null>(null);
  const [validation, setValidation] = useState<ValidationReport>({
    warnings: [],
    summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
  });
  const [isOrchestrated, setIsOrchestrated] = useState(false);

  // ── Salesforce OAuth callback handling ──────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sf_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── Reload project data from API ────────────────────────────────────────────
  const loadProject = useCallback(async (pid: string) => {
    const data = await api<ProjectPayload>(`/api/projects/${pid}`);
    setProject(data.project);
    setSourceEntities(data.sourceEntities);
    setTargetEntities(data.targetEntities);
    setFields(data.fields);
    setEntityMappings(data.entityMappings);
    setFieldMappings(data.fieldMappings);
  }, []);

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

      // 6. Move to orchestrate step
      setStep('orchestrate');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Setup failed';
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
    // Auto-advance to review
    setTimeout(() => setStep('review'), 800);
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
  }

  // ── Step 3: MappingTable → update single mapping ───────────────────────────
  function handleMappingUpdate(updated: FieldMapping) {
    setFieldMappings((prev) => prev.map((fm) => (fm.id === updated.id ? updated : fm)));
  }

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
          <>
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
          </>
        );

      case 'orchestrate':
        return project ? (
          <AgentPipeline
            projectId={project.id}
            onComplete={handlePipelineComplete}
            onError={(msg) => console.error('Pipeline error:', msg)}
          />
        ) : null;

      case 'review':
        return project ? (
          <MappingTable
            projectId={project.id}
            sourceEntities={sourceEntities}
            targetEntities={targetEntities}
            fields={fields}
            entityMappings={entityMappings}
            fieldMappings={fieldMappings}
            validation={validation}
            onMappingUpdate={handleMappingUpdate}
            onProceedToExport={() => setStep('export')}
          />
        ) : null;

      case 'export':
        return project ? (
          <ExportPanel
            projectId={project.id}
            fieldMappingCount={fieldMappings.length}
            entityMappingCount={entityMappings.length}
            acceptedCount={acceptedCount}
            validation={validation}
          />
        ) : null;
    }
  }

  return (
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
  );
}
