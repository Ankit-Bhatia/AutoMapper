import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiBase } from '@core/api-client';
import type { AuthError, AuthStatus, AuthUser } from './types';

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  setup: (input: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

interface AuthResponse {
  user: AuthUser;
}

interface SetupStatusResponse {
  requiresSetup: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildAuthError(status: number, body: unknown): AuthError {
  const payload = (body ?? {}) as { error?: { code?: string; message?: string } };
  return {
    status,
    code: payload.error?.code || 'AUTH_ERROR',
    message: payload.error?.message || `Authentication request failed (${status})`,
  };
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw buildAuthError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = async (): Promise<void> => {
    if (STANDALONE) {
      setUser({
        id: 'standalone-user',
        email: 'demo@automapper.local',
        name: 'Standalone Demo',
        role: 'ADMIN',
        orgSlug: 'default',
      });
      setStatus('authenticated');
      return;
    }

    setStatus('loading');

    try {
      const setupStatus = await authRequest<SetupStatusResponse>('/api/auth/setup-status');
      if (setupStatus.requiresSetup) {
        setUser(null);
        setStatus('setup-required');
        return;
      }

      const me = await authRequest<AuthResponse>('/api/auth/me');
      setUser(me.user);
      setStatus('authenticated');
    } catch (error) {
      const authError = error as AuthError;
      if (authError.code === 'SETUP_REQUIRED' || authError.status === 409) {
        setUser(null);
        setStatus('setup-required');
        return;
      }
      if (authError.status === 401) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      setUser(null);
      setStatus('unauthenticated');
    }
  };

  const login = async (input: { email: string; password: string }): Promise<void> => {
    const response = await authRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setUser(response.user);
    setStatus('authenticated');
  };

  const setup = async (input: { name: string; email: string; password: string }): Promise<void> => {
    const response = await authRequest<AuthResponse>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setUser(response.user);
    setStatus('authenticated');
  };

  const logout = async (): Promise<void> => {
    try {
      await authRequest<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Regardless of transport error, clear local auth state.
    }
    setUser(null);
    setStatus('unauthenticated');
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      refresh,
      login,
      setup,
      logout,
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
