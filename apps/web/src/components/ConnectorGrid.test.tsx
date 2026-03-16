import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorGrid } from './ConnectorGrid';

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock('@core/api-client', () => ({
  api: (path: string, init?: RequestInit) => apiMock(path, init),
}));

describe('ConnectorGrid', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/connectors') return { connectors: [] };
      return {};
    });
  });

  it('loads previously saved custom connectors on mount', async () => {
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/connectors') {
        return {
          connectors: [
            {
              id: 'custom-legacy1',
              name: 'Legacy LOS',
              vendor: 'Custom',
              category: 'core-banking',
              description: 'Persisted custom connector',
              entities: ['Loan', 'Borrower'],
            },
          ],
        };
      }
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);

    expect(await screen.findByLabelText(/select custom connector legacy los/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete legacy los/i })).toBeInTheDocument();
  });

  it('deletes a persisted custom connector and removes it from the UI', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/connectors') {
        return {
          connectors: [
            {
              id: 'custom-legacy1',
              name: 'Legacy LOS',
              vendor: 'Custom',
              category: 'core-banking',
              description: 'Persisted custom connector',
              entities: ['Loan', 'Borrower'],
            },
          ],
        };
      }
      if (path === '/api/connectors/custom/custom-legacy1' && init?.method === 'DELETE') {
        return { ok: true, deletedIds: ['custom-legacy1'], deletedCount: 1 };
      }
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    expect(await screen.findByLabelText(/select custom connector legacy los/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete legacy los/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText(/select custom connector legacy los/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete legacy los/i })).not.toBeInTheDocument();
    });
  });

  it('bulk deletes selected custom connectors', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/connectors') {
        return {
          connectors: [
            {
              id: 'custom-legacy1',
              name: 'Legacy LOS',
              vendor: 'Custom',
              category: 'core-banking',
              description: 'Persisted custom connector',
              entities: ['Loan'],
            },
            {
              id: 'custom-legacy2',
              name: 'Legacy Core',
              vendor: 'Custom',
              category: 'core-banking',
              description: 'Persisted custom connector',
              entities: ['Customer'],
            },
          ],
        };
      }
      if (path === '/api/connectors/custom/bulk-delete' && init?.method === 'POST') {
        return {
          ok: true,
          deletedIds: ['custom-legacy1', 'custom-legacy2'],
          deletedCount: 2,
        };
      }
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    expect(await screen.findByLabelText(/select custom connector legacy los/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/select custom connector legacy core/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/select custom connector legacy los/i));
    await user.click(screen.getByLabelText(/select custom connector legacy core/i));
    await user.click(screen.getByRole('button', { name: /delete selected \(2\)/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText(/select custom connector legacy los/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/select custom connector legacy core/i)).not.toBeInTheDocument();
    });
  });

  it('enables discover when source and target are selected', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    expect(screen.queryByRole('button', { name: /discover schemas/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /silverlake/i }));
    await user.click(screen.getByRole('button', { name: /salesforce crm/i }));

    const discoverButton = screen.getByRole('button', { name: /discover schemas/i });
    expect(discoverButton).toBeEnabled();
  });

  it('calls onProceed with selected connectors and project name', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);

    await user.click(screen.getByRole('button', { name: /silverlake/i }));
    await user.click(screen.getByRole('button', { name: /salesforce crm/i }));
    await user.type(screen.getByLabelText(/project name/i), 'Schema Upload Demo');
    await user.click(screen.getByRole('button', { name: /discover schemas/i }));

    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledWith(
      'jackhenry-silverlake',
      'salesforce',
      expect.objectContaining({
        projectName: 'Schema Upload Demo',
      }),
    );
  });

  it('passes optional source/target schema files in onProceed payload', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);

    await user.click(screen.getByRole('button', { name: /sap s\/4hana/i }));
    await user.click(screen.getByRole('button', { name: /salesforce crm/i }));

    const sourceFile = new File(['AccountId,Name\n1,Acme'], 'source.csv', { type: 'text/csv' });
    const targetFile = new File(['[{"Id":"1","Name":"Acme"}]'], 'target.json', {
      type: 'application/json',
    });

    const sourceInput = screen.getByLabelText(/source schema file/i) as HTMLInputElement;
    const targetInput = screen.getByLabelText(/target schema file/i) as HTMLInputElement;

    await user.upload(sourceInput, sourceFile);
    await user.upload(targetInput, targetFile);
    await user.click(screen.getByRole('button', { name: /discover schemas/i }));

    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledWith(
      'sap',
      'salesforce',
      expect.objectContaining({
        sourceFile,
        targetFile,
      }),
    );
  });

  it('supports drag-and-drop assignment for source and target', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    render(<ConnectorGrid onProceed={onProceed} loading={false} />);

    const makeDataTransfer = () => {
      const bag: Record<string, string> = {};
      return {
        setData: (type: string, val: string) => { bag[type] = val; },
        getData: (type: string) => bag[type] ?? '',
        effectAllowed: 'move',
        dropEffect: 'move',
      };
    };

    const srcCard = screen.getByRole('button', { name: /silverlake/i });
    const tgtCard = screen.getByRole('button', { name: /salesforce crm/i });
    const sourceZone = screen.getByLabelText(/source drop zone/i);
    const targetZone = screen.getByLabelText(/target drop zone/i);

    const dt1 = makeDataTransfer();
    fireEvent.dragStart(srcCard, { dataTransfer: dt1 });
    fireEvent.dragOver(sourceZone, { dataTransfer: dt1 });
    fireEvent.drop(sourceZone, { dataTransfer: dt1 });

    const dt2 = makeDataTransfer();
    fireEvent.dragStart(tgtCard, { dataTransfer: dt2 });
    fireEvent.dragOver(targetZone, { dataTransfer: dt2 });
    fireEvent.drop(targetZone, { dataTransfer: dt2 });

    await user.click(screen.getByRole('button', { name: /discover schemas/i }));
    expect(onProceed).toHaveBeenCalledWith(
      'jackhenry-silverlake',
      'salesforce',
      expect.any(Object),
    );
  });

  it('resets SAP OAuth connected badge when SAP credentials change', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/connectors') return { connectors: [] };
      if (path === '/api/oauth/sap/connect') return { connected: true, expiresIn: 3600 };
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);

    await user.click(screen.getByRole('button', { name: /sap s\/4hana/i }));
    await user.click(screen.getByRole('button', { name: /salesforce crm/i }));

    await user.type(screen.getByLabelText(/sap client id/i), 'sap-client');
    await user.type(screen.getByLabelText(/sap client secret/i), 'sap-secret');
    await user.type(screen.getByLabelText(/sap token url/i), 'https://sap.example.com/oauth/token');

    await user.click(screen.getByRole('button', { name: /connect to sap/i }));

    expect(await screen.findByText(/sap oauth connected/i)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      '/api/oauth/sap/connect',
      expect.objectContaining({ method: 'POST' }),
    );

    await user.clear(screen.getByLabelText(/sap client id/i));
    await user.type(screen.getByLabelText(/sap client id/i), 'sap-client-updated');

    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });

  it('shows a readable error when uploaded schema file exceeds 5MB', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    await user.click(screen.getByRole('button', { name: /add custom connector/i }));
    await user.click(screen.getByRole('button', { name: /upload schema file/i }));

    const oversizedFile = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.json', {
      type: 'application/json',
    });

    await user.upload(screen.getByLabelText(/schema file/i), oversizedFile);

    expect(await screen.findByRole('alert')).toHaveTextContent(/file too large/i);
    expect(apiMock).not.toHaveBeenCalledWith('/api/connectors/custom', expect.anything());
  });

  it('strips auth credentials from connectionConfig before saving custom connector', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/connectors') return { connectors: [] };
      if (path === '/api/connectors/custom') {
        return {
          id: 'custom-abc123',
          connector: {
            id: 'custom-abc123',
            name: 'Core API',
            vendor: 'Acme',
            category: 'core-banking',
            description: 'Custom connector',
            entities: ['Customer'],
          },
        };
      }
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    await user.click(screen.getByRole('button', { name: /add custom connector/i }));
    await user.type(screen.getByLabelText(/connector name/i), 'Core API');
    await user.type(screen.getByLabelText(/entity names/i), 'Customer');
    await user.type(screen.getByLabelText(/base url/i), 'https://api.example.com');
    await user.selectOptions(screen.getByLabelText(/auth mode/i), 'bearer');
    await user.type(screen.getByLabelText(/bearer token/i), 'top-secret');

    await user.click(screen.getByRole('button', { name: /save connector/i }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/connectors/custom',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const request = apiMock.mock.calls.find(([path]) => path === '/api/connectors/custom')?.[1] as RequestInit | undefined;
    if (!request) {
      throw new Error('Expected /api/connectors/custom call payload');
    }
    const payload = JSON.parse(String(request.body)) as { connectionConfig: Record<string, unknown> };

    expect(payload.connectionConfig).toEqual({
      baseUrl: 'https://api.example.com',
      auth: 'bearer',
    });
    expect(payload.connectionConfig).not.toHaveProperty('bearerToken');
    expect(payload.connectionConfig).not.toHaveProperty('basicUsername');
    expect(payload.connectionConfig).not.toHaveProperty('basicPassword');
  });

  it('shows timeout message when custom connector save request is aborted', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/connectors') return { connectors: [] };
      if (path === '/api/connectors/custom') {
        throw new DOMException('Aborted', 'AbortError');
      }
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    await user.click(screen.getByRole('button', { name: /add custom connector/i }));
    await user.type(screen.getByLabelText(/connector name/i), 'Timeout Connector');
    await user.type(screen.getByLabelText(/entity names/i), 'Customer');
    await user.type(screen.getByLabelText(/base url/i), 'https://api.example.com');
    await user.click(screen.getByRole('button', { name: /save connector/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/connection timed out after 15s/i);
  });

  it('parses uploaded XML schema into multiple entities before saving custom connector', async () => {
    const user = userEvent.setup();
    const onProceed = vi.fn();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/connectors') return { connectors: [] };
      if (path === '/api/connectors/custom') {
        return {
          id: 'custom-los',
          connector: {
            id: 'custom-los',
            name: 'LOS XML',
            vendor: 'Custom',
            category: 'core-banking',
            description: 'LOS XML connector',
            entities: ['LOAN', 'BORROWER', 'DEBTS'],
          },
        };
      }
      return {};
    });

    render(<ConnectorGrid onProceed={onProceed} loading={false} />);
    await user.click(screen.getByRole('button', { name: /add custom connector/i }));
    await user.type(screen.getByLabelText(/connector name/i), 'LOS XML');
    await user.click(screen.getByRole('button', { name: /upload schema file/i }));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<LOAN>
  <AMT_LOAN>250000</AMT_LOAN>
  <BORROWER>
    <NAME_FIRST>Ankit</NAME_FIRST>
    <NAME_LAST>Bhatia</NAME_LAST>
    <SSN>111-22-3333</SSN>
  </BORROWER>
  <DEBTS>
    <ACCOUNT_NUMBER>12345</ACCOUNT_NUMBER>
    <AMT_CURRENT_BALANCE>5000</AMT_CURRENT_BALANCE>
  </DEBTS>
</LOAN>`;

    const xmlFile = new File([xml], 'LOS Riskclam.xml', { type: 'application/xml' });
    await user.upload(screen.getByLabelText(/schema file/i), xmlFile);

    expect(await screen.findByText('LOAN')).toBeInTheDocument();
    expect(screen.getByText('BORROWER')).toBeInTheDocument();
    expect(screen.getByText('DEBTS')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save connector/i }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/api/connectors/custom',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const request = apiMock.mock.calls.find(([path]) => path === '/api/connectors/custom')?.[1] as RequestInit | undefined;
    if (!request) {
      throw new Error('Expected /api/connectors/custom call payload');
    }
    const payload = JSON.parse(String(request.body)) as {
      entities: Array<{ name: string; fields: Array<{ name: string; dataType: string }> }>;
    };
    const entityNames = payload.entities.map((entity) => entity.name);

    expect(entityNames).toEqual(expect.arrayContaining(['LOAN', 'BORROWER', 'DEBTS']));
    const borrower = payload.entities.find((entity) => entity.name === 'BORROWER');
    expect(borrower?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['NAME_FIRST', 'NAME_LAST', 'SSN']),
    );
  });
});
