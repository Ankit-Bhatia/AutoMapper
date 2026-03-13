import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prismaClient.js';
import { setupCanonicalRoutes } from '../routes/canonicalRoutes.js';

describe('canonical routes', () => {
  let server: Server;
  let baseUrl = '';

  const sourceSystemId = 'sys-silverlake-test';
  const targetSystemId = 'sys-fsc-test';
  const sourceEntityId = 'entity-silverlake-test';
  const targetEntityId = 'entity-fsc-test';
  const testDatabaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/automapper';

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REQUIRE_AUTH = 'false';

    const app = express();
    app.use(express.json());
    setupCanonicalRoutes(app);

    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    await prisma.fieldCanonicalMap.deleteMany({
      where: {
        OR: [
          { field: { entity: { systemId: sourceSystemId } } },
          { field: { entity: { systemId: targetSystemId } } },
        ],
      },
    });
    await prisma.field.deleteMany({
      where: {
        entity: { systemId: { in: [sourceSystemId, targetSystemId] } },
      },
    });
    await prisma.entity.deleteMany({ where: { id: { in: [sourceEntityId, targetEntityId] } } });
    await prisma.system.deleteMany({ where: { id: { in: [sourceSystemId, targetSystemId] } } });

    const domain = await prisma.canonicalDomain.upsert({
      where: { name: 'test-domain-canonical' },
      update: { description: 'test canonical domain' },
      create: { name: 'test-domain-canonical', description: 'test canonical domain' },
    });

    await prisma.system.createMany({
      data: [
        { id: sourceSystemId, name: 'SilverLake Test', type: 'jackhenry' },
        { id: targetSystemId, name: 'FSC Test', type: 'salesforce' },
      ],
      skipDuplicates: true,
    });

    await prisma.entity.createMany({
      data: [
        { id: sourceEntityId, systemId: sourceSystemId, name: 'CIFCustomer', label: 'CIF Customer' },
        { id: targetEntityId, systemId: targetSystemId, name: 'Contact', label: 'Contact' },
      ],
      skipDuplicates: true,
    });

    for (let i = 0; i < 60; i += 1) {
      const canonicalField = await prisma.canonicalField.create({
        data: {
          domainId: domain.id,
          conceptName: `concept_${i}`,
          displayLabel: `Concept ${i}`,
          dataType: 'string',
          complianceTags: i % 2 === 0 ? ['GLBA_NPI'] : [],
        },
      });

      const sourceField = await prisma.field.create({
        data: {
          id: `sf-${i}`,
          entityId: sourceEntityId,
          name: `SourceField${i}`,
          label: `Source Field ${i}`,
          dataType: 'string',
          required: false,
          isKey: false,
          isExternalId: false,
          picklistValues: [],
          complianceTags: [],
        },
      });

      const targetField = await prisma.field.create({
        data: {
          id: `tf-${i}`,
          entityId: targetEntityId,
          name: `TargetField${i}`,
          label: `Target Field ${i}`,
          dataType: 'string',
          required: false,
          isKey: false,
          isExternalId: false,
          picklistValues: [],
          complianceTags: [],
        },
      });

      await prisma.fieldCanonicalMap.createMany({
        data: [
          {
            fieldId: sourceField.id,
            canonicalFieldId: canonicalField.id,
            confidence: 1,
            mappedBy: 'test',
          },
          {
            fieldId: targetField.id,
            canonicalFieldId: canonicalField.id,
            confidence: 1,
            mappedBy: 'test',
          },
        ],
      });
    }
  });

  afterAll(async () => {
    await prisma.fieldCanonicalMap.deleteMany({
      where: {
        OR: [
          { field: { entity: { systemId: sourceSystemId } } },
          { field: { entity: { systemId: targetSystemId } } },
        ],
      },
    });
    await prisma.field.deleteMany({
      where: {
        entity: { systemId: { in: [sourceSystemId, targetSystemId] } },
      },
    });
    await prisma.entity.deleteMany({ where: { id: { in: [sourceEntityId, targetEntityId] } } });
    await prisma.system.deleteMany({ where: { id: { in: [sourceSystemId, targetSystemId] } } });
    await prisma.canonicalField.deleteMany({ where: { conceptName: { startsWith: 'concept_' } } });
    await prisma.canonicalDomain.deleteMany({ where: { name: 'test-domain-canonical' } });

    await prisma.$disconnect();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    delete process.env.REQUIRE_AUTH;
    delete process.env.DATABASE_URL;
  });

  it('resolves at least 50 transitive mappings for SilverLake -> FSC', async () => {
    const response = await fetch(`${baseUrl}/api/systems/${sourceSystemId}/canonical-map?targetSystemId=${targetSystemId}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      mappings: Array<{ canonicalConcept: string; sourceField: string; targetField: string }>;
      count: number;
    };

    expect(body.count).toBeGreaterThanOrEqual(50);
    expect(body.mappings.length).toBeGreaterThanOrEqual(50);
    expect(body.mappings[0]).toHaveProperty('canonicalConcept');
    expect(body.mappings[0]).toHaveProperty('sourceField');
    expect(body.mappings[0]).toHaveProperty('targetField');
  });
});
