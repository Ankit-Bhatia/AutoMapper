import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  sourceSystemName: z.string().min(1).max(100).optional(),
  targetSystemName: z.string().min(1).max(100).optional(),
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
      type: z.string(),
      config: z.record(z.unknown()),
    })
    .optional(),
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
export type SalesforceSchemaInput = z.infer<typeof SalesforceSchemaSchema>;
export type PatchFieldMappingInput = z.infer<typeof PatchFieldMappingSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
