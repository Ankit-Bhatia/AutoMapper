import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AuthProvider } from './AuthContext';

vi.mock('../MappingStudioApp', () => ({
  MappingStudioApp: () => <div>Studio Home</div>,
}));

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function renderWithRouter(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('auth routing flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to setup when backend reports setup required', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/setup-status')) {
        return mockJsonResponse(200, { requiresSetup: true });
      }
      return mockJsonResponse(404, {});
    }));

    renderWithRouter('/');

    expect(await screen.findByText(/initial admin setup/i)).toBeInTheDocument();
  });

  it('shows login when setup is complete but user is not authenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/setup-status')) {
        return mockJsonResponse(200, { requiresSetup: false });
      }
      if (url.endsWith('/api/auth/me')) {
        return mockJsonResponse(401, {
          error: { code: 'UNAUTHORIZED', message: 'Missing session cookie' },
        });
      }
      return mockJsonResponse(404, {});
    }));

    renderWithRouter('/');

    expect(await screen.findByRole('heading', { name: /sign in to automapper/i })).toBeInTheDocument();
  });

  it('logs in and navigates to the protected studio route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET' && url.endsWith('/api/auth/setup-status')) {
        return mockJsonResponse(200, { requiresSetup: false });
      }
      if (method === 'GET' && url.endsWith('/api/auth/me')) {
        return mockJsonResponse(401, {
          error: { code: 'UNAUTHORIZED', message: 'Missing session cookie' },
        });
      }
      if (method === 'POST' && url.endsWith('/api/auth/login')) {
        return mockJsonResponse(200, {
          user: {
            id: 'u-1',
            email: 'admin@example.com',
            name: 'Admin',
            role: 'OWNER',
          },
        });
      }
      return mockJsonResponse(404, {});
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithRouter('/');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'StrongPass123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Studio Home')).toBeInTheDocument();
    });
  });
});
