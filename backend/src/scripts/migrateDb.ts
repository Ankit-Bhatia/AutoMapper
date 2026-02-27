/**
 * One-shot migration script: reads the legacy db.json flat-file store and inserts
 * all records into PostgreSQL via Prisma. Idempotent — uses upsert everywhere.
 *
 * Usage:
 *   DATABASE_URL=... DATA_DIR=./src/data npx tsx src/scripts/migrateDb.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import type { AppState } from '../types.js';
import { hashPassword } from '../auth/password.js';

const prisma = new PrismaClient();
const dataDir = process.env.DATA_DIR ?? './src/data';
const dbJsonPath = path.resolve(dataDir, 'db.json');

async function main() {
  if (!fs.existsSync(dbJsonPath)) {
    console.log(`No db.json found at ${dbJsonPath}. Nothing to migrate.`);
    await createDefaultAdmin();
    return;
  }

  const raw = fs.readFileSync(dbJsonPath, 'utf8');
  const state = JSON.parse(raw) as AppState;

  console.log('Starting migration from db.json …');

  // ─── Create default admin user ───────────────────────────────────────────────
  const adminUser = await createDefaultAdmin();
  const userId = adminUser.id;

  // ─── Systems ─────────────────────────────────────────────────────────────────
  for (const system of state.systems ?? []) {
    await prisma.system.upsert({
      where: { id: system.id },
      update: { name: system.name, type: system.type },
      create: { id: system.id, name: system.name, type: system.type },
    });
  }
  console.log(`  ✓ ${state.systems?.length ?? 0} systems`);

  // ─── Entities ────────────────────────────────────────────────────────────────
  for (const entity of state.entities ?? []) {
    await prisma.entity.upsert({
      where: { id: entity.id },
      update: { name: entity.name, label: entity.label ?? null, description: entity.description ?? null },
      create: {
        id: entity.id,
        systemId: entity.systemId,
        name: entity.name,
        label: entity.label ?? null,
        description: entity.description ?? null,
      },
    });
  }
  console.log(`  ✓ ${state.entities?.length ?? 0} entities`);

  // ─── Fields ──────────────────────────────────────────────────────────────────
  for (const field of state.fields ?? []) {
    await prisma.field.upsert({
      where: { id: field.id },
      update: {
        name: field.name,
        label: field.label ?? null,
        dataType: field.dataType,
        length: field.length ?? null,
        precision: field.precision ?? null,
        scale: field.scale ?? null,
        required: field.required ?? false,
        isKey: field.isKey ?? false,
        isExternalId: field.isExternalId ?? false,
        picklistValues: field.picklistValues ?? [],
      },
      create: {
        id: field.id,
        entityId: field.entityId,
        name: field.name,
        label: field.label ?? null,
        dataType: field.dataType,
        length: field.length ?? null,
        precision: field.precision ?? null,
        scale: field.scale ?? null,
        required: field.required ?? false,
        isKey: field.isKey ?? false,
        isExternalId: field.isExternalId ?? false,
        picklistValues: field.picklistValues ?? [],
      },
    });
  }
  console.log(`  ✓ ${state.fields?.length ?? 0} fields`);

  // ─── Relationships ───────────────────────────────────────────────────────────
  // Relationships have no natural unique key in the legacy model; insert idempotently
  // by skipping duplicates (same fromEntityId + toEntityId + type + viaField)
  let relInserted = 0;
  for (const rel of state.relationships ?? []) {
    const existing = await prisma.relationship.findFirst({
      where: {
        fromEntityId: rel.fromEntityId,
        toEntityId: rel.toEntityId,
        type: rel.type,
        viaField: rel.viaField ?? null,
      },
    });
    if (!existing) {
      await prisma.relationship.create({
        data: {
          id: uuidv4(),
          fromEntityId: rel.fromEntityId,
          toEntityId: rel.toEntityId,
          type: rel.type,
          viaField: rel.viaField ?? null,
        },
      });
      relInserted += 1;
    }
  }
  console.log(`  ✓ ${relInserted} relationships (${(state.relationships?.length ?? 0) - relInserted} skipped as duplicates)`);

  // ─── Projects ────────────────────────────────────────────────────────────────
  for (const project of state.projects ?? []) {
    await prisma.mappingProject.upsert({
      where: { id: project.id },
      update: { name: project.name, updatedAt: new Date(project.updatedAt) },
      create: {
        id: project.id,
        name: project.name,
        userId,
        sourceSystemId: project.sourceSystemId,
        targetSystemId: project.targetSystemId,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
      },
    });
  }
  console.log(`  ✓ ${state.projects?.length ?? 0} projects (linked to admin user)`);

  // ─── Entity mappings ─────────────────────────────────────────────────────────
  for (const em of state.entityMappings ?? []) {
    await prisma.entityMapping.upsert({
      where: { id: em.id },
      update: { confidence: em.confidence, rationale: em.rationale },
      create: {
        id: em.id,
        projectId: em.projectId,
        sourceEntityId: em.sourceEntityId,
        targetEntityId: em.targetEntityId,
        confidence: em.confidence,
        rationale: em.rationale,
      },
    });
  }
  console.log(`  ✓ ${state.entityMappings?.length ?? 0} entity mappings`);

  // ─── Field mappings ──────────────────────────────────────────────────────────
  for (const fm of state.fieldMappings ?? []) {
    await prisma.fieldMapping.upsert({
      where: { id: fm.id },
      update: {
        transform: fm.transform as object,
        confidence: fm.confidence,
        rationale: fm.rationale,
        status: fm.status,
      },
      create: {
        id: fm.id,
        entityMappingId: fm.entityMappingId,
        sourceFieldId: fm.sourceFieldId,
        targetFieldId: fm.targetFieldId,
        transform: fm.transform as object,
        confidence: fm.confidence,
        rationale: fm.rationale,
        status: fm.status,
      },
    });
  }
  console.log(`  ✓ ${state.fieldMappings?.length ?? 0} field mappings`);

  console.log('\nMigration complete!');
}

async function createDefaultAdmin() {
  const email = 'admin@automapper.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  Admin user already exists (id: ${existing.id})`);
    return existing;
  }

  const passwordHash = await hashPassword(process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!');
  const user = await prisma.user.create({
    data: {
      id: uuidv4(),
      email,
      name: 'Admin',
      passwordHash,
      role: 'OWNER',
    },
  });
  console.log(`  ✓ Created default admin user (id: ${user.id}, email: ${email})`);
  return user;
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
