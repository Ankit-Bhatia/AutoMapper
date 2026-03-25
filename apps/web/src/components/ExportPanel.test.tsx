import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from './ExportPanel';
import type { Entity, Field, FieldMapping } from '@contracts';

const { mockApi, mockIsDemoUiMode } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockIsDemoUiMode: vi.fn(() => false),
}));

vi.mock('@core/api-client', () => ({
  api: mockApi,
  API_BASE: 'http://localhost:4000',
  isDemoUiMode: mockIsDemoUiMode,
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
        summary: { totalWarnings: 0, typeMismatch: 0, missingRequired: 0, picklistCoverage: 0, validationRule: 0 },
      }}
      fields={fields}
      fieldMappings={fieldMappings}
      targetEntities={[targetEntity]}
    />,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockIsDemoUiMode.mockReset();
  mockIsDemoUiMode.mockReturnValue(false);
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock-download'),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

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

  it('downloads through the live API with credentials included', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['live export'])),
    } as unknown as Response);

    renderPanel([makeField({ id: 'target-name', name: 'Name' })], [makeMapping({ targetFieldId: 'target-name' })]);

    await user.click(screen.getAllByRole('button', { name: /download \.json/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/projects/project-1/export?format=json',
        { credentials: 'include' },
      );
    });
    expect(mockApi).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('downloads through the standalone mock API without making a backend request', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    mockIsDemoUiMode.mockReturnValue(true);
    mockApi.mockResolvedValue('mock export payload');

    renderPanel([makeField({ id: 'target-name', name: 'Name' })], [makeMapping({ targetFieldId: 'target-name' })]);

    await user.click(screen.getAllByRole('button', { name: /download \.json/i })[0]);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/api/projects/project-1/export?format=json');
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error on failure and clears it on the next successful download', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('Network down'));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['recovered export'])),
    } as unknown as Response);

    renderPanel([makeField({ id: 'target-name', name: 'Name' })], [makeMapping({ targetFieldId: 'target-name' })]);

    const downloadButton = screen.getAllByRole('button', { name: /download \.json/i })[0];
    await user.click(downloadButton);

    expect(await screen.findByText('Network down')).toBeInTheDocument();

    await user.click(downloadButton);

    await waitFor(() => {
      expect(screen.queryByText('Network down')).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
