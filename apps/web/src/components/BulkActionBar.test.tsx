import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BulkActionBar } from './BulkActionBar';

const apiMock = vi.fn();

vi.mock('@core/api-client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

describe('BulkActionBar', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('submits accept_suggestion for selected mappings and reports completion', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    apiMock.mockResolvedValue({
      applied: 2,
      skipped: 0,
      errors: [],
    });

    render(
      <BulkActionBar
        projectId="project-1"
        selectedIds={['fm-1', 'fm-2']}
        onComplete={onComplete}
        onClear={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accept all' }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/api/projects/project-1/mappings/bulk', {
        method: 'POST',
        body: JSON.stringify({ operation: 'accept_suggestion', mappingIds: ['fm-1', 'fm-2'], payload: undefined }),
      });
      expect(onComplete).toHaveBeenCalledWith({ applied: 2, skipped: 0, errors: [] });
    });
  });
});
