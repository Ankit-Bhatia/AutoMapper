import { randomUUID } from 'node:crypto';
import { prisma } from './prismaClient.js';
import type { AuditAction, AuditActor, AuditEntry } from '../types.js';

export type { AuditAction, AuditActor, AuditEntry } from '../types.js';

export interface WriteAuditEntryArgs {
  projectId: string;
  actor: AuditActor;
  action: AuditAction;
  targetType: 'field_mapping' | 'project' | 'conflict';
  targetId: string;
  before?: unknown;
  after?: unknown;
}

export function materializeAuditEntry(args: WriteAuditEntryArgs): AuditEntry {
  return {
    id: randomUUID(),
    projectId: args.projectId,
    actor: args.actor,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    diff: args.before !== undefined || args.after !== undefined
      ? {
        before: args.before,
        after: args.after,
      }
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

export async function writeAuditEntry(args: WriteAuditEntryArgs): Promise<void> {
  const entry = materializeAuditEntry(args);
  await prisma.auditEntry.create({
    data: {
      id: entry.id,
      projectId: entry.projectId,
      actorUserId: entry.actor.userId,
      actorEmail: entry.actor.email,
      actorRole: entry.actor.role,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      diffBefore: entry.diff?.before !== undefined ? (entry.diff.before as object) : undefined,
      diffAfter: entry.diff?.after !== undefined ? (entry.diff.after as object) : undefined,
      timestamp: new Date(entry.timestamp),
    },
  });
}
