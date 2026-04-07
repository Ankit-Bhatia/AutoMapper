import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamPanel } from './TeamPanel';

const apiMock = vi.fn();

vi.mock('@core/api-client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  isDemoUiMode: () => false,
}));

describe('TeamPanel', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('lists members, adds a member, and surfaces inline duplicate errors', async () => {
    const user = userEvent.setup();
    let members = [
      {
        userId: 'user-1',
        email: 'admin@example.com',
        role: 'admin',
        addedAt: new Date('2026-03-29T00:00:00.000Z').toISOString(),
      },
    ];

    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/projects/project-1/members' && method === 'GET') {
        return { members };
      }
      if (path === '/api/projects/project-1/members' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { email: string; role: string };
        if (body.email === 'duplicate@example.com') {
          throw new Error('A member with that email already exists');
        }
        const next = {
          userId: body.email,
          email: body.email,
          role: body.role,
          addedAt: new Date().toISOString(),
        };
        members = [...members, next];
        return next;
      }
      throw new Error(`Unhandled request ${method} ${path}`);
    });

    render(
      <TeamPanel
        open
        projectId="project-1"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/teammate@example.com/i), 'mapper@example.com');
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'mapper');
    await user.click(screen.getByRole('button', { name: /add member/i }));

    await waitFor(() => {
      expect(screen.getByText('mapper@example.com')).toBeInTheDocument();
    });

    await user.clear(screen.getByPlaceholderText(/teammate@example.com/i));
    await user.type(screen.getByPlaceholderText(/teammate@example.com/i), 'duplicate@example.com');
    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(await screen.findByText('A member with that email already exists')).toBeInTheDocument();
  });
});
