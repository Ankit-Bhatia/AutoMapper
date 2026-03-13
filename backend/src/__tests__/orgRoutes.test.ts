import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prismaClient.js';
import { setupOrgRoutes } from '../routes/orgRoutes.js';

async function ensureCoreFixtures(ids: {
  orgId: string;
  userId: string;
  projectId: string;
  sourceSystemId: string;
  targetSystemId: string;
  sourceEntityId: string;
  targetEntityId: string;
  sourceFieldId: string;
  targetFieldId: string;
  entityMappingId: string;
  fieldMappingId: string;
}): Promise<void> {
  await prisma.organisation.upsert({
    where: { slug: 'org-routes-test' },
    update: {},
    create: {
      id: ids.orgId,
      slug: 'org-routes-test',
      name: 'Org Routes Test',
    },
  });

  await prisma.user.create({
    data: {
      id: ids.userId,
      email: 'org-routes-test@example.com',
      name: 'Org Tester',
      passwordHash: 'hash',
      role: 'OWNER',
      organisationId: ids.orgId,
    },
  });

  await prisma.system.createMany({
    data: [
      { id: ids.sourceSystemId, name: 'Source System', type: 'jackhenry' },
      { id: ids.targetSystemId, name: 'Target System', type: 'salesforce' },
    ],
  });

  await prisma.entity.createMany({
    data: [
      { id: ids.sourceEntityId, systemId: ids.sourceSystemId, name: 'SourceEntity' },
      { id: ids.targetEntityId, systemId: ids.targetSystemId, name: 'TargetEntity' },
    ],
  });

  await prisma.field.createMany({
    data: [
      {
        id: ids.sourceFieldId,
        entityId: ids.sourceEntityId,
        name: 'SourceField',
        dataType: 'string',
      },
      {
        id: ids.targetFieldId,
        entityId: ids.targetEntityId,
        name: 'TargetField',
        dataType: 'string',
      },
    ],
  });

  await prisma.mappingProject.create({
    data: {
      id: ids.projectId,
      name: 'Org Routes Project',
      userId: ids.userId,
      organisationId: ids.orgId,
      sourceSystemId: ids.sourceSystemId,
      targetSystemId: ids.targetSystemId,
    },
  });

  await prisma.entityMapping.create({
    data: {
      id: ids.entityMappingId,
      projectId: ids.projectId,
      sourceEntityId: ids.sourceEntityId,
      targetEntityId: ids.targetEntityId,
      confidence: 0.8,
      rationale: 'test mapping',
    },
  });

  await prisma.fieldMapping.create({
    data: {
      id: ids.fieldMappingId,
      entityMappingId: ids.entityMappingId,
      sourceFieldId: ids.sourceFieldId,
      targetFieldId: ids.targetFieldId,
      transform: { type: 'direct', config: {} },
      confidence: 0.8,
      rationale: 'test field mapping',
      status: 'suggested',
    },
  });
}

describe('org learning loop routes', () => {
  let server: Server;
  let baseUrl = '';

  const ids = {
    orgId: randomUUID(),
    userId: randomUUID(),
    projectId: randomUUID(),
    sourceSystemId: randomUUID(),
    targetSystemId: randomUUID(),
    sourceEntityId: randomUUID(),
    targetEntityId: randomUUID(),
    sourceFieldId: randomUUID(),
    targetFieldId: randomUUID(),
    entityMappingId: randomUUID(),
    fieldMappingId: randomUUID(),
  };
  const testDatabaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/automapper';

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REQUIRE_AUTH = 'false';

    const app = express();
    app.use(express.json());
    setupOrgRoutes(app);

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await ensureCoreFixtures(ids);
  }, 20_000);

  afterAll(async () => {
    await prisma.mappingEvent.deleteMany({ where: { projectId: ids.projectId } });
    await prisma.derivedMapping.deleteMany({ where: { organisationId: ids.orgId } });
    await prisma.fieldMapping.deleteMany({ where: { id: ids.fieldMappingId } });
    await prisma.entityMapping.deleteMany({ where: { id: ids.entityMappingId } });
    await prisma.mappingProject.deleteMany({ where: { id: ids.projectId } });
    await prisma.field.deleteMany({ where: { id: { in: [ids.sourceFieldId, ids.targetFieldId] } } });
    await prisma.entity.deleteMany({ where: { id: { in: [ids.sourceEntityId, ids.targetEntityId] } } });
    await prisma.system.deleteMany({ where: { id: { in: [ids.sourceSystemId, ids.targetSystemId] } } });
    await prisma.user.deleteMany({ where: { id: ids.userId } });
    await prisma.organisation.deleteMany({ where: { id: ids.orgId } });

    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    delete process.env.REQUIRE_AUTH;
    delete process.env.DATABASE_URL;
  }, 20_000);

  it('records mapping events and exposes derived mappings', async () => {
    const postResponse = await fetch(`${baseUrl}/api/org/org-routes-test/mapping-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: ids.projectId,
        fieldMappingId: ids.fieldMappingId,
        action: 'accepted',
        sourceSystemId: ids.sourceSystemId,
        sourceEntityName: 'SourceEntity',
        sourceFieldName: 'SourceField',
        targetSystemId: ids.targetSystemId,
        targetEntityName: 'TargetEntity',
        targetFieldName: 'TargetField',
        transformType: 'direct',
      }),
    });

    expect(postResponse.status).toBe(201);
    const postBody = (await postResponse.json()) as { derivedMapping: { acceptCount: number; confidence: number } };
    expect(postBody.derivedMapping.acceptCount).toBe(1);
    expect(postBody.derivedMapping.confidence).toBeGreaterThan(0);

    const getResponse = await fetch(`${baseUrl}/api/org/org-routes-test/derived-mappings?minConfidence=0`);
    expect(getResponse.status).toBe(200);

    const getBody = (await getResponse.json()) as { mappings: Array<{ sourceFieldName: string }>; total: number };
    expect(getBody.total).toBeGreaterThanOrEqual(1);
    expect(getBody.mappings[0]?.sourceFieldName).toBe('SourceField');
  }, 20_000);
});
