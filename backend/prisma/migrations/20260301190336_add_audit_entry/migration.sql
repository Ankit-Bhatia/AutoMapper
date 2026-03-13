-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "diffBefore" JSONB,
    "diffAfter" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEntry_projectId_timestamp_idx" ON "AuditEntry"("projectId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEntry_actorUserId_idx" ON "AuditEntry"("actorUserId");

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MappingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
