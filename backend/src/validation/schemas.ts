import { z } from 'zod';

const UserRoleSchema = z.enum(['viewer', 'mapper', 'approver', 'admin']);

const TransformTypeSchema = z.enum([
  'direct',
  'concat',
  'formatDate',
  'lookup',
  'static',
  'regex',
  'split',
  'trim',
]);

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  sourceSystemName: z.string().min(1).max(100).optional(),
  targetSystemName: z.string().min(1).max(100).optional(),
});

export const PatchProjectSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.archived !== undefined, {
  message: 'At least one field must be provided',
});

export const AddProjectMemberSchema = z.object({
  email: z.string().email(),
  role: UserRoleSchema,
});

export const PatchProjectMemberSchema = z.object({
  role: UserRoleSchema,
});

export const SalesforceSchemaSchema = z.object({
  objects: z.array(z.string()).optional(),
  credentials: z
    .object({
      loginUrl: z.string().url().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      securityToken: z.string().optional(),
      accessToken: z.string().optional(),
      instanceUrl: z.string().url().optional(),
    })
    .optional(),
});

export const SuggestMappingsSchema = z.object({}).passthrough();

export const PatchFieldMappingSchema = z.object({
  status: z.enum(['suggested', 'accepted', 'rejected', 'modified']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
  sourceFieldId: z.string().uuid().optional(),
  targetFieldId: z.string().uuid().optional(),
  transform: z
    .object({
      type: TransformTypeSchema,
      config: z.record(z.unknown()),
    })
    .optional(),
});

export const ConflictResolutionRequestSchema = z
  .object({
    action: z.enum(['pick', 'reject-all']),
    winnerMappingId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'pick' && !value.winnerMappingId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['winnerMappingId'],
        message: 'winnerMappingId is required when action is pick',
      });
    }
  });

export const ResolveOneToManyMappingsSchema = z.object({
  resolutions: z.array(
    z.object({
      fieldMappingId: z.string().uuid(),
      sourceFieldId: z.string().uuid(),
      targetFieldId: z.string().uuid(),
    }),
  ).min(1),
});

export const ReviewDecisionSchema = z.object({
  sourceFieldId: z.string().trim().min(1).max(255),
  targetFieldId: z.string().trim().min(1).max(255),
  action: z.enum(['accepted', 'rejected']),
  confidence: z.number().min(0).max(1),
});

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type PatchProjectInput = z.infer<typeof PatchProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof AddProjectMemberSchema>;
export type PatchProjectMemberInput = z.infer<typeof PatchProjectMemberSchema>;
export type SalesforceSchemaInput = z.infer<typeof SalesforceSchemaSchema>;
export type PatchFieldMappingInput = z.infer<typeof PatchFieldMappingSchema>;
export type ConflictResolutionRequestInput = z.infer<typeof ConflictResolutionRequestSchema>;
export type ResolveOneToManyMappingsInput = z.infer<typeof ResolveOneToManyMappingsSchema>;
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
