-- AlterTable
ALTER TABLE "Field" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isUpsertKey" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RecordType" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sfRecordTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordType_entityId_idx" ON "RecordType"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordType_entityId_sfRecordTypeId_key" ON "RecordType"("entityId", "sfRecordTypeId");

-- AddForeignKey
ALTER TABLE "RecordType" ADD CONSTRAINT "RecordType_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
