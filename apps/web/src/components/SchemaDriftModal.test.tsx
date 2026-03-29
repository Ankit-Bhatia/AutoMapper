import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SchemaDriftModal } from './SchemaDriftModal';

const drift = {
  sourceChanged: true,
  targetChanged: true,
  blockers: [
    {
      scope: 'target' as const,
      fieldId: 'field-1',
      fieldName: 'Monthly_Payment__c',
      entityName: 'FinancialAccount',
      changeType: 'type_changed' as const,
      previousType: 'decimal',
      currentType: 'string',
      required: true,
    },
  ],
  warnings: [],
  additions: [],
};

describe('SchemaDriftModal', () => {
  it('renders blockers and forwards cancel/proceed actions', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onProceed = vi.fn();

    render(<SchemaDriftModal drift={drift} onCancel={onCancel} onProceed={onProceed} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Monthly_Payment__c')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Proceed anyway' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledTimes(1);
  });
});
