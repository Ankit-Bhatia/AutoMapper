import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SchemaDriftBanner } from './SchemaDriftBanner';

const drift = {
  sourceChanged: true,
  targetChanged: false,
  blockers: [],
  warnings: [
    {
      scope: 'source' as const,
      fieldId: 'field-1',
      fieldName: 'STATUS_CODE',
      entityName: 'Loan',
      changeType: 'removed' as const,
      previousType: 'string',
      required: false,
    },
  ],
  additions: [],
};

describe('SchemaDriftBanner', () => {
  it('expands warning details and dismisses', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(<SchemaDriftBanner drift={drift} onDismiss={onDismiss} />);

    expect(screen.getByText(/1 warning detected/i)).toBeInTheDocument();
    expect(screen.queryByText('STATUS_CODE')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('STATUS_CODE')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
