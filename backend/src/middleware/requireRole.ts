import type { RequestHandler } from 'express';
import { prisma } from '../db/prismaClient.js';
import type { UserRole } from '../types.js';
import { ROLE_RANK } from '../types.js';
import { FsStore } from '../utils/fsStore.js';

function isAuthDisabled(): boolean {
  return process.env.REQUIRE_AUTH === 'false';
}

function normalizeRole(role: string | null | undefined): UserRole | null {
  const normalized = (role ?? '').trim().toLowerCase();
  if (normalized === 'viewer' || normalized === 'mapper' || normalized === 'approver' || normalized === 'admin') {
    return normalized;
  }
  if (normalized === 'owner') return 'admin';
  if (normalized === 'editor') return 'mapper';
  return null;
}

async function resolveProjectRole(projectId: string, userId: string): Promise<UserRole | null> {
  if (process.env.DATABASE_URL?.trim()) {
    const [member, project] = await Promise.all([
      prisma.projectMember.findUnique({
        where: {
          projectId_userId: { projectId, userId },
        },
        select: { role: true },
      }),
      prisma.mappingProject.findUnique({
        where: { id: projectId },
        select: { userId: true },
      }),
    ]);
    const memberRole = normalizeRole(member?.role);
    if (memberRole) return memberRole;
    if (project?.userId === userId) return 'admin';
    return null;
  }

  const store = new FsStore(process.env.DATA_DIR || './data');
  const member = store.listProjectMembers(projectId).find((candidate) => candidate.userId === userId);
  return member?.role ?? null;
}

export function requireRole(minRole: UserRole): RequestHandler {
  return async (req, res, next) => {
    if (isAuthDisabled()) {
      next();
      return;
    }

    const projectId = req.params.id ?? req.params.projectId;
    if (!projectId) {
      next();
      return;
    }

    const userId = (req.user as { sub?: string; userId?: string } | undefined)?.sub ?? req.user?.userId;
    if (!userId) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }

    const role = await resolveProjectRole(projectId, userId);
    if (!role) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }

    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }

    next();
  };
}
