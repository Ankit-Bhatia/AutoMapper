import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Entity, EntityMapping, Field, FieldMapping, ValidationReport } from '@contracts';
import { MappingTable } from './MappingTable';

const apiMock = vi.fn();

vi.mock('@core/api-client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'demo@automapper.local',
      name: 'Demo User',
      role: 'ADMIN',
      orgSlug: 'default',
    },
  }),
}));

const sourceEntity: Entity = {
  id: 'source-entity-1',
  systemId: 'source-system-1',
  name: 'CIF',
};

const targetEntity: Entity = {
  id: 'target-entity-1',
  systemId: 'target-system-1',
  name: 'PartyProfile',
};

const entityMappings: EntityMapping[] = [
  {
    id: 'em-1',
    projectId: 'project-1',
    sourceEntityId: sourceEntity.id,
    targetEntityId: targetEntity.id,
    confidence: 0.91,
    rationale: 'entity match',
  },
];

const fields: Field[] = [
  {
    id: 'source-field-1',
    entityId: sourceEntity.id,
    name: 'NAME1',
    dataType: 'string',
  },
  {
    id: 'target-field-1',
    entityId: targetEntity.id,
    name: 'Name',
    dataType: 'string',
    required: true,
  },
];

const validation: ValidationReport = {
  warnings: [],
  summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
};

const initialMapping: FieldMapping = {
  id: 'fm-1',
  entityMappingId: 'em-1',
  sourceFieldId: 'source-field-1',
  targetFieldId: 'target-field-1',
  transform: { type: 'direct', config: {} },
  confidence: 0.82,
  rationale: 'name similarity',
  status: 'suggested',
};

function Harness() {
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([initialMapping]);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  return (
    <MappingTable
      projectId="project-1"
      sourceEntities={[sourceEntity]}
      targetEntities={[targetEntity]}
      fields={fields}
      entityMappings={entityMappings}
      fieldMappings={fieldMappings}
      validation={validation}
      onMappingUpdate={(updated) => {
        setFieldMappings((prev) => prev.map((fm) => (fm.id === updated.id ? updated : fm)));
      }}
      acknowledgedFormulaMappingIds={acknowledged}
      onAcknowledgeFormulaWarning={(mappingId) => {
        setAcknowledged((prev) => {
          const next = new Set(prev);
          next.add(mappingId);
          return next;
        });
      }}
      onProceedToExport={() => {}}
    />
  );
}

describe('MappingTable', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (typeof path === 'string' && path.includes('/api/projects/project-1/audit?limit=1')) {
        return { entries: [] };
      }
      if (typeof path === 'string' && path.includes('/api/org/default/mapping-events')) {
        return { ok: true };
      }
      if (typeof path === 'string' && path.includes('/api/field-mappings/fm-1')) {
        return {
          fieldMapping: {
            ...initialMapping,
            status: 'accepted',
          },
        };
      }
      return {};
    });
  });

  it('keeps actions visible via sticky class and updates counters when accepting a mapping', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const actionsHeader = screen.getByRole('columnheader', { name: /actions/i });
    expect(actionsHeader).toHaveClass('mapping-col-actions');

    expect(screen.getByRole('button', { name: 'Accepted (0)' })).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('0 accepted')).toBeInTheDocument();

    await user.click(screen.getByTitle('Accept'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accepted (1)' })).toBeInTheDocument();
      expect(screen.getByText('1/1')).toBeInTheDocument();
      expect(screen.getByText('1 accepted')).toBeInTheDocument();
    });
  });

  it('surfaces SchemaIntelligence badges and allows formula warnings to be acknowledged', async () => {
    const user = userEvent.setup();
    const formulaMapping: FieldMapping = {
      ...initialMapping,
      id: 'fm-formula',
      targetFieldId: 'target-field-formula',
      rationale: [
        "✅ Confirmed BOSL→FSC pattern: 'AMT_APPROVED_LOAN' → 'FinServ__LoanAmount__c' on FinancialAccount [HIGH]. Exact match",
        "⚠️ Formula field target: 'FormulaAmount__c' appears to be a calculated field — inbound writes will fail. Map the source fields that feed this formula instead.",
        "⚠️ One-to-Many field: 'AMT_APPROVED_LOAN' maps to multiple Salesforce targets in the BOSL corpus. Human routing decision required — validate this specific target is correct for your lifecycle stage.",
        "ℹ️ Person Account field: 'PersonMailingStreet__pc' (__pc suffix) only exists on Person Account records — not available for business/organisation accounts.",
      ].join(' | '),
    };

    function FormulaHarness() {
      const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([formulaMapping]);
      const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

      return (
        <MappingTable
          projectId="project-1"
          sourceEntities={[sourceEntity]}
          targetEntities={[targetEntity]}
          fields={[
            {
              ...fields[0],
              name: 'AMT_APPROVED_LOAN',
            },
            {
              ...fields[1],
              id: 'target-field-formula',
              name: 'PersonMailingStreet__pc',
            },
          ]}
          entityMappings={entityMappings}
          fieldMappings={fieldMappings}
          validation={validation}
          onMappingUpdate={(updated) => {
            setFieldMappings((prev) => prev.map((fm) => (fm.id === updated.id ? updated : fm)));
          }}
          acknowledgedFormulaMappingIds={acknowledged}
          onAcknowledgeFormulaWarning={(mappingId) => {
            setAcknowledged((prev) => {
              const next = new Set(prev);
              next.add(mappingId);
              return next;
            });
          }}
          onProceedToExport={() => {}}
        />
      );
    }

    render(<FormulaHarness />);

    expect(screen.getByText(/formula field acknowledgement required/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirmed Pattern \(HIGH\)/i)).toBeInTheDocument();
    expect(screen.getAllByTitle(/formulaamount__c/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Routing Required/i)).toBeInTheDocument();

    await user.click(screen.getByText('AMT_APPROVED_LOAN'));

    await waitFor(() => {
      expect(screen.getByText(/Formula target warning/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /acknowledge warning/i }));

    await waitFor(() => {
      expect(screen.getByText(/Acknowledged/i)).toBeInTheDocument();
      expect(screen.queryByText(/formula field acknowledgement required/i)).not.toBeInTheDocument();
    });
  });
});
