import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorGrid } from './ConnectorGrid';

describe('ConnectorGrid', () => {
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
});
