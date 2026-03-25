import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EntityMapping, Field, FieldMapping, Project } from '@contracts';
import { MappingStudioApp } from './MappingStudioApp';

const apiMock = vi.fn();
const authState = {
  user: {
    id: 'user-1',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'ADMIN',
    orgSlug: 'default',
  },
};

const project: Project = {
  id: 'project-1',
  name: 'Test Project',
  sourceSystemId: 'source-system-1',
  targetSystemId: 'target-system-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const sourceEntity = {
  id: 'source-entity-1',
  systemId: project.sourceSystemId,
  name: 'LOAN',
};

const targetEntity = {
  id: 'target-entity-1',
  systemId: project.targetSystemId,
  name: 'FinancialAccount',
};

const sourceField: Field = {
  id: 'source-field-1',
  entityId: sourceEntity.id,
  name: 'AMT_APPROVED_LOAN',
  dataType: 'decimal',
};

const targetRequiredField: Field = {
  id: 'target-field-1',
  entityId: targetEntity.id,
  name: 'LoanAmount__c',
  dataType: 'decimal',
  required: true,
};

const entityMapping: EntityMapping = {
  id: 'entity-map-1',
  projectId: project.id,
  sourceEntityId: sourceEntity.id,
  targetEntityId: targetEntity.id,
  confidence: 0.91,
  rationale: 'test',
};

const fieldMapping: FieldMapping = {
  id: 'field-map-1',
  entityMappingId: entityMapping.id,
  sourceFieldId: sourceField.id,
  targetFieldId: targetRequiredField.id,
  transform: { type: 'direct' as const, config: {} },
  confidence: 0.88,
  rationale: 'test',
  status: 'accepted' as const,
};

let pipelineFieldMappings: FieldMapping[] = [fieldMapping];

vi.mock('@core/api-client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  isDemoUiMode: () => false,
  resetMockState: vi.fn(),
}));

vi.mock('./telemetry/errorReporting', () => ({
  reportFrontendError: vi.fn(async () => ({})),
  setErrorReportingContext: vi.fn(),
}));

vi.mock('./auth/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: ({
    currentStep,
    onStepClick,
    onThemeChange,
  }: {
    currentStep: string;
    onStepClick: (step: string) => void;
    onThemeChange: (theme: 'dark' | 'light') => void;
  }) => (
    <div>
      <div data-testid="sidebar-step">{currentStep}</div>
      <button onClick={() => onStepClick('llm-settings')}>Open LLM Settings</button>
      <button onClick={() => onThemeChange('light')}>Switch Light Theme</button>
      <button onClick={() => onThemeChange('dark')}>Switch Dark Theme</button>
    </div>
  ),
}));

vi.mock('./components/ConnectorGrid', () => ({
  ConnectorGrid: ({ onProceed }: { onProceed: (src: string, tgt: string) => void }) => (
    <button onClick={() => onProceed('jackhenry-silverlake', 'salesforce')}>Connect Systems</button>
  ),
}));

vi.mock('./components/AgentPipeline', () => ({
  AgentPipeline: ({
    onComplete,
    onReviewReady,
  }: {
    onComplete: (result: {
      entityMappings: typeof entityMapping[];
      fieldMappings: typeof fieldMapping[];
      validation: {
        warnings: unknown[];
        summary: {
          totalWarnings: number;
          typeMismatch: number;
          missingRequired: number;
          picklistCoverage: number;
          validationRule: number;
        };
      };
      totalMappings: number;
      complianceFlags: number;
      processingMs: number;
    }) => void;
    onReviewReady?: () => void;
  }) => (
    <button
      onClick={() => {
        onComplete({
          entityMappings: [entityMapping],
          fieldMappings: pipelineFieldMappings,
          validation: {
            warnings: [],
            summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0, validationRule: 0 },
          },
          totalMappings: 1,
          complianceFlags: 0,
          processingMs: 2000,
        });
        onReviewReady?.();
      }}
    >
      Finish Pipeline
    </button>
  ),
}));

vi.mock('./components/MappingTable', () => ({
  MappingTable: ({ onProceedToExport }: { onProceedToExport?: () => void }) => (
    <button onClick={onProceedToExport}>Proceed To Export</button>
  ),
}));

vi.mock('./components/ExportPanel', () => ({
  ExportPanel: () => <div>Export Panel Visible</div>,
}));

vi.mock('./components/OneToManyResolverPanel', () => ({
  OneToManyResolverPanel: () => <div>Routing Resolver Visible</div>,
}));

vi.mock('./components/ConflictDrawer', () => ({
  ConflictDrawer: () => null,
}));

vi.mock('./components/SeedSummaryCard', () => ({
  SeedSummaryCard: () => null,
}));

describe('MappingStudioApp export gating', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = '';
    authState.user = {
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'ADMIN',
      orgSlug: 'default',
    };
    pipelineFieldMappings = [fieldMapping];
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (path === '/api/projects' && method === 'POST') {
        return { project };
      }

      if (path === `/api/projects/${project.id}/schema/jackhenry-silverlake` && method === 'POST') {
        return { mode: 'mock' };
      }

      if (path === `/api/projects/${project.id}/schema/salesforce` && method === 'POST') {
        return { mode: 'mock' };
      }

      if (path === `/api/projects/${project.id}/suggest-mappings` && method === 'POST') {
        return {
          entityMappings: [entityMapping],
          fieldMappings: [fieldMapping],
          validation: {
            warnings: [],
            summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0, validationRule: 0 },
          },
        };
      }

      if (path === `/api/projects/${project.id}` && method === 'GET') {
        return {
          project,
          sourceEntities: [sourceEntity],
          targetEntities: [targetEntity],
          fields: [sourceField, targetRequiredField],
          entityMappings: [entityMapping],
          fieldMappings: [fieldMapping],
        };
      }

      if (path === `/api/projects/${project.id}/seed` && method === 'POST') {
        return { summary: { fromDerived: 0, fromCanonical: 0, fromAgent: 0, total: 0 } };
      }

      if (path === `/api/projects/${project.id}/conflicts` && method === 'GET') {
        return { conflicts: [] };
      }

      if (path === `/api/projects/${project.id}/preflight` && method === 'GET') {
        return {
          projectId: project.id,
          mappedTargetCount: 0,
          targetFieldCount: 1,
          acceptedMappingsCount: 0,
          suggestedMappingsCount: 1,
          rejectedMappingsCount: 0,
          unmappedRequiredFields: [{ id: targetRequiredField.id, name: targetRequiredField.name }],
          unresolvedConflicts: 0,
          unresolvedRoutingDecisions: 0,
          canExport: false,
        };
      }

      return {};
    });
  });

  it('allows navigation to Export from Review even when required target fields are still unmapped', async () => {
    const user = userEvent.setup();
    render(<MappingStudioApp initialView="new" />);

    await user.click(screen.getByRole('button', { name: 'Connect Systems' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Finish Pipeline' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Finish Pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Proceed To Export' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Proceed To Export' }));

    await waitFor(() => {
      expect(screen.getByText('Export Panel Visible')).toBeInTheDocument();
    });
  });

  it('blocks export from Review until formula-target mappings are acknowledged', async () => {
    const user = userEvent.setup();
    const formulaFieldMapping = {
      ...fieldMapping,
      id: 'field-map-formula',
      rationale: "⚠️ Formula field target: 'FormulaAmount__c' appears to be a calculated field — inbound writes will fail. Map the source fields that feed this formula instead. | test",
    };
    pipelineFieldMappings = [formulaFieldMapping];

    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (path === '/api/projects' && method === 'POST') return { project };
      if (path === `/api/projects/${project.id}/schema/jackhenry-silverlake` && method === 'POST') return { mode: 'mock' };
      if (path === `/api/projects/${project.id}/schema/salesforce` && method === 'POST') return { mode: 'mock' };
      if (path === `/api/projects/${project.id}/suggest-mappings` && method === 'POST') {
        return {
          entityMappings: [entityMapping],
          fieldMappings: [formulaFieldMapping],
          validation: {
            warnings: [],
            summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0, validationRule: 0 },
          },
        };
      }
      if (path === `/api/projects/${project.id}` && method === 'GET') {
        return {
          project,
          sourceEntities: [sourceEntity],
          targetEntities: [targetEntity],
          fields: [sourceField, targetRequiredField],
          entityMappings: [entityMapping],
          fieldMappings: [formulaFieldMapping],
        };
      }
      if (path === `/api/projects/${project.id}/seed` && method === 'POST') {
        return { summary: { fromDerived: 0, fromCanonical: 0, fromAgent: 0, total: 0 } };
      }
      if (path === `/api/projects/${project.id}/conflicts` && method === 'GET') return { conflicts: [] };
      if (path === `/api/projects/${project.id}/preflight` && method === 'GET') {
        return {
          projectId: project.id,
          mappedTargetCount: 1,
          targetFieldCount: 1,
          acceptedMappingsCount: 1,
          suggestedMappingsCount: 0,
          rejectedMappingsCount: 0,
          unmappedRequiredFields: [],
          unresolvedConflicts: 0,
          unresolvedRoutingDecisions: 0,
          canExport: true,
        };
      }
      return {};
    });

    render(<MappingStudioApp initialView="new" />);

    await user.click(screen.getByRole('button', { name: 'Connect Systems' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Finish Pipeline' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Finish Pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Proceed To Export' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Proceed To Export' }));

    await waitFor(() => {
      expect(screen.getByText(/acknowledge 1 formula field warning before export/i)).toBeInTheDocument();
      expect(screen.queryByText('Export Panel Visible')).not.toBeInTheDocument();
    });
  });

  it('routes the user to the resolver before export when one-to-many routing is unresolved', async () => {
    const user = userEvent.setup();
    pipelineFieldMappings = [{
      ...fieldMapping,
      id: 'field-map-routing',
      rationale: '⚠️ One-to-Many field: AMT_PAYMENT can route to multiple Salesforce targets. | test',
      status: 'modified' as const,
    }];

    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();

      if (path === '/api/projects' && method === 'POST') return { project };
      if (path === `/api/projects/${project.id}/schema/jackhenry-silverlake` && method === 'POST') return { mode: 'mock' };
      if (path === `/api/projects/${project.id}/schema/salesforce` && method === 'POST') return { mode: 'mock' };
      if (path === `/api/projects/${project.id}/suggest-mappings` && method === 'POST') {
        return {
          entityMappings: [entityMapping],
          fieldMappings: pipelineFieldMappings,
          validation: {
            warnings: [],
            summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0, validationRule: 0 },
          },
        };
      }
      if (path === `/api/projects/${project.id}` && method === 'GET') {
        return {
          project,
          sourceEntities: [sourceEntity],
          targetEntities: [targetEntity],
          fields: [sourceField, targetRequiredField],
          entityMappings: [entityMapping],
          fieldMappings: pipelineFieldMappings,
        };
      }
      if (path === `/api/projects/${project.id}/seed` && method === 'POST') {
        return { summary: { fromDerived: 0, fromCanonical: 0, fromAgent: 0, total: 0 } };
      }
      if (path === `/api/projects/${project.id}/conflicts` && method === 'GET') return { conflicts: [] };
      if (path === `/api/projects/${project.id}/preflight` && method === 'GET') {
        return {
          projectId: project.id,
          mappedTargetCount: 1,
          targetFieldCount: 1,
          acceptedMappingsCount: 0,
          suggestedMappingsCount: 1,
          rejectedMappingsCount: 0,
          unmappedRequiredFields: [],
          unresolvedConflicts: 0,
          unresolvedRoutingDecisions: 1,
          canExport: false,
        };
      }
      return {};
    });

    render(<MappingStudioApp initialView="new" />);

    await user.click(screen.getByRole('button', { name: 'Connect Systems' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Finish Pipeline' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Finish Pipeline' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Proceed To Export' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Proceed To Export' }));

    await waitFor(() => {
      expect(screen.getByText('Routing Resolver Visible')).toBeInTheDocument();
    });
  });

  it('shows admin persona settings when an admin opens LLM settings', async () => {
    const user = userEvent.setup();
    render(<MappingStudioApp initialView="new" />);

    await user.click(screen.getAllByRole('button', { name: 'Open LLM Settings' })[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'LLM / API Settings' })).toBeInTheDocument();
      expect(screen.getByText('Admin Console')).toBeInTheDocument();
      expect(screen.getByText(/^Admin persona$/i)).toBeInTheDocument();
    });
  });

  it('shows restricted normal-user settings view for non-admin roles', async () => {
    authState.user = {
      id: 'user-2',
      email: 'user@example.com',
      name: 'Normal User',
      role: 'EDITOR',
      orgSlug: 'default',
    };
    const user = userEvent.setup();
    render(<MappingStudioApp initialView="new" />);

    await user.click(screen.getAllByRole('button', { name: 'Open LLM Settings' })[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'LLM / API Settings' })).toBeInTheDocument();
      expect(screen.getByText('Normal User Workspace')).toBeInTheDocument();
      expect(screen.getByText(/global plan and provider controls stay restricted to admin roles/i)).toBeInTheDocument();
    });
  });

  it('persists the selected UI theme', async () => {
    const user = userEvent.setup();
    render(<MappingStudioApp initialView="new" />);

    await user.click(screen.getByRole('button', { name: 'Switch Light Theme' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });
    expect(window.localStorage.getItem('automapper-ui-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Switch Dark Theme' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    expect(window.localStorage.getItem('automapper-ui-theme')).toBe('dark');
  });
});
