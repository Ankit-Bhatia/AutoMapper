import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportPanel } from './ExportPanel';
import type { Entity, Field, FieldMapping } from '@contracts';

vi.mock('@core/api-client', () => ({
  apiBase: () => 'http://localhost:4000',
}));

const targetEntity: Entity = {
  id: 'target-account',
  systemId: 'target-system',
  name: 'Account',
};

const sourceEntity: Entity = {
  id: 'source-cif',
  systemId: 'source-system',
  name: 'CIF',
};

function makeField(overrides: Partial<Field>): Field {
  return {
    id: `field-${Math.random().toString(36).slice(2, 8)}`,
    entityId: targetEntity.id,
    name: 'FieldName',
    dataType: 'string',
    ...overrides,
  };
}

function makeMapping(overrides: Partial<FieldMapping>): FieldMapping {
  return {
    id: `mapping-${Math.random().toString(36).slice(2, 8)}`,
    entityMappingId: 'entity-map-1',
    sourceFieldId: 'source-field',
    targetFieldId: 'target-field',
    transform: { type: 'direct', config: {} },
    confidence: 0.9,
    rationale: 'test',
    status: 'accepted',
    ...overrides,
  };
}

function renderPanel(fields: Field[], fieldMappings: FieldMapping[]) {
  return render(
    <ExportPanel
      projectId="project-1"
      fieldMappingCount={fieldMappings.length}
      entityMappingCount={1}
      acceptedCount={fieldMappings.filter((mapping) => mapping.status === 'accepted').length}
      validation={{
        warnings: [],
        summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0 },
      }}
      fields={fields}
      fieldMappings={fieldMappings}
      targetEntities={[targetEntity]}
    />,
  );
}

describe('ExportPanel pre-flight checks', () => {
  it('blocks export when required target fields are unmapped and allows override', async () => {
    const user = userEvent.setup();
    const requiredTarget = makeField({
      id: 'target-tax-id',
      name: 'TaxID',
      required: true,
      complianceTags: ['GLBA_NPI'],
    });
    const optionalTarget = makeField({
      id: 'target-email',
      name: 'Email',
      required: false,
    });
    const sourceOnly = makeField({
      id: 'source-customer-id',
      entityId: sourceEntity.id,
      name: 'CustomerId',
      required: true,
    });

    renderPanel([requiredTarget, optionalTarget, sourceOnly], []);

    expect(screen.getByText(/Required target fields missing mappings \(1\)/i)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: /blocked by pre-flight/i })) {
      expect(button).toBeDisabled();
    }

    await user.click(screen.getByLabelText(/I understand these required fields are unmapped/i));

    expect(screen.getAllByRole('button', { name: /download \.json/i })[0]).toBeEnabled();
  });

  it('shows coverage, compliance summary, and low-confidence required warnings', () => {
    const targetTaxId = makeField({
      id: 'target-tax-id',
      name: 'TaxID',
      required: true,
      complianceTags: ['GLBA_NPI', 'BSA_AML'],
    });
    const targetRiskCode = makeField({
      id: 'target-risk-code',
      name: 'RiskCode',
      required: true,
      complianceTags: ['FFIEC_AUDIT'],
    });
    const targetNickname = makeField({
      id: 'target-nickname',
      name: 'Nickname',
      required: false,
    });

    const acceptedTaxId = makeMapping({
      id: 'map-tax-id',
      targetFieldId: targetTaxId.id,
      status: 'accepted',
      confidence: 0.92,
    });
    const suggestedRiskCode = makeMapping({
      id: 'map-risk-code',
      targetFieldId: targetRiskCode.id,
      status: 'suggested',
      confidence: 0.45,
    });
    const rejectedNickname = makeMapping({
      id: 'map-nickname',
      targetFieldId: targetNickname.id,
      status: 'rejected',
      confidence: 0.4,
    });

    renderPanel(
      [targetTaxId, targetRiskCode, targetNickname],
      [acceptedTaxId, suggestedRiskCode, rejectedNickname],
    );

    expect(screen.getByText(/2 of 3 target fields mapped/i)).toBeInTheDocument();
    expect(screen.getByText(/1 accepted, 1 suggested, 1 rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/Low-confidence required mappings \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/RiskCode is 45% confidence \(suggested\)/i)).toBeInTheDocument();

    const glbaChip = screen.getByText('GLBA_NPI').closest('.export-preflight-tag');
    const bsaChip = screen.getByText('BSA_AML').closest('.export-preflight-tag');
    expect(glbaChip).toHaveTextContent('1');
    expect(bsaChip).toHaveTextContent('1');

    expect(screen.getAllByRole('button', { name: /download \.json/i })[0]).toBeEnabled();
  });
});
