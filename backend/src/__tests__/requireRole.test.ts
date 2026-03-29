import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectMemberFindUnique = vi.fn();
const mappingProjectFindUnique = vi.fn();

vi.mock('../db/prismaClient.js', () => ({
  prisma: {
    projectMember: {
      findUnique: projectMemberFindUnique,
    },
    mappingProject: {
      findUnique: mappingProjectFindUnique,
    },
  },
}));

describe('requireRole', () => {
  const env = {
    REQUIRE_AUTH: process.env.REQUIRE_AUTH,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  beforeEach(() => {
    vi.resetModules();
    projectMemberFindUnique.mockReset();
    mappingProjectFindUnique.mockReset();
    process.env.REQUIRE_AUTH = 'true';
    process.env.DATABASE_URL = 'postgres://test';
  });

  afterEach(() => {
    process.env.REQUIRE_AUTH = env.REQUIRE_AUTH;
    process.env.DATABASE_URL = env.DATABASE_URL;
  });

  function mockResponse() {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { status, json } as unknown as Response;
  }

  it('passes when the member role meets the minimum requirement', async () => {
    projectMemberFindUnique.mockResolvedValue({ role: 'approver' });
    mappingProjectFindUnique.mockResolvedValue({ userId: 'user-1' });
    const next = vi.fn() as unknown as NextFunction;
    const req = {
      params: { id: 'project-1' },
      user: { userId: 'user-1', email: 'user@example.com', role: 'OWNER' },
    } as Request;
    const res = mockResponse();

    const { requireRole } = await import('../middleware/requireRole.js');
    await requireRole('mapper')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('returns 403 when the member role is below the minimum requirement', async () => {
    projectMemberFindUnique.mockResolvedValue({ role: 'viewer' });
    mappingProjectFindUnique.mockResolvedValue({ userId: 'someone-else' });
    const next = vi.fn() as unknown as NextFunction;
    const req = {
      params: { id: 'project-1' },
      user: { userId: 'user-1', email: 'user@example.com', role: 'OWNER' },
    } as Request;
    const res = mockResponse();

    const { requireRole } = await import('../middleware/requireRole.js');
    await requireRole('approver')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
    const json = ((res.status as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { json: ReturnType<typeof vi.fn> }).json;
    expect(json).toHaveBeenCalledWith({ error: 'Insufficient role' });
  });
});
