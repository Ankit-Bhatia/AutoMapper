import { prisma } from './prismaClient.js';

export type AuditAction =
  | 'mapping_suggested'
  | 'mapping_accepted'
  | 'mapping_rejected'
  | 'mapping_modified'
  | 'conflict_resolved'
  | 'project_created'
  | 'project_exported';

export interface AuditActor {
  userId: string;
  email: string;
  role: string;
}

export interface WriteAuditEntryArgs {
  projectId: string;
  actor: AuditActor;
  action: AuditAction;
  targetType: 'field_mapping' | 'project' | 'conflict';
  targetId: string;
  before?: unknown;
  after?: unknown;
}

export async function writeAuditEntry(args: WriteAuditEntryArgs): Promise<void> {
  await prisma.auditEntry.create({
    data: {
      projectId: args.projectId,
      actorUserId: args.actor.userId,
      actorEmail: args.actor.email,
      actorRole: args.actor.role,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      diffBefore: args.before !== undefined ? (args.before as object) : undefined,
      diffAfter: args.after !== undefined ? (args.after as object) : undefined,
    },
  });
}
