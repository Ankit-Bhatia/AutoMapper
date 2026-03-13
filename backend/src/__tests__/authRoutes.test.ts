import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  setCookie: string[];
}

function extractSetCookie(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[]; raw?: () => Record<string, string[]> };
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  if (typeof anyHeaders.raw === 'function') {
    return anyHeaders.raw()['set-cookie'] ?? [];
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function getSessionCookie(setCookies: string[]): string | null {
  const session = setCookies.find((cookie) => cookie.startsWith('session='));
  if (!session) return null;
  return session.split(';')[0] ?? null;
}

describe('authRoutes cookie session flow', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    process.env.REQUIRE_AUTH = 'true';
    process.env.JWT_SECRET = 'test-secret';
    process.env.DATABASE_URL = '';

    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { setupAuthRoutes, __resetAuthStateForTests } = await import('../routes/authRoutes.js');
    __resetAuthStateForTests();

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupAuthRoutes(app);

    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    delete process.env.REQUIRE_AUTH;
    delete process.env.JWT_SECRET;
    process.env.DATABASE_URL = '';

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  async function request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    cookie?: string,
  ): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const parsedBody = await response.json().catch(() => ({}));

    return {
      status: response.status,
      body: parsedBody as T,
      setCookie: extractSetCookie(response.headers),
    };
  }

  it('supports first-time setup and cookie-backed /me session restore', async () => {
    const statusBefore = await request<{ requiresSetup: boolean }>('GET', '/api/auth/setup-status');
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.requiresSetup).toBe(true);

    const setup = await request<{ user: { email: string; role: string } }>('POST', '/api/auth/setup', {
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'StrongPass123!',
    });

    expect(setup.status).toBe(201);
    expect(setup.body.user.email).toBe('admin@example.com');
    expect(setup.body.user.role).toBe('OWNER');

    const rawSessionSetCookie = setup.setCookie.find((cookie) => cookie.startsWith('session='));
    expect(rawSessionSetCookie).toBeTruthy();
    expect(rawSessionSetCookie).toContain('HttpOnly');
    expect(rawSessionSetCookie).toContain('SameSite=Strict');
    expect(rawSessionSetCookie).toContain('Path=/');

    const sessionCookie = getSessionCookie(setup.setCookie);
    expect(sessionCookie).toBeTruthy();
    const token = sessionCookie?.split('=')[1] ?? '';
    const decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as { email?: string };
    expect(decoded.email).toBe('admin@example.com');

    const me = await request<{ user: { email: string } }>('GET', '/api/auth/me', undefined, sessionCookie ?? undefined);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@example.com');

    const statusAfter = await request<{ requiresSetup: boolean }>('GET', '/api/auth/setup-status');
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.requiresSetup).toBe(false);
  });

  it('blocks setup after initialization', async () => {
    const first = await request('POST', '/api/auth/setup', {
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'StrongPass123!',
    });
    expect(first.status).toBe(201);

    const second = await request<{ error?: { code?: string } }>('POST', '/api/auth/setup', {
      name: 'Second User',
      email: 'second@example.com',
      password: 'StrongPass123!',
    });

    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('ALREADY_INITIALIZED');
  });

  it('rate-limits repeated failed login attempts', async () => {
    const setup = await request('POST', '/api/auth/setup', {
      name: 'Admin User',
      email: 'admin@example.com',
      password: 'StrongPass123!',
    });
    expect(setup.status).toBe(201);

    for (let i = 0; i < 5; i += 1) {
      const attempt = await request<{ error?: { code?: string } }>('POST', '/api/auth/login', {
        email: 'admin@example.com',
        password: 'wrong-pass',
      });
      expect(attempt.status).toBe(401);
      expect(attempt.body.error?.code).toBe('INVALID_CREDENTIALS');
    }

    const limited = await request<{ error?: { code?: string } }>('POST', '/api/auth/login', {
      email: 'admin@example.com',
      password: 'wrong-pass',
    });

    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe('RATE_LIMITED');
  });
});
