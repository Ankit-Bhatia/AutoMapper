import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authMiddleware } from '../auth/authMiddleware.js';
import type { AuditAction } from '../db/audit.js';
import { materializeAuditEntry, writeAuditEntry } from '../db/audit.js';
import type { AppState, Field, FieldMapping } from '../types.js';
import { sendHttpError } from '../utils/httpErrors.js';
import { FsStore } from '../utils/fsStore.js';

const COMPLIANCE_TAGS = ['GLBA_NPI', 'BSA_AML', 'SOX_FINANCIAL', 'FFIEC_AUDIT', 'PCI_CARD'] as const;
const BULK_OPERATIONS = [
  'accept_suggestion',
  'reject_suggestion',
  'add_compliance_tag',
  'remove_compliance_tag',
  'set_required',
  'clear_mapping',
] as const;

const BulkOpSchema = z.object({
  operation: z.enum(BULK_OPERATIONS),
  mappingIds: z.array(z.string()).min(1).max(200),
  payload: z.object({
    complianceTag: z.enum(COMPLIANCE_TAGS).optional(),
    required: z.boolean().optional(),
  }).optional(),
}).superRefine((input, ctx) => {
  if ((input.operation === 'add_compliance_tag' || input.operation === 'remove_compliance_tag') && !input.payload?.complianceTag) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload', 'complianceTag'],
      message: 'complianceTag is required for compliance-tag bulk operations',
    });
  }
});

const BulkSelectSchema = z.object({
  filter: z.object({
    confidenceGte: z.number().min(0).max(1).optional(),
    confidenceLte: z.number().min(0).max(1).optional(),
    entityName: z.string().min(1).optional(),
    status: z.enum(['suggested', 'accepted', 'rejected', 'modified']).optional(),
    hasComplianceTag: z.enum(COMPLIANCE_TAGS).optional(),
    missingComplianceTag: z.enum(COMPLIANCE_TAGS).optional(),
  }),
});

type BulkOperation = (typeof BULK_OPERATIONS)[number];

interface BulkOperationResult {
  applied: number;
  skipped: number;
  errors: Array<{ mappingId: string; reason: string }>;
}

interface BulkStore {
  getState: () => AppState | Promise<AppState>;
  patchFieldMapping: (
    fieldMappingId: string,
    patch: Partial<Pick<FieldMapping, 'status' | 'confidence' | 'rationale' | 'targetFieldId' | 'sourceFieldId' | 'transform'>>,
  ) => FieldMapping | undefined | Promise<FieldMapping | undefined>;
  patchField?: (
    fieldId: string,
    patch: Partial<Pick<Field, 'required' | 'complianceTags'>>,
  ) => Field | undefined | Promise<Field | undefined>;
}

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  sendHttpError(req, res, status, code, message, details, 'api');
}

function actionForBulkOperation(operation: BulkOperation): AuditAction {
  if (operation === 'accept_suggestion') return 'mapping_accepted';
  if (operation === 'reject_suggestion' || operation === 'clear_mapping') return 'mapping_rejected';
  return 'mapping_modified';
}

function scopeProjectMappings(state: AppState, projectId: string): {
  projectMappingsById: Map<string, FieldMapping>;
  fieldById: Map<string, Field>;
  entityById: Map<string, AppState['entities'][number]>;
} {
  const entityMappingById = new Map(state.entityMappings.map((mapping) => [mapping.id, mapping]));
  const projectFieldMappings = state.fieldMappings.filter(
    (mapping) => entityMappingById.get(mapping.entityMappingId)?.projectId === projectId,
  );

  return {
    projectMappingsById: new Map(projectFieldMappings.map((mapping) => [mapping.id, mapping])),
    fieldById: new Map(state.fields.map((field) => [field.id, field])),
    entityById: new Map(state.entities.map((entity) => [entity.id, entity])),
  };
}

async function writeBulkAudit(
  store: BulkStore,
  req: Request,
  projectId: string,
  operation: BulkOperation,
  result: BulkOperationResult,
  requestedCount: number,
): Promise<void> {
  if (store instanceof FsStore) {
    store.appendAuditEntry(materializeAuditEntry({
      projectId,
      actor: {
        userId: req.user?.userId ?? 'unknown',
        email: req.user?.email ?? 'unknown',
        role: req.user?.role ?? 'unknown',
      },
      action: actionForBulkOperation(operation),
      targetType: 'field_mapping',
      targetId: randomUUID(),
      after: {
        operation,
        requestedCount,
        applied: result.applied,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
    }));
    return;
  }
  if (!process.env.DATABASE_URL) return;
  try {
    await writeAuditEntry({
      projectId,
      actor: {
        userId: req.user?.userId ?? 'unknown',
        email: req.user?.email ?? 'unknown',
        role: req.user?.role ?? 'unknown',
      },
      action: actionForBulkOperation(operation),
      targetType: 'field_mapping',
      targetId: randomUUID(),
      after: {
        operation,
        requestedCount,
        applied: result.applied,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
    });
  } catch (error) {
    console.error('[bulk] Failed to write audit entry:', error);
  }
}

export function createBulkRouter(store: BulkStore) {
  const router = Router({ mergeParams: true });

  router.post('/bulk', authMiddleware, async (req: Request, res: Response) => {
    const parsed = BulkOpSchema.safeParse(req.body);
    if (!parsed.success) {
      const missingTag = parsed.error.issues.some((issue) => issue.path.join('.') === 'payload.complianceTag');
      if (missingTag) {
        sendError(req, res, 400, 'VALIDATION_ERROR', 'complianceTag is required for this bulk operation', parsed.error.issues);
        return;
      }
      sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid bulk operation request', parsed.error.issues);
      return;
    }

    const { operation, mappingIds, payload } = parsed.data;
    const projectId = req.params.id;
    const state = await Promise.resolve(store.getState());
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
      return;
    }

    const { projectMappingsById, fieldById } = scopeProjectMappings(state, projectId);
    const result: BulkOperationResult = { applied: 0, skipped: 0, errors: [] };

    for (const mappingId of mappingIds) {
      const mapping = projectMappingsById.get(mappingId);
      if (!mapping) {
        result.errors.push({ mappingId, reason: 'mapping_not_found' });
        continue;
      }

      try {
        if (operation === 'accept_suggestion') {
          if (mapping.status === 'accepted') {
            result.skipped += 1;
            continue;
          }
          const patched = await Promise.resolve(store.patchFieldMapping(mappingId, { status: 'accepted' }));
          if (!patched) {
            result.errors.push({ mappingId, reason: 'patch_failed' });
            continue;
          }
          projectMappingsById.set(mappingId, patched);
          result.applied += 1;
          continue;
        }

        if (operation === 'reject_suggestion') {
          if (mapping.status === 'rejected') {
            result.skipped += 1;
            continue;
          }
          const patched = await Promise.resolve(store.patchFieldMapping(mappingId, { status: 'rejected' }));
          if (!patched) {
            result.errors.push({ mappingId, reason: 'patch_failed' });
            continue;
          }
          projectMappingsById.set(mappingId, patched);
          result.applied += 1;
          continue;
        }

        if (operation === 'clear_mapping') {
          if (mapping.status === 'rejected' && mapping.confidence === 0) {
            result.skipped += 1;
            continue;
          }
          const patched = await Promise.resolve(
            store.patchFieldMapping(mappingId, { status: 'rejected', confidence: 0 }),
          );
          if (!patched) {
            result.errors.push({ mappingId, reason: 'patch_failed' });
            continue;
          }
          projectMappingsById.set(mappingId, patched);
          result.applied += 1;
          continue;
        }

        if (!store.patchField) {
          result.errors.push({ mappingId, reason: 'field_patch_unsupported' });
          continue;
        }

        const targetField = fieldById.get(mapping.targetFieldId);
        if (!targetField) {
          result.errors.push({ mappingId, reason: 'target_field_not_found' });
          continue;
        }

        if (operation === 'set_required') {
          const required = payload?.required ?? true;
          if ((targetField.required ?? false) === required) {
            result.skipped += 1;
            continue;
          }
          const patchedField = await Promise.resolve(store.patchField(targetField.id, { required }));
          if (!patchedField) {
            result.errors.push({ mappingId, reason: 'patch_failed' });
            continue;
          }
          fieldById.set(targetField.id, patchedField);
          result.applied += 1;
          continue;
        }

        const requestedTag = payload?.complianceTag;
        if (!requestedTag) {
          result.errors.push({ mappingId, reason: 'missing_compliance_tag' });
          continue;
        }

        const existingTags = targetField.complianceTags ?? [];
        if (operation === 'add_compliance_tag') {
          if (existingTags.includes(requestedTag)) {
            result.skipped += 1;
            continue;
          }
          const patchedField = await Promise.resolve(
            store.patchField(targetField.id, { complianceTags: [...existingTags, requestedTag] }),
          );
          if (!patchedField) {
            result.errors.push({ mappingId, reason: 'patch_failed' });
            continue;
          }
          fieldById.set(targetField.id, patchedField);
          result.applied += 1;
          continue;
        }

        if (operation === 'remove_compliance_tag') {
          if (!existingTags.includes(requestedTag)) {
            result.skipped += 1;
            continue;
          }
          const patchedField = await Promise.resolve(
            store.patchField(targetField.id, {
              complianceTags: existingTags.filter((tag) => tag !== requestedTag),
            }),
          );
          if (!patchedField) {
            result.errors.push({ mappingId, reason: 'patch_failed' });
            continue;
          }
          fieldById.set(targetField.id, patchedField);
          result.applied += 1;
          continue;
        }
      } catch {
        result.errors.push({ mappingId, reason: 'patch_failed' });
      }
    }

    await writeBulkAudit(store, req, projectId, operation, result, mappingIds.length);
    res.json(result);
  });

  router.post('/bulk-select', authMiddleware, async (req: Request, res: Response) => {
    const parsed = BulkSelectSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid bulk-select filter', parsed.error.issues);
      return;
    }

    const projectId = req.params.id;
    const state = await Promise.resolve(store.getState());
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      sendError(req, res, 404, 'PROJECT_NOT_FOUND', 'Project not found');
      return;
    }

    const { projectMappingsById, fieldById, entityById } = scopeProjectMappings(state, projectId);
    const { filter } = parsed.data;
    const expectedEntityName = filter.entityName?.trim().toLowerCase();

    const matchingMappingIds = [...projectMappingsById.values()]
      .filter((mapping) => {
        if (filter.confidenceGte !== undefined && mapping.confidence < filter.confidenceGte) return false;
        if (filter.confidenceLte !== undefined && mapping.confidence > filter.confidenceLte) return false;
        if (filter.status !== undefined && mapping.status !== filter.status) return false;

        const sourceField = fieldById.get(mapping.sourceFieldId);
        const targetField = fieldById.get(mapping.targetFieldId);

        if (expectedEntityName) {
          const sourceEntityName = sourceField ? entityById.get(sourceField.entityId)?.name.toLowerCase() : null;
          const targetEntityName = targetField ? entityById.get(targetField.entityId)?.name.toLowerCase() : null;
          if (sourceEntityName !== expectedEntityName && targetEntityName !== expectedEntityName) {
            return false;
          }
        }

        const complianceTags = targetField?.complianceTags ?? [];
        if (filter.hasComplianceTag && !complianceTags.includes(filter.hasComplianceTag)) return false;
        if (filter.missingComplianceTag && complianceTags.includes(filter.missingComplianceTag)) return false;

        return true;
      })
      .map((mapping) => mapping.id);

    res.json({ mappingIds: matchingMappingIds, count: matchingMappingIds.length });
  });

  return router;
}
