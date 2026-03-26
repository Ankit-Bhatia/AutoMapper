-- CreateTable
CREATE TABLE "ExportVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaFingerprint" JSONB NOT NULL,
    "fieldsSnapshot" JSONB,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedByUserId" TEXT,

    CONSTRAINT "ExportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportVersion_projectId_exportedAt_idx" ON "ExportVersion"("projectId", "exportedAt");

-- AddForeignKey
ALTER TABLE "ExportVersion" ADD CONSTRAINT "ExportVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MappingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
