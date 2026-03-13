import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBulkRouter } from '../routes/bulkRoutes.js';
import { FsStore } from '../utils/fsStore.js';

interface HttpResponse {
  status: number;
  body: unknown;
}

interface TestContext {
  server: http.Server;
  baseUrl: string;
  dataDir: string;
  store: FsStore;
}

const baseState = {
  systems: [
    { id: 'src-system', name: 'SilverLake', type: 'jackhenry' },
    { id: 'tgt-system', name: 'Salesforce', type: 'salesforce' },
  ],
  entities: [
    { id: 'src-entity', systemId: 'src-system', name: 'LOAN', label: 'Loan' },
    { id: 'tgt-entity', systemId: 'tgt-system', name: 'FinancialAccount', label: 'Financial Account' },
  ],
  fields: [
    {
      id: 'src-field-1',
      entityId: 'src-entity',
      name: 'AMT_APPROVED_LOAN',
      label: 'AMT_APPROVED_LOAN',
      dataType: 'decimal',
      required: false,
      isKey: false,
      isExternalId: false,
      picklistValues: [],
    },
    {
      id: 'src-field-2',
      entityId: 'src-entity',
      name: 'NBR_TERM_IN_MOS',
      label: 'NBR_TERM_IN_MOS',
      dataType: 'integer',
      required: false,
      isKey: false,
      isExternalId: false,
      picklistValues: [],
    },
    {
      id: 'tgt-field-1',
      entityId: 'tgt-entity',
      name: 'LoanAmount__c',
      label: 'LoanAmount__c',
      dataType: 'decimal',
      required: false,
      isKey: false,
      isExternalId: false,
      picklistValues: [],
      complianceTags: [],
    },
    {
      id: 'tgt-field-2',
      entityId: 'tgt-entity',
      name: 'LoanTerm__c',
      label: 'LoanTerm__c',
      dataType: 'integer',
      required: false,
      isKey: false,
      isExternalId: false,
      picklistValues: [],
      complianceTags: ['GLBA_NPI'],
    },
  ],
  relationships: [],
  projects: [
    {
      id: 'project-1',
      name: 'Test Project',
      sourceSystemId: 'src-system',
      targetSystemId: 'tgt-system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  entityMappings: [
    {
      id: 'em-1',
      projectId: 'project-1',
      sourceEntityId: 'src-entity',
      targetEntityId: 'tgt-entity',
      confidence: 0.91,
      rationale: 'test',
    },
  ],
  fieldMappings: [
    {
      id: 'fm-1',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-field-1',
      targetFieldId: 'tgt-field-1',
      transform: { type: 'direct', config: {} },
      confidence: 0.91,
      rationale: 'test',
      status: 'suggested',
    },
    {
      id: 'fm-2',
      entityMappingId: 'em-1',
      sourceFieldId: 'src-field-2',
      targetFieldId: 'tgt-field-2',
      transform: { type: 'direct', config: {} },
      confidence: 0.52,
      rationale: 'test',
      status: 'accepted',
    },
  ],
};

function createContext(): TestContext {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automapper-bulk-'));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(baseState, null, 2), 'utf8');
  const store = new FsStore(dataDir);

  const app = express();
  app.use(express.json());
  app.use('/api/projects/:id/mappings', createBulkRouter(store));

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, baseUrl, dataDir, store };
}

async function closeContext(context: TestContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    context.server.close((error) => (error ? reject(error) : resolve()));
  });
  fs.rmSync(context.dataDir, { recursive: true, force: true });
}

async function postJson(baseUrl: string, urlPath: string, payload: unknown): Promise<HttpResponse> {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

describe('bulkRoutes', () => {
  let context: TestContext | null = null;
  const originalRequireAuth = process.env.REQUIRE_AUTH;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.REQUIRE_AUTH = 'false';
    process.env.DATABASE_URL = '';
    context = createContext();
  });

  afterEach(async () => {
    process.env.REQUIRE_AUTH = originalRequireAuth;
    process.env.DATABASE_URL = originalDatabaseUrl;
    if (context) {
      await closeContext(context);
      context = null;
    }
  });

  it('accept_suggestion applies to suggested mappings and skips already accepted mappings', async () => {
    const response = await postJson(context!.baseUrl, '/api/projects/project-1/mappings/bulk', {
      operation: 'accept_suggestion',
      mappingIds: ['fm-1', 'fm-2'],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      applied: 1,
      skipped: 1,
      errors: [],
    });

    const state = context!.store.getState();
    const fm1 = state.fieldMappings.find((mapping) => mapping.id === 'fm-1');
    const fm2 = state.fieldMappings.find((mapping) => mapping.id === 'fm-2');
    expect(fm1?.status).toBe('accepted');
    expect(fm2?.status).toBe('accepted');
  });

  it('returns 400 when mappingIds exceed 200', async () => {
    const mappingIds = Array.from({ length: 201 }, (_value, index) => `fm-${index}`);

    const response = await postJson(context!.baseUrl, '/api/projects/project-1/mappings/bulk', {
      operation: 'accept_suggestion',
      mappingIds,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  it('returns 400 when add_compliance_tag omits complianceTag', async () => {
    const response = await postJson(context!.baseUrl, '/api/projects/project-1/mappings/bulk', {
      operation: 'add_compliance_tag',
      mappingIds: ['fm-1'],
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  it('bulk-select supports confidence and compliance tag filters', async () => {
    const confidenceResponse = await postJson(context!.baseUrl, '/api/projects/project-1/mappings/bulk-select', {
      filter: {
        confidenceGte: 0.85,
      },
    });

    expect(confidenceResponse.status).toBe(200);
    expect(confidenceResponse.body).toMatchObject({
      mappingIds: ['fm-1'],
      count: 1,
    });

    const tagResponse = await postJson(context!.baseUrl, '/api/projects/project-1/mappings/bulk-select', {
      filter: {
        hasComplianceTag: 'GLBA_NPI',
      },
    });

    expect(tagResponse.status).toBe(200);
    expect(tagResponse.body).toMatchObject({
      mappingIds: ['fm-2'],
      count: 1,
    });
  });
});
