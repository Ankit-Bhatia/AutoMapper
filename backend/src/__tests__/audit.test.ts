import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prismaClient.js';
import { writeAuditEntry } from '../db/audit.js';

describe('audit entries', () => {
  const testDatabaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/automapper';

  const ids = {
    orgId: randomUUID(),
    userId: randomUUID(),
    sourceSystemId: randomUUID(),
    targetSystemId: randomUUID(),
    projectId: randomUUID(),
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;

    await prisma.organisation.create({
      data: {
        id: ids.orgId,
        slug: `audit-org-${ids.orgId.slice(0, 8)}`,
        name: 'Audit Test Org',
      },
    });
    await prisma.user.create({
      data: {
        id: ids.userId,
        organisationId: ids.orgId,
        email: 'audit-test@example.com',
        name: 'Audit Tester',
        passwordHash: 'hash',
        role: 'OWNER',
      },
    });
    await prisma.system.createMany({
      data: [
        { id: ids.sourceSystemId, name: 'Source', type: 'jackhenry' },
        { id: ids.targetSystemId, name: 'Target', type: 'salesforce' },
      ],
    });
    await prisma.mappingProject.create({
      data: {
        id: ids.projectId,
        name: 'Audit Test Project',
        userId: ids.userId,
        organisationId: ids.orgId,
        sourceSystemId: ids.sourceSystemId,
        targetSystemId: ids.targetSystemId,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEntry.deleteMany({ where: { projectId: ids.projectId } });
    await prisma.mappingProject.deleteMany({ where: { id: ids.projectId } });
    await prisma.system.deleteMany({ where: { id: { in: [ids.sourceSystemId, ids.targetSystemId] } } });
    await prisma.user.deleteMany({ where: { id: ids.userId } });
    await prisma.organisation.deleteMany({ where: { id: ids.orgId } });
    await prisma.$disconnect();
    delete process.env.DATABASE_URL;
  });

  it('writes append-only audit entries with actor snapshot', async () => {
    await writeAuditEntry({
      projectId: ids.projectId,
      actor: {
        userId: ids.userId,
        email: 'audit-test@example.com',
        role: 'OWNER',
      },
      action: 'mapping_accepted',
      targetType: 'field_mapping',
      targetId: randomUUID(),
      before: { status: 'suggested' },
      after: { status: 'accepted' },
    });

    await writeAuditEntry({
      projectId: ids.projectId,
      actor: {
        userId: ids.userId,
        email: 'audit-test@example.com',
        role: 'OWNER',
      },
      action: 'project_exported',
      targetType: 'project',
      targetId: ids.projectId,
      after: { format: 'json' },
    });

    const entries = await prisma.auditEntry.findMany({
      where: { projectId: ids.projectId },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0]?.action).toBe('project_exported');
    expect(entries[1]?.action).toBe('mapping_accepted');
    expect(entries[1]?.actorEmail).toBe('audit-test@example.com');
  });
});
